/**
 * The device connection registry.
 *
 * One device owns at most one live session. ESP32 boards drop off a network
 * without closing TCP, so a reconnect routinely arrives while the old socket is
 * still half-open; the new connection must win deterministically and the old one
 * must be destroyed, or the device ends up split-brain between two sessions.
 *
 * Two details make that safe:
 *   - `register` swaps the map entry first and evicts the previous session
 *     afterwards, so no window exists in which the map is empty.
 *   - `unregister` compares identity, not just the device id, so a late close
 *     callback from an evicted socket cannot remove its replacement.
 */

export class ConnectionHub {
  /**
   * @param {object} options
   * @param {{ info?: Function, warn?: Function }} [options.logger]
   * @param {(event: object) => void} [options.onEvent] observer for the console feed
   */
  constructor({ logger, onEvent } = {}) {
    this.logger = logger ?? {}
    this.onEvent = onEvent ?? (() => {})
    this.sessions = new Map()
    this.feed = []
  }

  get size() {
    return this.sessions.size
  }

  has(deviceId) {
    return this.sessions.has(deviceId)
  }

  get(deviceId) {
    return this.sessions.get(deviceId)
  }

  list() {
    return [...this.sessions.values()]
  }

  /** Atomically install `session` as the device's only connection. */
  register(session) {
    const previous = this.sessions.get(session.deviceId)
    this.sessions.set(session.deviceId, session)
    if (previous && previous !== session) {
      this.logger.warn?.(
        `dsh-xiaozhi: device ${session.deviceId} reconnected; evicting session ${previous.id}`,
      )
      this.#record({
        type: 'replaced',
        deviceId: session.deviceId,
        sessionId: session.id,
        previousSessionId: previous.id,
      })
      try {
        previous.evict('replaced by a newer connection')
      } catch (error) {
        this.logger.warn?.(`dsh-xiaozhi: failed to evict session ${previous.id}: ${error.message}`)
      }
    }
    this.#record({
      type: 'online',
      deviceId: session.deviceId,
      sessionId: session.id,
      remoteIp: session.remoteIp,
      replaced: Boolean(previous && previous !== session),
    })
    return { previous }
  }

  /**
   * Remove `session` only when it is still the current one.
   * @returns {boolean} whether the registry actually changed
   */
  unregister(deviceId, session) {
    if (this.sessions.get(deviceId) !== session) return false
    this.sessions.delete(deviceId)
    this.#record({ type: 'offline', deviceId, sessionId: session.id })
    return true
  }

  /** Close sessions that have been silent longer than `idleMs`. */
  sweep(idleMs, now = Date.now()) {
    const evicted = []
    for (const session of this.list()) {
      if (now - session.lastSeenAt <= idleMs) continue
      this.logger.warn?.(`dsh-xiaozhi: closing idle session ${session.id} of ${session.deviceId}`)
      try {
        session.evict('heartbeat timeout', 1001)
      } catch {
        // A session that cannot be evicted is already gone.
      }
      evicted.push(session)
    }
    return evicted
  }

  /** Force-close one device's session (operator action). */
  evict(deviceId, reason = 'closed by operator') {
    const session = this.sessions.get(deviceId)
    if (!session) return false
    session.evict(reason, 1001)
    return true
  }

  dispose() {
    for (const session of this.list()) {
      try {
        session.evict('server shutting down', 1001)
      } catch {
        // Shutdown must not be blocked by one bad socket.
      }
    }
    this.sessions.clear()
  }

  recentEvents(limit = 50) {
    return this.feed.slice(-limit)
  }

  #record(event) {
    const entry = { at: Date.now(), ...event }
    this.feed.push(entry)
    if (this.feed.length > 200) this.feed.splice(0, this.feed.length - 200)
    try {
      this.onEvent(entry)
    } catch {
      // Observers are advisory: a console that throws must not break the hub.
    }
  }
}
