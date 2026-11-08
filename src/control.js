/**
 * Operator API for the console, mounted on the Harness Web server (loopback).
 *
 * There is no login layer: whoever can open the panel is the operator, because
 * reaching this route already requires access to the local machine. The only
 * guard on mutations is the `x-dsh-xiaozhi` CSRF header.
 *
 * Secrets never leave through this file except masked: `SettingsStore.snapshot()`
 * returns presence plus a `••••` tail, and blank on write means "keep".
 */

import { createReadStream } from 'node:fs'
import { AgentStoreError } from './agents.js'
import { DeviceStoreError } from './store.js'
import { listLanAddresses } from './network.js'
import { SettingsError } from './settings.js'
import { voiceOptionsFor } from './voice/voices.js'
import { normalizeOutputLanguage } from './voice/language.js'
import { hostProviderIssue } from './voice/host-provider.js'
import { modelsFor } from './models.js'
import { openAiCompatiblePreset } from './voice/adapters/index.js'
import { localProviders } from './voice/adapters/local-asr.js'

const CONTROL_PREFIX = '/dsh-xiaozhi-7c3a'
const MAX_JSON_BODY = 64 * 1024

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
}

function sendJson(res, status, body) {
  if (res.headersSent) {
    res.end()
    return
  }
  res.writeHead(status, JSON_HEADERS)
  res.end(JSON.stringify(body))
}

async function readJson(req, limit = MAX_JSON_BODY) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) {
      const error = new Error('request body is too large')
      error.status = 413
      throw error
    }
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    const error = new Error('request body must be valid JSON')
    error.status = 400
    throw error
  }
}

function statusOf(error) {
  if (error instanceof DeviceStoreError) return error.code === 'not-found' ? 404 : 400
  if (error instanceof AgentStoreError) return error.code === 'not-found' ? 404 : 400
  if (error instanceof SettingsError) return error.code === 'weak-password' ? 400 : 400
  return Number.isSafeInteger(error.status) ? error.status : 500
}

export function createControlHandler({
  store,
  agents,
  hub,
  config,
  voice,
  gatewayRef,
  settings,
  defaults,
  onSettingsChanged,
  probeLlm,
  probeProvider,
  crashGuard,
  speechToText,
  llm,
  tools,
  memory,
  history,
  ready: bootstrapReady,
  logger,
  clock = () => Date.now(),
}) {
  // 设备名册 + 智能体一起就绪（含旧设备 → 智能体的迁移）之后，控制台才开始读数据。
  const ready = bootstrapReady ?? store.load()

  // No login: the console is served by the loopback-only Harness web server, so
  // reaching it already means holding the machine. The only guard left is the
  // CSRF header, which stops a random web page from posting to these routes.
  function requireTrustedMutation(req, res) {
    if (req.headers['x-dsh-xiaozhi'] !== '1') {
      logger.warn?.(`dsh-xiaozhi: refused a mutation without the CSRF header (${req.url ?? ''})`)
      sendJson(res, 403, { error: { code: 'csrf', message: 'missing x-dsh-xiaozhi header' } })
      return false
    }
    return true
  }

  function publicDevice(device) {
    return {
      deviceId: device.deviceId,
      // 绑定的智能体；空串 = 未绑定（旧数据在启动迁移时补上）。
      agentId: device.agentId ?? '',
      nickName: device.nickName,
      blocked: device.blocked,
      notes: device.notes,
      online: hub.has(device.deviceId),
      lastIp: device.lastIp,
      lastSeenAt: device.lastSeenAt,
      lastConnectedAt: device.lastConnectedAt,
      connectionCount: device.connectionCount,
      overrides: device.overrides ?? {},
      firmwareVersion: device.firmwareVersion ?? '',
      otaEnabled: device.otaEnabled !== false,
      createdAt: device.createdAt,
    }
  }

  /**
   * 设置面板要知道「留空 = 沿用插件配置」到底用的是哪份值，所以把 Loader 里的
   * 人设与静音收口随 settings 一起下发，只作占位提示，不是可写字段。
   */
  function settingsPayload() {
    return {
      settings: settings.snapshot(),
      defaults: {
        systemPrompt: defaults?.systemPrompt ?? '',
        silenceMs: defaults?.silenceMs ?? null,
      },
    }
  }

  function deviceIdOf(body) {
    const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.trim() : ''
    if (!deviceId) throw Object.assign(new Error('deviceId is required'), { status: 400 })
    return deviceId
  }

  /**
   * 智能体视图：配置 + 绑定设备 + 聚合出来的在线/最近在线。
   *
   * 卡片是智能体（配置单位），设备只是它的成员：一台智能体可以绑多块表，
   * 在线状态看任意一台是否连着，最近在线取绑定设备里最新的那个。
   */
  function publicAgent(agent) {
    const devices = store.listByAgent(agent.id)
    return {
      id: agent.id,
      name: agent.name,
      overrides: agent.overrides ?? {},
      memoryEnabled: agent.memoryEnabled !== false,
      toolDisabled: agent.toolDisabled ?? [],
      devices: devices.map(publicDevice),
      deviceCount: devices.length,
      online: devices.some((device) => hub.has(device.deviceId)),
      lastSeenAt: devices.reduce((latest, device) => Math.max(latest, device.lastSeenAt || 0), 0),
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    }
  }

  function agentIdOf(body) {
    const agentId = typeof body?.agentId === 'string' ? body.agentId.trim() : ''
    if (!agentId) throw Object.assign(new Error('agentId is required'), { status: 400 })
    return agentId
  }

  /** 设备 → 智能体；未绑定或智能体不存在时返回 null。 */
  function agentOfDevice(deviceId) {
    const device = store.get(String(deviceId ?? ''))
    if (!device?.agentId) return null
    return agents?.get(device.agentId) ?? null
  }

  /**
   * 记忆/工具这类「智能体级」操作的键：优先 `agentId`，兼容旧调用传 `deviceId`
   * （按设备的绑定关系反查智能体）。返回空串表示两边都没给。
   */
  function agentIdFrom(body) {
    const direct = typeof body?.agentId === 'string' ? body.agentId.trim() : ''
    if (direct) return direct
    const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.trim() : ''
    return agentOfDevice(deviceId)?.id ?? ''
  }

  /** 请求体里的智能体配置覆盖（人设/模型/音色/语种/语速/静音），与旧 /devices/config 同规则。 */
  function overridePatchOf(body) {
    const patch = {}
    if (typeof body.systemPrompt === 'string') patch.systemPrompt = body.systemPrompt.trim().slice(0, 2000)
    if (typeof body.voice === 'string') patch.voice = body.voice.trim().slice(0, 120)
    // 语种会被拼进系统提示词，只放白名单值；不在名单里的一律当“跟随音色”。
    if (typeof body.language === 'string') patch.language = normalizeOutputLanguage(body.language)
    if (typeof body.model === 'string') patch.model = body.model.trim().slice(0, 120)
    if (body.speed !== undefined) patch.speed = Number(body.speed)
    if (body.silenceMs !== undefined) patch.silenceMs = Number(body.silenceMs)
    return patch
  }

  async function handle(req, res) {
    await ready
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith(CONTROL_PREFIX)) {
      sendJson(res, 404, { error: { code: 'not-found', message: 'not a dsh-xiaozhi route' } })
      return
    }
    const path = url.pathname.slice(CONTROL_PREFIX.length).replace(/\/+$/, '') || '/'
    const method = req.method ?? 'GET'

    // Every route runs under the crash guard so a fatal error names the endpoint
    // that produced it instead of taking the whole Harness down silently.
    if (crashGuard?.track) {
      return crashGuard.track(`${method} ${path}`, () => dispatch(req, res, method, path, url))
    }
    return dispatch(req, res, method, path, url)
  }

  async function dispatch(req, res, method, path, url) {

    if (method === 'GET' && path === '/state') {
      const gateway = gatewayRef?.current
      // Real addresses instead of a placeholder: the operator copies these into
      // the watch's Wi-Fi portal, so they must be reachable exactly as shown.
      const addresses = listLanAddresses()
      const lanIp = addresses[0]?.ip ?? ''
      const host = lanIp || config.host
      const port = config.port
      sendJson(res, 200, {
        version: 3,
        onboarding: { autoProvision: config.onboarding.autoProvision, mode: 'lan' },
        addresses,
        endpoints: {
          lanWsUrl: config.endpoints.lanWsUrl,
          wanWsUrl: config.endpoints.wanWsUrl,
          hasToken: Boolean(config.endpoints.token),
          otaPath: '/xiaozhi/ota/',
          lanIp,
          otaUrl: `http://${host}:${port}/xiaozhi/ota/`,
          wsUrl: config.endpoints.lanWsUrl || `ws://${host}:${port}/xiaozhi/v1/`,
          gatewayUrl: `http://${host}:${port}`,
        },
        listener: { host: config.host, port },
        gateway: gateway ? gateway.describe() : { enabled: false, commands: 0 },
        voice: { enabled: Boolean(voice?.enabled) },
        devices: store.list().map(publicDevice),
        // 控制台的「智能体」页直接用这份快照（卡片 = 智能体，设备是成员）。
        agents: (agents?.list() ?? []).map(publicAgent),
        connections: hub.size,
      })
      return
    }

    if (method === 'GET' && path === '/devices') {
      sendJson(res, 200, { devices: store.list().map(publicDevice) })
      return
    }

    // --------------------------------------------------------------- 智能体（agent）
    // 卡片 = 智能体（配置单位），设备是它的成员：一台智能体可以绑定多台设备。
    // 对齐参考服务端 /agent（CRUD）与 /device/bind（绑定/解绑）。

    if ((path === '/agents' || path.startsWith('/agents/')) && !agents) {
      sendJson(res, 500, { error: { code: 'agent-store-missing', message: '智能体存储未装配' } })
      return
    }

    if (method === 'GET' && path === '/agents') {
      sendJson(res, 200, { agents: (agents?.list() ?? []).map(publicAgent) })
      return
    }

    if (method === 'POST' && path === '/agents') {
      if (!requireTrustedMutation(req, res)) return
      const body = await readJson(req)
      if (!agents) { sendJson(res, 500, { error: { code: 'agent-store-missing', message: '智能体存储未装配' } }); return }
      const agent = await agents.create({ name: body.name, overrides: overridePatchOf(body) })
      logger.info?.(`dsh-xiaozhi: agent ${agent.name || agent.id} created`)
      sendJson(res, 200, { agent: publicAgent(agent) })
      return
    }

    if (method === 'POST' && path === '/agents/update') {
      if (!requireTrustedMutation(req, res)) return
      const body = await readJson(req)
      const agentId = agentIdOf(body)
      const hostProvider = typeof body.hostProvider === 'string' ? body.hostProvider.trim().slice(0, 64) : undefined
      if (hostProvider) {
        // 历史字段：只接受当前 profile 已注册的 Harness 厂商；空串 = 删除覆盖。
        const issue = hostProviderIssue(hostProvider, llm)
        if (issue) {
          sendJson(res, 400, { error: { code: 'invalid-host-provider', message: issue } })
          return
        }
      }
      const overrides = overridePatchOf(body)
      if (hostProvider !== undefined) overrides.hostProvider = hostProvider
      const agent = await agents.update({
        agentId,
        name: typeof body.name === 'string' ? body.name : undefined,
        overrides,
      })
      sendJson(res, 200, { agent: publicAgent(agent) })
      return
    }

    if (method === 'POST' && path === '/agents/bind') {
      if (!requireTrustedMutation(req, res)) return
      const body = await readJson(req)
      const agentId = agentIdOf(body)
      const deviceId = deviceIdOf(body)
      if (!agents.get(agentId)) {
        sendJson(res, 404, { error: { code: 'agent-not-found', message: '智能体不存在' } })
        return
      }
      if (!store.get(deviceId)) {
        sendJson(res, 404, { error: { code: 'device-not-found', message: '设备不存在' } })
        return
      }
      const device = await store.setAgentId({ deviceId, agentId })
      logger.info?.(`dsh-xiaozhi: device ${deviceId} bound to agent ${agentId}`)
      sendJson(res, 200, { agent: publicAgent(agents.get(agentId)), device: publicDevice(device) })
      return
    }

    if (method === 'POST' && path === '/agents/unbind') {
      if (!requireTrustedMutation(req, res)) return
      const body = await readJson(req)
      const agentId = agentIdOf(body)
      const deviceId = deviceIdOf(body)
      const device = store.get(deviceId)
      if (!device) {
        sendJson(res, 404, { error: { code: 'device-not-found', message: '设备不存在' } })
        return
      }
      if (device.agentId && device.agentId !== agentId) {
        sendJson(res, 400, { error: { code: 'not-bound', message: '该设备不属于这个智能体' } })
        return
      }
      const updated = await store.setAgentId({ deviceId, agentId: '' })
      logger.info?.(`dsh-xiaozhi: device ${deviceId} unbound from agent ${agentId}`)
      sendJson(res, 200, { agent: agents.get(agentId) ? publicAgent(agents.get(agentId)) : null, device: publicDevice(updated) })
      return
    }

    if (method === 'POST' && path === '/agents/remove') {
      if (!requireTrustedMutation(req, res)) return
      const body = await readJson(req)
      const agentId = agentIdOf(body)
      const agent = agents.get(agentId)
      if (!agent) {
        sendJson(res, 404, { error: { code: 'agent-not-found', message: '智能体不存在' } })
        return
      }
      // 与参考服务端 deleteAgent 一致：删智能体级联删绑定设备（连同历史与记忆）。
      const bound = store.listByAgent(agentId)
      for (const device of bound) {
        hub.evict(device.deviceId, 'agent removed by operator')
        await history?.clearDevice?.(device.deviceId)
        await store.remove({ deviceId: device.deviceId })
      }
      await memory?.forget?.(agentId)
      await agents.remove({ agentId })
      logger.info?.(`dsh-xiaozhi: agent ${agent.name || agentId} removed with ${bound.length} device(s)`)
      sendJson(res, 200, { agentId, removed: true, removedDevices: bound.length })
      return
    }

    if (method === 'POST' && path === '/crashes/report') {
      const body = await readJson(req, 64 * 1024).catch(() => ({}))
      await crashGuard?.report?.('client-error', body.message ?? 'client error', {
        stack: String(body.stack ?? '').slice(0, 4000),
        source: String(body.source ?? '').slice(0, 300),
        line: body.line,
        column: body.column,
      })
      sendJson(res, 200, { ok: true })
      return
    }

    if (method === 'POST' && path === '/devices/config') {
      // 兼容入口：配置已经属于智能体，这里按设备的绑定关系反查智能体后写同一份配置。
      // 新控制台用 /agents/update；旧脚本/旧页面调这个也不会 404。
      const body = await readJson(req)
      const deviceId = String(body.deviceId ?? '').trim()
      if (!deviceId) { sendJson(res, 400, { error: { code: 'device-required', message: '需要 deviceId' } }); return }
      const agent = agentOfDevice(deviceId)
      if (!agent) {
        // 兼容：没有智能体存储（嵌入/旧测试）或设备还没绑定 → 退回设备级覆盖，
        // 行为与升级前完全一致；真实运行里启动迁移已经把每台旧设备各建了一个智能体。
        const device = await store.setOverrides({ deviceId, patch: overridePatchOf(body) })
        sendJson(res, 200, { device: publicDevice(device) })
        return
      }
      const overrides = overridePatchOf(body)
      if (typeof body.hostProvider === 'string') {
        const hostProvider = body.hostProvider.trim().slice(0, 64)
        // 设备级覆盖同样只接受当前 profile 已注册的 Harness 厂商；空串 = 删除覆盖。
        if (hostProvider) {
          const issue = hostProviderIssue(hostProvider, llm)
          if (issue) {
            sendJson(res, 400, { error: { code: 'invalid-host-provider', message: issue } })
            return
          }
        }
        overrides.hostProvider = hostProvider
      }
      const updated = await agents.update({ agentId: agent.id, overrides })
      sendJson(res, 200, { agent: publicAgent(updated), device: publicDevice(store.get(deviceId)) })
      return
    }
    if (method === 'GET' && path === '/history') {
      const deviceId = String(url.searchParams.get('deviceId') ?? '')
      if (!deviceId) { sendJson(res, 400, { error: { code: 'device-required', message: '需要 deviceId' } }); return }
      const limit = Number(url.searchParams.get('limit') ?? 50)
      sendJson(res, 200, { deviceId, entries: await history.list(deviceId, limit) })
      return
    }

    // ------------------------------------------------ 历史对话 v2（会话/消息/音频）
    // GET 开放（控制台本来就只有本机能打开，且音频不能带自定义头——<audio> 拿不到
    // CSRF header）；写接口照旧 requireTrustedMutation。

    // 智能体的历史对话 = 它绑定的所有设备的会话，按最后一条消息时间倒序合并。
    // 每条带 `deviceId` / `deviceName`，详情仍走单设备的 /history/conversation。
    if (method === 'GET' && path === '/history/agent-conversations') {
      const agentId = String(url.searchParams.get('agentId') ?? '').trim()
      if (!agentId) { sendJson(res, 400, { error: { code: 'agent-required', message: '需要 agentId' } }); return }
      const limit = Number(url.searchParams.get('limit') ?? 50)
      const merged = []
      if (history?.listConversations) {
        for (const device of store.listByAgent(agentId)) {
          const conversations = await history.listConversations(device.deviceId, limit)
          for (const conversation of conversations) {
            merged.push({
              ...conversation,
              deviceId: device.deviceId,
              deviceName: device.nickName || device.deviceId,
            })
          }
        }
      }
      merged.sort((left, right) => (right.endedAt ?? 0) - (left.endedAt ?? 0))
      const bounded = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 200)) : 50
      sendJson(res, 200, { agentId, conversations: merged.slice(0, bounded) })
      return
    }

    if (method === 'GET' && path === '/history/conversations') {
      const deviceId = String(url.searchParams.get('deviceId') ?? '').trim()
      if (!deviceId) { sendJson(res, 400, { error: { code: 'device-required', message: '需要 deviceId' } }); return }
      if (!history?.listConversations) {
        sendJson(res, 200, { deviceId, conversations: [] })
        return
      }
      const limit = Number(url.searchParams.get('limit') ?? 50)
      sendJson(res, 200, { deviceId, conversations: await history.listConversations(deviceId, limit) })
      return
    }

    if (method === 'GET' && path === '/history/conversation') {
      const deviceId = String(url.searchParams.get('deviceId') ?? '').trim()
      if (!deviceId) { sendJson(res, 400, { error: { code: 'device-required', message: '需要 deviceId' } }); return }
      const sessionId = String(url.searchParams.get('sessionId') ?? '').trim()
      if (!sessionId) {
        sendJson(res, 400, { error: { code: 'session-required', message: '需要 sessionId' } })
        return
      }
      const conversation = history?.getConversation ? await history.getConversation(deviceId, sessionId) : null
      if (!conversation) {
        // 契约：找不到不是错误（控制台刚清空/刚刷新时很常见），found:false 即可。
        sendJson(res, 200, {
          deviceId,
          found: false,
          sessionId,
          title: '',
          startedAt: null,
          endedAt: null,
          messages: [],
        })
        return
      }
      sendJson(res, 200, { deviceId, found: true, ...conversation })
      return
    }

    if (method === 'GET' && path === '/history/audio') {
      const deviceId = String(url.searchParams.get('deviceId') ?? '').trim()
      if (!deviceId) { sendJson(res, 400, { error: { code: 'device-required', message: '需要 deviceId' } }); return }
      const audioId = String(url.searchParams.get('audioId') ?? '').trim()
      // audioId 直接进文件名：只允许 [A-Za-z0-9]，`../x` 这类一律 400（不是 404，
      // 让调用方知道是参数非法而不是音频被清理了）。
      if (!/^[A-Za-z0-9]+$/.test(audioId)) {
        sendJson(res, 400, { error: { code: 'invalid-audio-id', message: 'audioId 不合法' } })
        return
      }
      const audio = history?.readAudio ? await history.readAudio(deviceId, audioId) : null
      if (!audio) {
        sendJson(res, 404, { error: { code: 'audio-not-found', message: '音频不存在或已过期' } })
        return
      }
      const safeDevice = deviceId.replace(/[^A-Za-z0-9._-]/g, '-') || 'device'
      try {
        res.writeHead(200, {
          'content-type': 'audio/wav',
          'content-length': audio.size,
          // inline 而不是 attachment：控制台用 <audio> 直接播放，attachment 在部分浏览器里
          // 会被当成下载处理（表现为点 ▶ 没声音）；下载按钮走同源 <a download>，不受影响。
          'content-disposition': `inline; filename="dsh-xiaozhi-${safeDevice}-${audioId}.wav"`,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        })
        const stream = createReadStream(audio.file)
        stream.on('error', () => res.destroy())
        stream.pipe(res)
      } catch (error) {
        if (!res.headersSent) {
          sendJson(res, 500, { error: { code: 'audio-read-failed', message: '音频读取失败' } })
        } else {
          res.destroy()
        }
      }
      return
    }

    if (method === 'POST' && path === '/history/clear') {
      if (!requireTrustedMutation(req, res)) return
      const body = await readJson(req)
      const deviceId = String(body.deviceId ?? '').trim()
      if (!deviceId) { sendJson(res, 400, { error: { code: 'device-required', message: '需要 deviceId' } }); return }
      const sessionId = String(body.sessionId ?? '').trim()
      if (sessionId && history?.clearConversation) {
        const result = await history.clearConversation(deviceId, sessionId)
        sendJson(res, 200, { deviceId, sessionId, cleared: true, ...result, entries: [] })
        return
      }
      const result = (await history?.clearDevice?.(deviceId)) ?? (await history?.clear?.(deviceId)) ?? {}
      sendJson(res, 200, { deviceId, cleared: true, ...result, entries: [] })
      return
    }
    // 记忆属于智能体（2026-11-08）：优先 `agentId`，兼容传 `deviceId`（按绑定关系反查）。
    if (method === 'GET' && path === '/memory') {
      const key = agentIdFrom({ agentId: url.searchParams.get('agentId'), deviceId: url.searchParams.get('deviceId') })
      if (!key) { sendJson(res, 400, { error: { code: 'agent-required', message: '需要 agentId（或已绑定的 deviceId）' } }); return }
      const summary = await memory.summary(key)
      sendJson(res, 200, { agentId: key, facts: summary.facts, turns: summary.turns })
      return
    }

    if (method === 'POST' && path === '/memory/add') {
      const body = await readJson(req)
      const key = agentIdFrom(body)
      const value = String(body.value ?? '').trim()
      if (!key || !value) { sendJson(res, 400, { error: { code: 'invalid', message: '需要 agentId 与内容' } }); return }
      await memory.remember(key, value, String(body.key ?? ''))
      sendJson(res, 200, { agentId: key, facts: (await memory.summary(key)).facts })
      return
    }

    if (method === 'POST' && path === '/memory/remove') {
      const body = await readJson(req)
      const key = agentIdFrom(body)
      if (!key) { sendJson(res, 400, { error: { code: 'agent-required', message: '需要 agentId' } }); return }
      await memory.removeFact(key, Number(body.index ?? -1))
      sendJson(res, 200, { agentId: key, facts: (await memory.summary(key)).facts })
      return
    }

    if (method === 'POST' && path === '/memory/clear') {
      const body = await readJson(req)
      const key = agentIdFrom(body)
      if (!key) { sendJson(res, 400, { error: { code: 'agent-required', message: '需要 agentId' } }); return }
      await memory.forget(key)
      sendJson(res, 200, { agentId: key, facts: [], turns: [] })
      return
    }

    if (method === 'POST' && path === '/memory/enabled') {
      const body = await readJson(req)
      const agentId = agentIdFrom(body)
      if (!agentId) { sendJson(res, 400, { error: { code: 'agent-required', message: '需要 agentId' } }); return }
      const agent = await agents.setMemoryEnabled({ agentId, enabled: body.enabled !== false })
      sendJson(res, 200, { agent: publicAgent(agent) })
      return
    }
    if (method === 'GET' && path === '/llm/providers') {
      if (!llm?.listProviders) { sendJson(res, 200, { available: false, providers: [] }); return }
      const providers = llm.listProviders().map((provider) => ({
        id: provider.id ?? provider.provider ?? '',
        name: provider.name ?? provider.label ?? provider.id ?? '',
      }))
      const requested = String(url.searchParams.get('provider') ?? '').trim()
      let models = []
      if (requested && llm.listModels) {
        try {
          models = (await llm.listModels(requested)).map((model) => ({
            value: model.id ?? model.name ?? '',
            label: model.name ?? model.id ?? '',
          }))
        } catch {
          models = []
        }
      }
      sendJson(res, 200, { available: true, providers, models })
      return
    }
    if (method === 'GET' && path === '/tools') {
      // 扩展能力属于智能体：`agentId` 直接查；兼容旧调用传 `deviceId`（同样解析到智能体）。
      const scope = String(url.searchParams.get('agentId') || url.searchParams.get('deviceId') || '')
      sendJson(res, 200, { agentId: scope, deviceId: scope, tools: tools?.catalog?.(scope) ?? [] })
      return
    }

    if (method === 'POST' && path === '/tools/toggle') {
      const body = await readJson(req)
      const name = String(body.name ?? '').trim()
      if (!name || !tools?.names?.().includes(name)) {
        sendJson(res, 400, { error: { code: 'unknown-tool', message: '工具不存在' } })
        return
      }
      const agentId = agentIdFrom(body)
      if (!agentId) {
        sendJson(res, 400, { error: { code: 'agent-required', message: '需要 agentId（或已绑定的 deviceId）' } })
        return
      }
      await agents.setToolEnabled({ agentId, name, enabled: body.enabled !== false })
      sendJson(res, 200, { agentId, tools: tools.catalog(agentId) })
      return
    }

    if (method === 'GET' && path === '/asr/local') {
      const speech = speechToText
      sendJson(res, 200, { available: Boolean(speech?.transcribe), providers: localProviders(speech) })
      return
    }

    /**
     * 模型清单：**只从厂商 `GET /v1/models` 拉**，不在插件里内置模型 id。
     *
     * GET  `/models?kind=llm&provider=mimo&source=primary|backup&index=N`
     *   - 用**已保存**的 provider/baseUrl/apiKey（备用条目按 source+index 取）；
     *   - 没保存过 Key 时返回空列表，前端退回文本框。
     * POST `/models` `{kind, provider, baseUrl?, apiKey?}`
     *   - 给「弹窗里刚填了 Key、还没保存」的场景做即时预览：Key 放请求体（不进 URL/日志），
     *     不落库、不缓存失败结果。
     */
    if (method === 'GET' && path === '/models') {
      const kind = String(url.searchParams.get('kind') ?? 'llm')
      const providerParam = String(url.searchParams.get('provider') ?? '').trim()
      const source = String(url.searchParams.get('source') ?? 'primary')
      const index = Number(url.searchParams.get('index') ?? 0)
      const stage = kind.startsWith('tts') ? 'tts' : 'llm'
      const snapshot = settings.snapshot().voice[stage]
      const loaded = settings.state.voice[stage] ?? {}
      const entry =
        source === 'backup' && Number.isInteger(index) && index >= 0
          ? (Array.isArray(loaded.backups) ? loaded.backups[index] : null)
          : loaded
      const provider = providerParam || snapshot.provider || ''
      const preset = stage === 'llm' ? openAiCompatiblePreset(provider) : null
      const result = await modelsFor({
        kind,
        provider,
        // 已保存的 baseUrl 优先；空则用厂商预设（MiMo 这类不填 baseUrl 也能拉模型列表）。
        baseUrl: entry?.baseUrl || preset?.baseUrl || '',
        apiKey: stage === 'tts' ? loaded.apiKey : entry?.apiKey ?? '',
        authStyle: preset?.authStyle ?? 'bearer',
      })
      sendJson(res, 200, result)
      return
    }

    if (method === 'POST' && path === '/models') {
      if (!requireTrustedMutation(req, res)) return
      const body = await readJson(req)
      const kind = String(body.kind ?? 'llm')
      const provider = String(body.provider ?? '').trim()
      const preset = kind.startsWith('tts') ? null : openAiCompatiblePreset(provider)
      const result = await modelsFor({
        kind,
        provider,
        baseUrl:
          (typeof body.baseUrl === 'string' && body.baseUrl.trim()) || preset?.baseUrl || '',
        apiKey: typeof body.apiKey === 'string' ? body.apiKey.trim() : '',
        authStyle: preset?.authStyle ?? 'bearer',
      })
      sendJson(res, 200, result)
      return
    }

    if (method === 'GET' && path === '/voices') {
      const options = {}
      for (const provider of ['edge', 'xunfei', 'volc']) options[provider] = voiceOptionsFor(provider)
      sendJson(res, 200, { options })
      return
    }

    if (method === 'GET' && path === '/crashes') {
      const entries = (await crashGuard?.tail?.(50)) ?? []
      sendJson(res, 200, { path: crashGuard?.logPath?.() ?? '', entries })
      return
    }

    if (method === 'GET' && path === '/events') {
      sendJson(res, 200, { events: hub.recentEvents(50) })
      return
    }

    // --------------------------------------------------------------- admin API

    if (method === 'GET' && path === '/settings') {
      sendJson(res, 200, settingsPayload())
      return
    }

    if (method === 'POST' && path === '/settings') {
      if (!requireTrustedMutation(req, res)) return
      const body = await readJson(req)
      // provider="host" 的 hostProvider 是 DSH 自己的厂商 id，必须与当前 profile
      // 注册的 LLM 适配器一致；否则坏值会先落盘，等用户说完第一句话才以
      // `no adapter registered for provider "..."` 失败（设备停在「聆听中」）。
      // 在保存边界直接 400，面板能当场看到原因与可用厂商。
      const llmPatch = body?.voice?.llm && typeof body.voice.llm === 'object' ? body.voice.llm : null
      if (llmPatch) {
        const provider =
          typeof llmPatch.provider === 'string'
            ? llmPatch.provider.trim()
            : settings.state.voice.llm.provider
        const hostProvider =
          typeof llmPatch.hostProvider === 'string'
            ? llmPatch.hostProvider.trim()
            : settings.state.voice.llm.hostProvider
        if (provider === 'host') {
          const issue = hostProviderIssue(hostProvider, llm)
          if (issue) {
            sendJson(res, 400, { error: { code: 'invalid-host-provider', message: issue } })
            return
          }
        }
      }
      await settings.update(body)
      onSettingsChanged?.()
      sendJson(res, 200, settingsPayload())
      return
    }
    if (method === 'POST' && path === '/probe/ota') {
      if (!requireTrustedMutation(req, res)) return
      const started = clock()
      try {
        const response = await fetch(`http://127.0.0.1:${config.port}/xiaozhi/ota/`, {
          method: 'POST',
          headers: {
            'Device-Id': '02:00:00:00:00:FF',
            'Client-Id': '00000000-0000-4000-8000-0000000000ff',
            'X-Real-IP': '127.0.0.1',
          },
        })
        const text = await response.text()
        let body
        try {
          body = JSON.parse(text)
        } catch {
          body = text
        }
        sendJson(res, 200, { ok: response.ok, status: response.status, ms: clock() - started, body })
      } catch (error) {
        sendJson(res, 200, { ok: false, status: 0, ms: clock() - started, error: error.message })
      }
      return
    }

    if (method === 'POST' && path === '/test/llm') {
      if (!requireTrustedMutation(req, res)) return
      if (typeof probeLlm !== 'function') {
        sendJson(res, 409, { error: { code: 'voice-off', message: '语音未启用，无法测试模型' } })
        return
      }
      const started = clock()
      try {
        const result = await probeLlm('用一句话介绍你自己')
        sendJson(res, 200, { ok: true, ms: clock() - started, ...result })
      } catch (error) {
        sendJson(res, 200, { ok: false, ms: clock() - started, error: error.message })
      }
      return
    }

    // 控制台「备用服务商」逐条测试：只测**已保存**的配置（新填的 Key 先保存再测），
    // 明文密钥不出浏览器。ASR 不在这里特判——由注入的 probeProvider 自己回答
    // 「暂不支持在线测试」，两个地方就不必各维护一份能力清单。
    if (method === 'POST' && path === '/test/provider') {
      if (!requireTrustedMutation(req, res)) return
      if (typeof probeProvider !== 'function') {
        sendJson(res, 409, { error: { code: 'voice-off', message: '语音未启用，无法测试服务商' } })
        return
      }
      const body = await readJson(req)
      const kind = String(body.kind ?? 'llm').trim()
      if (!['llm', 'tts', 'asr'].includes(kind)) {
        sendJson(res, 400, { error: { code: 'invalid', message: 'kind 只能是 llm / tts / asr' } })
        return
      }
      const source = String(body.source ?? 'primary').trim()
      if (source !== 'primary' && source !== 'backup') {
        sendJson(res, 400, { error: { code: 'invalid', message: 'source 只能是 primary 或 backup' } })
        return
      }
      const index = body.index === undefined || body.index === null ? 0 : Number(body.index)
      if (!Number.isInteger(index) || index < 0) {
        sendJson(res, 400, { error: { code: 'invalid', message: 'index 必须是非负整数' } })
        return
      }
      const started = clock()
      try {
        const result = await probeProvider({ kind, source, index })
        // Business result stays in the body with HTTP 200, same contract as /test/llm:
        // the console shows "the provider said no", not "the request never arrived".
        sendJson(res, 200, { ok: true, ms: clock() - started, ...result })
      } catch (error) {
        sendJson(res, 200, { ok: false, ms: clock() - started, error: error.message })
      }
      return
    }

    if (method === 'POST' && path === '/devices/ota') {
      const body = await readJson(req)
      const device = await store.setOtaEnabled({ deviceId: String(body.deviceId ?? ''), enabled: body.enabled !== false })
      sendJson(res, 200, { device: publicDevice(device) })
      return
    }

    if (method === 'POST' && path === '/devices/rename') {
      if (!requireTrustedMutation(req, res)) return
      const body = await readJson(req)
      const device = await store.rename({ deviceId: deviceIdOf(body), nickName: body.nickName })
      sendJson(res, 200, { device: publicDevice(device) })
      return
    }

    if (method === 'POST' && path === '/devices/settings') {
      if (!requireTrustedMutation(req, res)) return
      const body = await readJson(req)
      const deviceId = deviceIdOf(body)
      const device = await store.updateSettings({
        deviceId,
        nickName: body.nickName,
        notes: body.notes,
      })
      sendJson(res, 200, { device: publicDevice(device) })
      return
    }

    if (method === 'POST' && path === '/devices/block') {
      if (!requireTrustedMutation(req, res)) return
      const body = await readJson(req)
      const deviceId = deviceIdOf(body)
      const blocked = body.blocked !== false
      if (blocked) hub.evict(deviceId, 'blocked by operator')
      const device = await store.setBlocked({ deviceId, blocked })
      logger.info?.(`dsh-xiaozhi: device ${deviceId} ${blocked ? 'blocked' : 'unblocked'} by operator`)
      sendJson(res, 200, { device: publicDevice(device) })
      return
    }

    if (method === 'POST' && path === '/devices/disconnect') {
      if (!requireTrustedMutation(req, res)) return
      const body = await readJson(req)
      const deviceId = deviceIdOf(body)
      sendJson(res, 200, { deviceId, disconnected: hub.evict(deviceId, 'disconnected by operator') })
      return
    }

    if (method === 'POST' && path === '/devices/remove') {
      if (!requireTrustedMutation(req, res)) return
      const body = await readJson(req)
      const deviceId = deviceIdOf(body)
      hub.evict(deviceId, 'record removed by operator')
      await store.remove({ deviceId })
      sendJson(res, 200, { deviceId, removed: true })
      return
    }

    if (method === 'POST' && path === '/devices/inject') {
      if (!requireTrustedMutation(req, res)) return
      const body = await readJson(req)
      const deviceId = deviceIdOf(body)
      const text = String(body.text ?? '').trim()
      if (!text) {
        sendJson(res, 400, { error: { code: 'text-required', message: '请输入要朗读的文本' } })
        return
      }
      const session = hub.get(deviceId)
      if (!session) {
        sendJson(res, 409, { error: { code: 'offline', message: '设备不在线' } })
        return
      }
      if (!session.voice?.speak) {
        sendJson(res, 409, { error: { code: 'voice-off', message: '该会话没有语音管道，无法下发' } })
        return
      }
      try {
        await session.voice.speak(text.slice(0, 500))
      } catch (error) {
        sendJson(res, 500, { error: { code: 'inject-failed', message: error.message } })
        return
      }
      logger.info?.(`dsh-xiaozhi: injected ${text.length} chars into ${deviceId}`)
      sendJson(res, 200, { ok: true, deviceId, deliveredAt: clock() })
      return
    }

    sendJson(res, 404, { error: { code: 'not-found', message: `no route for ${method} ${path}` } })
  }

  return {
    prefix: CONTROL_PREFIX,
    ready,
    handler(req, res) {
      handle(req, res).catch((error) => {
        const status = statusOf(error)
        if (status >= 500) logger.error?.(`dsh-xiaozhi: control request failed: ${error.stack ?? error.message}`)
        sendJson(res, status, {
          error: {
            code: error.code ?? (status >= 500 ? 'internal' : 'bad-request'),
            message: status >= 500 ? 'internal error' : error.message,
          },
        })
      })
    },
  }
}

export { CONTROL_PREFIX }
