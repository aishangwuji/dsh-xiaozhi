/**
 * The device-side "server gateway" the watch calls to act on this machine.
 *
 * Contract comes from the firmware (`main/server_gateway.cc`) and its custom
 * gateway: the device POSTs `/exec` with a Bearer token it stores in NVS, and the
 * model speaks the returned text. That means three deliberate limits, all of them
 * enforced here rather than by the caller:
 *
 *   - only a configured argv may run, never a shell (`shell: false`), so `;`,
 *     `|`, `$( )` and backticks are plain characters;
 *   - every `{placeholder}` value is checked against its own allow-list, because
 *     pinning `argv[0]` alone would still let `{unit}` restart anything;
 *   - a missing or empty token disables the whole surface. An unauthenticated
 *     `/exec` on a LAN port is a remote shell for anyone on the Wi-Fi.
 *
 * Success and command failure both answer HTTP 200 with `[exit N]` in the body —
 * the device treats the body as text to read out, and a 500 would make the model
 * claim the request failed when the command actually ran.
 */

import { spawn as nodeSpawn } from 'node:child_process'
import { timingSafeEqual } from 'node:crypto'

const MAX_TIMEOUT_SEC = 60
const MAX_OUTPUT_BYTES = 64 * 1024
const SAFE_ENV_KEYS = ['PATH', 'Path', 'LANG', 'LC_ALL', 'HOME', 'USERPROFILE', 'TZ', 'TERM', 'SystemRoot', 'ComSpec']

const VERSION = '1.0.0'

export function createGateway({ config = {}, logger, spawn = nodeSpawn, clock = () => Date.now() } = {}) {
  const commands = normalizeCommands(config.commands)
  const token = typeof config.token === 'string' ? config.token : ''
  const enabled = config.enabled !== false && token !== ''
  const rateLimitPerMin = positiveInt(config.rateLimitPerMin, 30, 1, 600)
  const authFailLimit = positiveInt(config.authFailPerMin, 10, 1, 600)
  const defaultTimeoutSec = positiveInt(config.defaultTimeoutSec, 8, 1, MAX_TIMEOUT_SEC)
  const defaultMaxOutput = positiveInt(config.maxOutputBytes, 4096, 256, MAX_OUTPUT_BYTES)

  const buckets = new Map()
  const failures = new Map()

  function bucketFor(map, key, windowMs) {
    const now = clock()
    let bucket = map.get(key)
    if (!bucket || now - bucket.start >= windowMs) {
      bucket = { start: now, count: 0 }
      map.set(key, bucket)
    }
    return bucket
  }

  function authorized(req) {
    if (!token) return false
    const header = String(req.headers.authorization ?? '')
    const match = /^Bearer\s+(.+)$/i.exec(header.trim())
    if (!match) return false
    const provided = Buffer.from(match[1].trim(), 'utf8')
    const expected = Buffer.from(token, 'utf8')
    if (provided.length !== expected.length) return false
    return timingSafeEqual(provided, expected)
  }

  function json(res, status, body) {
    const payload = Buffer.from(JSON.stringify(body), 'utf8')
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': payload.length,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    res.end(payload)
  }

  function text(res, status, body) {
    const payload = Buffer.from(body, 'utf8')
    res.writeHead(status, {
      'content-type': 'text/plain; charset=utf-8',
      'content-length': payload.length,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    res.end(payload)
  }

  async function readBody(req, limit = 16 * 1024) {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > limit) throw Object.assign(new Error('body too large'), { status: 400 })
      chunks.push(chunk)
    }
    if (chunks.length === 0) return {}
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      throw Object.assign(new Error('body must be JSON'), { status: 400 })
    }
  }

  /** Returns true when the path belongs to the gateway (handled or rejected). */
  async function handle(req, res, url, remoteIp = '') {
    const path = url.pathname
    if (path !== '/health' && path !== '/commands' && path !== '/exec') return false

    if (path === '/health') {
      json(res, 200, { ok: true, version: VERSION, time: clock(), enabled, commands: Object.keys(commands).length })
      return true
    }

    if (!enabled) {
      text(res, 404, 'gateway is not configured on this server')
      return true
    }

    const failureBucket = bucketFor(failures, remoteIp, 60_000)
    if (failureBucket.count >= authFailLimit) {
      logger?.warn?.(`dsh-xiaozhi: gateway auth locked out ${remoteIp || 'unknown'} for 60s`)
      text(res, 429, 'too many authentication failures, wait a minute')
      return true
    }

    if (!authorized(req)) {
      failureBucket.count += 1
      logger?.warn?.(`dsh-xiaozhi: gateway rejected ${path} from ${remoteIp || 'unknown'} (bad token)`)
      text(res, 401, 'unauthorized')
      return true
    }

    const rateBucket = bucketFor(buckets, remoteIp, 60_000)
    if (rateBucket.count >= rateLimitPerMin) {
      text(res, 429, 'rate limit exceeded')
      return true
    }
    rateBucket.count += 1

    if (req.method === 'GET' && path === '/commands') {
      json(res, 200, {
        ok: true,
        commands: Object.entries(commands).map(([name, spec]) => ({
          name,
          desc: spec.desc,
          params: spec.params,
        })),
      })
      return true
    }

    if (req.method === 'POST' && path === '/exec') {
      let body
      try {
        body = await readBody(req)
      } catch (error) {
        text(res, error.status ?? 400, error.message)
        return true
      }
      const name = typeof body.cmd === 'string' ? body.cmd.trim() : ''
      if (!name) {
        text(res, 400, 'cmd is required')
        return true
      }
      const spec = commands[name]
      if (!spec) {
        text(res, 400, `unknown command: ${name}`)
        return true
      }
      const args = body.args && typeof body.args === 'object' && !Array.isArray(body.args) ? body.args : {}
      let argv
      try {
        argv = resolveArgv(spec, args)
      } catch (error) {
        text(res, 400, error.message)
        return true
      }
      const result = await run(spec, argv, { defaultTimeoutSec })
      text(res, 200, result)
      return true
    }

    text(res, 404, 'not found')
    return true
  }

  function resolveArgv(spec, args) {
    const argv = spec.argv.map((template) =>
      String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => {
        const value = args[key]
        const allowed = spec.params[key]
        if (!allowed) throw new Error(`unexpected parameter: ${key}`)
        if (typeof value !== 'string') throw new Error(`missing parameter: ${key}`)
        if (!allowed.includes(value)) throw new Error(`parameter ${key} not allowed: ${value}`)
        return value
      }),
    )
    const unused = Object.keys(args).filter((key) => !spec.argv.some((entry) => String(entry).includes(`{${key}}`)))
    if (unused.length > 0) throw new Error(`unexpected argument(s): ${unused.join(', ')}`)
    return argv
  }

  function run(spec, argv, { defaultTimeoutSec: fallbackTimeout }) {
    const startedAt = clock()
    const timeoutSec = Math.min(spec.timeoutSec ?? fallbackTimeout, MAX_TIMEOUT_SEC)
    const maxBytes = Math.min(spec.maxOutputBytes ?? defaultMaxOutput, MAX_OUTPUT_BYTES)
    const env = {}
    for (const key of SAFE_ENV_KEYS) {
      if (process.env[key] !== undefined) env[key] = process.env[key]
    }

    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''
      let truncated = false
      let killed = false
      const child = spawn(argv[0], argv.slice(1), {
        cwd: spec.cwd || '/',
        env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const timer = setTimeout(() => {
        killed = true
        try {
          child.kill('SIGKILL')
        } catch {
          // Already gone.
        }
      }, timeoutSec * 1000)
      timer.unref?.()

      const collect = (chunk) => {
        if (stdout.length + stderr.length > maxBytes * 2) {
          truncated = true
          return
        }
        return chunk.toString('utf8')
      }
      child.stdout.on('data', (chunk) => {
        const text = collect(chunk)
        if (text) stdout += text
      })
      child.stderr.on('data', (chunk) => {
        const text = collect(chunk)
        if (text) stderr += text
      })

      const finish = (code, error) => {
        clearTimeout(timer)
        const elapsed = clock() - startedAt
        const raw = (stdout + (stderr ? `\n${stderr}` : '')).trim()
        let output = raw
        if (raw.length > maxBytes) {
          truncated = true
          output = spec.keep === 'tail' ? raw.slice(-maxBytes) : raw.slice(0, maxBytes)
        }
        if (truncated) output += '\n…(truncated)'
        if (error && !killed) output = `${output}${output ? '\n' : ''}${error.message}`.trim()
        const status = killed ? 124 : typeof code === 'number' ? code : -1
        const head = `$ ${argv.join(' ')}`
        const body = [head, output, `[exit ${status}, ${elapsed} ms]`].filter((part) => part !== '').join('\n')
        resolve(body)
      }

      child.on('error', (error) => finish(-1, error))
      child.on('close', (code) => finish(code, null))
    })
  }

  return {
    enabled,
    version: VERSION,
    commandNames: () => Object.keys(commands),
    handle,
    describe: () => ({
      enabled,
      commands: Object.keys(commands).length,
      rateLimitPerMin,
    }),
  }
}

function positiveInt(value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < min) return fallback
  return Math.min(number, max)
}

/**
 * Normalize the command table. A malformed entry is dropped with a warning
 * instead of being executed leniently: a whitelist that fails open is not one.
 */
function normalizeCommands(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [name, spec] of Object.entries(raw)) {
    if (!/^[a-zA-Z0-9._-]{1,32}$/.test(name)) continue
    if (!spec || typeof spec !== 'object') continue
    if (!Array.isArray(spec.argv) || spec.argv.length === 0) continue
    if (!spec.argv.every((entry) => typeof entry === 'string' && entry.length > 0)) continue
    if (typeof spec.argv[0] !== 'string' || spec.argv[0].includes('{')) continue
    const params = {}
    for (const [key, values] of Object.entries(spec.params ?? {})) {
      if (!Array.isArray(values)) continue
      params[key] = values.filter((value) => typeof value === 'string')
    }
    const placeholders = new Set(
      spec.argv.flatMap((entry) => [...String(entry).matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1])),
    )
    // A placeholder without an allow-list would let the caller pass anything.
    if ([...placeholders].some((key) => !params[key] || params[key].length === 0)) continue
    out[name] = {
      argv: spec.argv,
      params,
      desc: typeof spec.desc === 'string' ? spec.desc.slice(0, 200) : '',
      cwd: typeof spec.cwd === 'string' && spec.cwd ? spec.cwd : '/',
      timeoutSec: Number.isInteger(spec.timeout_sec) ? spec.timeout_sec : Number.isInteger(spec.timeoutSec) ? spec.timeoutSec : undefined,
      maxOutputBytes: Number.isInteger(spec.max_output_bytes)
        ? spec.max_output_bytes
        : Number.isInteger(spec.maxOutputBytes)
          ? spec.maxOutputBytes
          : undefined,
      keep: spec.keep === 'tail' ? 'tail' : 'head',
    }
  }
  return out
}
