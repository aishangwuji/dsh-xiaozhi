/**
 * The device-facing ingress: OTA bootstrap, the WebSocket gate, and the
 * device-side gateway the watch calls to act on this machine.
 *
 * Onboarding is device-driven, not operator-driven: the watch is configured
 * through its own Wi-Fi portal with this server's OTA URL (`ota_url`), so the
 * first OTA poll is the registration event. There is no code to read out and no
 * approval step; what the operator keeps is the ability to rename, block, or
 * forget a device afterwards.
 *
 * This listener is separate from the Harness Web UI on purpose. The UI binds to
 * loopback and is for the human; this one binds to the LAN because an ESP32 has
 * no browser session and no cookie.
 */

import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { clientIp, isPrivateAddress, readFirmwareVersion, readIdentity } from './identity.js'
import { DeviceStoreError } from './store.js'
import { VoiceSession } from './voice/session.js'
import { acceptUpgrade, CLOSE_CODE, rejectUpgrade, UpgradeRejection } from './ws.js'
import { InboundMcpChannel } from './mcp/inbound.js'
import { trace } from './voice/trace.js'

const MAX_JSON_BODY = 16 * 1024
const VERSION = '0.2.0'

function sendJson(res, status, body) {
  if (res.headersSent) {
    res.end()
    return
  }
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(payload)
}

async function readJsonBody(req, limit = MAX_JSON_BODY) {
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
  if (chunks.length === 0) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    const error = new Error('request body must be valid JSON')
    error.status = 400
    throw error
  }
}

function sanitizeAudioParams(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const numeric = (value, fallback, min, max) => {
    const number = Number(value)
    return Number.isFinite(number) && number >= min && number <= max ? Math.round(number) : fallback
  }
  return {
    format: typeof source.format === 'string' && source.format ? source.format : 'opus',
    sample_rate: numeric(source.sample_rate, 24_000, 8_000, 48_000),
    channels: numeric(source.channels, 1, 1, 2),
    frame_duration: numeric(source.frame_duration, 60, 10, 120),
  }
}

export function createIngress({ config, store, hub, logger, inboundMcp, pending, clock = () => Date.now() }) {
  const startedAt = clock()
  const ready = store.load()
  const sessions = new Map()

  /**
   * Which endpoint the device can actually reach.
   *
   * A LAN address handed to a WAN device is unroutable, so the configured URL for
   * the matching scope wins; when it is empty the Host header is echoed back —
   * that host is reachable by definition because the device just used it.
   */
  function resolveEndpoint(req, ip) {
    const lan = isPrivateAddress(ip, config.lanNetworkCidrs)
    const configured = lan ? config.endpoints.lanWsUrl : config.endpoints.wanWsUrl
    if (configured) return { url: configured, scope: lan ? 'lan' : 'wan' }
    const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim()
    const secure = forwardedProto === 'https' || forwardedProto === 'wss'
    const host = String(req.headers.host ?? '').trim()
    if (!host) return { url: configured, scope: 'unresolved' }
    return { url: `${secure ? 'wss' : 'ws'}://${host}/xiaozhi/v1/`, scope: 'derived' }
  }

  async function handleOta(req, res, url) {
    const identity = readIdentity(req, url)
    if (!identity.deviceId || !identity.clientId) {
      sendJson(res, 400, {
        error: {
          code: 'identity-required',
          message: 'missing Device-Id or Client-Id',
          received: { deviceId: Boolean(identity.deviceId), clientId: Boolean(identity.clientId) },
        },
      })
      return
    }
    const ip = clientIp(req)
    let ensured
    try {
      const known = store.get(identity.deviceId)
      if (!known && !config.onboarding.autoProvision) {
        const queued = await pending?.upsert({
          deviceId: identity.deviceId,
          clientId: identity.clientId,
          ip,
          firmwareVersion: readFirmwareVersion(req),
        })
        if (!queued) {
          logger.warn?.(`dsh-xiaozhi: pending queue unavailable/full for ${identity.deviceId}`)
          sendJson(res, 503, {
            error: { code: 'pending-unavailable', message: '设备等待审核，但待审核队列不可用' },
          })
          return
        }
        logger.info?.(`dsh-xiaozhi: device ${identity.deviceId} is pending approval (${ip || 'unknown'})`)
        sendJson(res, 403, {
          error: { code: 'device-pending', message: '设备等待管理员在控制台批准' },
        })
        return
      }
      ensured = await store.ensureDevice({
        firmwareVersion: readFirmwareVersion(req),
        deviceId: identity.deviceId,
        clientId: identity.clientId,
        ip,
        autoProvision: config.onboarding.autoProvision,
      })
    } catch (error) {
      if (error instanceof DeviceStoreError) {
        sendJson(res, 503, { error: { code: error.code, message: error.message } })
        return
      }
      throw error
    }
    const { device, created } = ensured
    if (device.blocked) {
      logger.warn?.(`dsh-xiaozhi: blocked device ${device.deviceId} polled OTA from ${ip || 'unknown'}`)
      sendJson(res, 403, { error: { code: 'device-blocked', message: '设备已被封禁' } })
      return
    }
    if (created) {
      logger.info?.(`dsh-xiaozhi: discovered device ${device.deviceId} at ${ip || 'unknown'}`)
    }
    const endpoint = resolveEndpoint(req, ip)
    const now = clock()
    // 固件按「局域网 → 云端」的顺序试 OTA，这条日志就是判断它到底落在哪一侧的依据：
    // 看到它，说明手表连的是我们；看不到，说明它被云端接走了（OTA 地址不对）。
    logger.info?.(`dsh-xiaozhi: ota ${device.deviceId} from ${ip || 'unknown'} -> ${endpoint.url}`)
    trace('ota.request', { device: device.deviceId, ip: ip || '', url: endpoint.url })
    // No activation block: this server is the operator's own, and the device is
    // onboarded by being pointed at it. Returning `activation` here would put the
    // watch into the cloud console flow, which does not exist on a LAN.
    sendJson(res, 200, {
      websocket: { url: endpoint.url, token: config.endpoints.token },
      server_time: { timestamp: now, timezone_offset: config.timezoneOffset },
      activation: null,
      // 设备级 OTA 开关：关掉后不给 version/url，固件拿到空版本就不会升级
      // （保留字段本身，避免老固件把缺失字段当成协议错误）。
      firmware: ensured.device.otaEnabled === false
        ? { version: '', url: '', force: false }
        : { ...config.firmware },
    })
  }

  /**
   * Compatibility shim: firmware that already holds a challenge (for example
   * after switching it from another server) may still POST here. Activation is
   * not part of this deployment, so the honest answer is "already fine" rather
   * than an error that would strand the device.
   */
  function handleActivate(req, res) {
    sendJson(res, 200, { ok: true, activated: true, message: '本服务不使用激活码，设备可直接连接' })
  }

  async function handleInboundMcpUpgrade(req, socket, head, url) {
    if (!inboundMcp) {
      rejectUpgrade(socket, 503, { error: { code: 'mcp-disabled', message: 'MCP 入站未启用' } })
      return
    }
    const expected = String(config.mcpToken ?? '')
    if (!expected) {
      logger.warn?.('dsh-xiaozhi: rejected /mcp upgrade because mcpToken is empty')
      rejectUpgrade(socket, 503, { error: { code: 'mcp-token-required', message: '未配置 mcpToken' } })
      return
    }
    const token = String(url.searchParams.get('token') ?? '')
    if (token !== expected) {
      logger.warn?.(`dsh-xiaozhi: rejected /mcp upgrade with bad token (${clientIp(req)})`)
      rejectUpgrade(socket, 401, { error: { code: 'mcp-unauthorized', message: 'token 无效' } })
      return
    }
    const agentId = String(url.searchParams.get('agentId') || url.searchParams.get('agent') || 'default').slice(0, 64)
    let connection
    try {
      connection = acceptUpgrade(req, socket, head, { maxPayload: config.maxFrameBytes })
    } catch (error) {
      if (error instanceof UpgradeRejection) rejectUpgrade(socket, error.status, error.body)
      else socket.destroy?.()
      return
    }
    const channel = new InboundMcpChannel({
      send: (text) => connection.sendText(text),
      logger,
    })
    connection.on('message', (payload, isBinary) => {
      if (!isBinary) channel.handleText(payload)
    })
    connection.on('close', () => inboundMcp.remove(agentId))
    logger.info?.(`dsh-xiaozhi: inbound MCP connected agent=${agentId} (${clientIp(req)})`)
    void inboundMcp.add(agentId, channel)
  }

  function handleUpgrade(req, socket, head) {
    void (async () => {
      let url
      try {
        url = new URL(req.url ?? '/', 'http://localhost')
      } catch {
        rejectUpgrade(socket, 400, { error: 'malformed request target' })
        return
      }
      if (url.pathname === '/mcp' || url.pathname === '/mcp/') {
        await handleInboundMcpUpgrade(req, socket, head, url)
        return
      }
      const identity = readIdentity(req, url)
      if (!identity.deviceId) {
        logger.warn?.('dsh-xiaozhi: rejected WebSocket upgrade without Device-Id')
        rejectUpgrade(socket, 400, { error: { code: 'device-id-required', message: 'missing Device-Id' } })
        return
      }
      await ready
      const ip = clientIp(req)
      let device = store.get(identity.deviceId)
      if (!device) {
        if (!config.onboarding.autoProvision) {
          const queued = await pending?.upsert({
            deviceId: identity.deviceId,
            clientId: identity.clientId,
            ip,
            firmwareVersion: readFirmwareVersion(req),
          })
          logger.warn?.(`dsh-xiaozhi: rejected pending device ${identity.deviceId} (${ip})`)
          rejectUpgrade(
            socket,
            queued ? 403 : 503,
            {
              error: {
                code: queued ? 'device-pending' : 'pending-unavailable',
                message: queued ? '设备等待管理员在控制台批准' : '待审核队列不可用',
              },
            },
          )
          return
        }
        const ensured = await store.ensureDevice({
          deviceId: identity.deviceId,
          clientId: identity.clientId,
          ip,
        })
        device = ensured.device
        logger.info?.(`dsh-xiaozhi: device ${device.deviceId} registered on first WebSocket connect`)
      }
      if (device.blocked) {
        logger.warn?.(`dsh-xiaozhi: rejected blocked device ${device.deviceId} (${ip})`)
        rejectUpgrade(socket, 403, { error: { code: 'device-blocked', message: '设备已被封禁' } })
        return
      }

      let connection
      try {
        connection = acceptUpgrade(req, socket, head, { maxPayload: config.maxFrameBytes })
      } catch (error) {
        if (error instanceof UpgradeRejection) {
          rejectUpgrade(socket, error.status, error.body)
        } else {
          logger.error?.(`dsh-xiaozhi: websocket handshake failed: ${error.message}`)
          socket.destroy?.()
        }
        return
      }

      const now = clock()
      const session = {
        id: randomUUID(),
        deviceId: identity.deviceId,
        clientId: identity.clientId,
        remoteIp: ip,
        openedAt: now,
        lastSeenAt: now,
        hello: false,
        audioFrames: 0,
        closed: false,
        frameMs: 60,
        evict(reason, code = CLOSE_CODE.replaced) {
          connection.close(code, reason)
        },
      }
      sessions.set(session.id, session)
      hub.register(session)
      void store.recordConnection({ deviceId: session.deviceId, ip }).catch(() => {})

      // Each connection is built from the device's behaviour profile, so a
      // profile edited in the console applies from the device's next connect.
      let voice = null
      const built = config.voice?.enabled ? config.voice.build?.(device) : null
      if (built) {
        voice = new VoiceSession({
          sink: {
            sendJson: (value) => connection.sendJson(value),
            sendBinary: (value) => connection.sendBinary(value),
          },
          adapters: built.adapters,
          config: built.config,
          deviceId: built.deviceId || session.deviceId,
          // 与控制台历史对话对齐：hello 下发给设备的 session_id 就是历史里的会话 id。
          sessionId: session.id,
          logger,
          createDecoder: config.voice.createDecoder,
          encodeSpeech: config.voice.encodeSpeech,
          onClose: () => {
            if (connection.isOpen) connection.close(CLOSE_CODE.normal, 'exit intent')
          },
        })
        session.voice = voice
        logger.info?.(`dsh-xiaozhi: device ${session.deviceId} voice session ready`)
        try {
          voice.start()
        } catch (error) {
          logger.error?.(`dsh-xiaozhi: voice pipeline failed to start: ${error.message}`)
          voice = null
          session.voice = null
        }
      }

      const helloTimeout = setTimeout(() => {
        if (session.hello || session.closed) return
        logger.warn?.(`dsh-xiaozhi: device ${session.deviceId} never sent hello`)
        connection.close(CLOSE_CODE.protocolError, 'hello timeout')
      }, config.helloTimeoutMs)
      helloTimeout.unref?.()

      const heartbeat = setInterval(() => {
        if (session.closed) return
        const idleFor = clock() - session.lastSeenAt
        if (idleFor > config.idleTimeoutMs) {
          logger.warn?.(`dsh-xiaozhi: device ${session.deviceId} silent for ${idleFor}ms; closing`)
          connection.close(CLOSE_CODE.goingAway, 'heartbeat timeout')
          return
        }
        connection.ping()
      }, config.pingIntervalMs)
      heartbeat.unref?.()

      const finish = (code, reason) => {
        if (session.closed) return
        session.closed = true
        clearTimeout(helloTimeout)
        clearInterval(heartbeat)
        sessions.delete(session.id)
        hub.unregister(session.deviceId, session)
        void session.voice?.close()
        logger.info?.(
          `dsh-xiaozhi: device ${session.deviceId} disconnected (code ${code}${reason ? `, ${reason}` : ''})`,
        )
      }

      connection.on('close', finish)
      connection.on('socket-error', (error) => {
        logger.warn?.(`dsh-xiaozhi: socket error for ${session.deviceId}: ${error.message}`)
      })
      connection.on('message', (data, isBinary) => {
        session.lastSeenAt = clock()
        if (isBinary) {
          session.audioFrames += 1
          session.voice?.handleAudio(data, session.frameMs)
          return
        }
        let message
        try {
          message = JSON.parse(data)
        } catch {
          logger.warn?.(`dsh-xiaozhi: device ${session.deviceId} sent invalid JSON`)
          return
        }
        if (!message || typeof message !== 'object') return
        switch (message.type) {
          case 'hello': {
            session.hello = true
            clearTimeout(helloTimeout)
            session.features = message.features && typeof message.features === 'object' ? message.features : {}
            const audio = sanitizeAudioParams(message.audio_params)
            session.frameMs = audio.frame_duration
            // The reply must announce what *this* server will send, not echo the
            // uplink: the watch otherwise resamples 16k → 24k and reports
            // "resampling may cause distortion" (seen on real hardware).
            const downlink = session.voice?.config
              ? {
                  format: 'opus',
                  sample_rate: session.voice.config.sampleRate.downlink,
                  channels: 1,
                  frame_duration: session.voice.config.frameMs.downlink,
                }
              : audio
            connection.sendJson({
              type: 'hello',
              transport: 'websocket',
              session_id: session.id,
              audio_params: downlink,
            })
            // 官方顺序：先回 hello，再发 MCP initialize / tools/list。
            session.voice?.handleHello?.(session.features)
            logger.info?.(
              `dsh-xiaozhi: device ${session.deviceId} hello v${message.version ?? '?'} ` +
                `(uplink ${audio.format}/${audio.sample_rate}Hz/${audio.frame_duration}ms, ` +
                `downlink ${downlink.format}/${downlink.sample_rate}Hz/${downlink.frame_duration}ms)`,
            )
            return
          }
          case 'mcp':
            session.voice?.handleMcp?.(message.payload)
            return
          case 'iot':
            session.voice?.handleIot?.(message)
            return
          case 'listen':
            session.voice?.handleListen(message)
            return
          case 'abort':
            session.voice?.handleAbort('client abort')
            return
          case 'ping':
            connection.sendJson({ type: 'pong', timestamp: clock() })
            return
          case 'goodbye':
            connection.close(CLOSE_CODE.normal, 'device said goodbye')
            return
          default:
            return
        }
      })
    })().catch((error) => {
      logger.error?.(`dsh-xiaozhi: upgrade handler failed: ${error.message}`)
      try {
        rejectUpgrade(socket, 500, { error: 'internal error' })
      } catch {
        socket.destroy?.()
      }
    })
  }

  async function handleRequest(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    const ip = clientIp(req)

    // The gateway can be re-created from the console (token/commands change), so
    // it is resolved per request through the holder rather than captured.
    const gateway = config.gatewayRef?.current
    if (gateway && (await gateway.handle(req, res, url, ip))) return

    if (path === '/healthz') {
      sendJson(res, 200, {
        ok: true,
        version: VERSION,
        uptimeMs: clock() - startedAt,
        devices: store.size,
        connections: hub.size,
        autoProvision: config.onboarding.autoProvision,
        gateway: config.gatewayRef?.current ? config.gatewayRef.current.describe() : { enabled: false },
        voice: Boolean(config.voice?.enabled && config.voice.build),
      })
      return
    }
    if (req.method === 'GET' || req.method === 'POST') {
      if (path === '/xiaozhi/ota/' || path === '/xiaozhi/ota') {
        await handleOta(req, res, url)
        return
      }
      if (req.method === 'POST' && (path === '/xiaozhi/ota/activate' || path === '/xiaozhi/ota/activate/')) {
        handleActivate(req, res)
        return
      }
    }
    sendJson(res, 404, { error: { code: 'not-found', message: `no route for ${req.method} ${path}` } })
  }

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      logger.error?.(`dsh-xiaozhi: request failed: ${error.stack ?? error.message}`)
      sendJson(res, 500, { error: { code: 'internal', message: 'internal error' } })
    })
  })
  server.on('upgrade', (req, socket, head) => handleUpgrade(req, socket, head))
  server.on('clientError', (error, socket) => {
    logger.warn?.(`dsh-xiaozhi: client error: ${error.message}`)
    try {
      socket.destroy()
    } catch {
      // Already gone.
    }
  })

  return {
    server,
    ready,
    stats: () => ({ devices: store.size, connections: hub.size, uptimeMs: clock() - startedAt }),
    listen() {
      return new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off('listening', onListening)
          reject(error)
        }
        const onListening = () => {
          server.off('error', onError)
          resolve()
        }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(config.port, config.host)
      })
    },
    async close() {
      for (const session of sessions.values()) {
        try {
          session.evict('server shutting down', CLOSE_CODE.goingAway)
        } catch {
          // Best effort during shutdown.
        }
      }
      if (!server.listening) return
      await new Promise((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections?.()
      })
    },
  }
}
