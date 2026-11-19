/**
 * 智能体（配置单位）与设备（物理单位）的契约测试。
 *
 * 覆盖参考服务端的核心语义：
 *   - 一台智能体可以绑定多台设备，绑定是「移动」不是复制；
 *   - 人设/音色/记忆开关/工具开关都在智能体上；
 *   - 删智能体级联删绑定设备（连同历史与记忆），与 deleteAgent 一致；
 *   - 旧版「只有设备」的 devices.json 启动时各建一个智能体，记忆文件复制过去。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentStore, adoptLegacyDevices, nextAgentName } from '../src/agents.js'
import { createControlHandler } from '../src/control.js'
import { createHistoryStore } from '../src/history.js'
import { ConnectionHub } from '../src/hub.js'
import { createMemoryStore } from '../src/memory.js'
import { SettingsStore } from '../src/settings.js'
import { DeviceStore } from '../src/store.js'

const silent = { info() {}, warn() {}, error() {} }
const CONTROL = '/dsh-xiaozhi-7c3a'
const MAC_A = '02:4A:7D:E3:89:BF'
const MAC_B = '02:4A:7D:E3:89:C0'

function headers() {
  return { 'content-type': 'application/json', 'x-dsh-xiaozhi': '1' }
}

async function start({ seedDevices, autoAgent = false, sessions } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-xiaozhi-agents-'))
  if (seedDevices) {
    await writeFile(join(dir, 'devices.json'), JSON.stringify({ version: 2, devices: seedDevices }, null, 2))
  }
  const store = new DeviceStore({ file: join(dir, 'devices.json'), logger: silent })
  const agents = new AgentStore({ file: join(dir, 'agents.json'), logger: silent })
  const memory = createMemoryStore({ dir: join(dir, 'memory') })
  const history = createHistoryStore({ dir: join(dir, 'history'), logger: silent })
  await store.load()
  await agents.load()
  if (autoAgent) {
    store.onCreated = async (device) => {
      if (device.agentId) return
      const agent = await agents.create({ name: nextAgentName(agents) })
      await store.setAgentId({ deviceId: device.deviceId, agentId: agent.id })
      await memory.adopt?.(device.deviceId, agent.id)
    }
  }
  await adoptLegacyDevices({ devices: store, agents, memory, logger: silent })
  const settings = new SettingsStore({ file: join(dir, 'settings.json'), logger: silent })
  await settings.load()
  const hub = new ConnectionHub({ logger: silent })
  const control = createControlHandler({
    store,
    agents,
    hub,
    config: { host: '127.0.0.1', port: 0 },
    settings,
    memory,
    history,
    sessions,
    logger: silent,
    ready: Promise.resolve(),
  })
  const server = createServer((req, res) => control.handler(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (path, { method = 'GET', body } = {}) => {
    const response = await fetch(`${base}${CONTROL}${path}`, {
      method,
      headers: method === 'GET' ? {} : headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, json: await response.json().catch(() => null) }
  }
  return {
    dir,
    store,
    agents,
    memory,
    history,
    call,    async dispose() {
      await new Promise((resolve) => server.close(resolve))
      await rm(dir, { recursive: true, force: true })
    },
  }
}

test('legacy devices become agents one-by-one, config and memory included', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-xiaozhi-agents-seed-'))
  try {
    // 先造一份「旧版」名册：配置全在设备上，没有 agentId。
    const devices = [
      {
        deviceId: MAC_A,
        nickName: '客厅手表',
        overrides: { voice: 'zh_female_vv_uranus_bigtts', systemPrompt: '你是客厅音箱' },
        toolDisabled: ['web_search'],
        memoryEnabled: false,
      },
      { deviceId: MAC_B, nickName: '', overrides: {}, toolDisabled: [], memoryEnabled: true },
    ]
    await writeFile(join(dir, 'devices.json'), JSON.stringify({ version: 2, devices }, null, 2))
    // 旧记忆按设备键存。
    const memory = createMemoryStore({ dir: join(dir, 'memory') })
    await memory.remember(MAC_A, '喜欢喝冰美式')

    const store = new DeviceStore({ file: join(dir, 'devices.json'), logger: silent })
    const agents = new AgentStore({ file: join(dir, 'agents.json'), logger: silent })
    await store.load()
    await agents.load()
    const result = await adoptLegacyDevices({ devices: store, agents, memory, logger: silent })
    assert.equal(result.adopted, 2)

    const list = agents.list()
    assert.equal(list.length, 2)
    // 名字模型：智能体有自己的名字（「智能体 N」），不抄设备昵称/MAC。
    const living = list.find((agent) => agent.name === '智能体 1')
    assert.ok(living, '智能体默认名字是「智能体 1」')
    assert.notEqual(living.name, '客厅手表', '智能体名字不与设备昵称共用')
    assert.equal(living.overrides.voice, 'zh_female_vv_uranus_bigtts')
    assert.equal(living.overrides.systemPrompt, '你是客厅音箱')
    assert.deepEqual(living.toolDisabled, ['web_search'])
    assert.equal(living.memoryEnabled, false)

    const unnamed = list.find((agent) => agent.name === '智能体 2')
    assert.ok(unnamed, '第二台设备建「智能体 2」')
    assert.notEqual(unnamed.name, MAC_B, '没有昵称时也不拿 MAC 当智能体名字')

    const boundA = store.get(MAC_A)
    assert.equal(boundA.agentId, living.id, '设备绑定到自己的智能体')
    assert.equal(store.get(MAC_B).agentId, unnamed.id)

    // 记忆从设备键复制到智能体键：升级不丢「它记得你」。
    const summary = await memory.summary(living.id)
    assert.equal(summary.facts[0].value, '喜欢喝冰美式')
    // 复制后的记录键必须是智能体：再记一轮要写到智能体文件，而不是写回旧设备文件。
    await memory.recordTurn(living.id, { user: '新的一句', assistant: '好' })
    const afterTurn = await memory.summary(living.id)
    assert.equal(afterTurn.turns.at(-1).user, '新的一句')

    // 幂等：再跑一次不会重复建智能体。
    const again = await adoptLegacyDevices({ devices: store, agents, memory, logger: silent })
    assert.equal(again.adopted, 0)
    assert.equal(agents.size, 2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('one agent binds several devices, and binding moves a device instead of copying it', async () => {
  const harness = await start()
  try {
    await harness.store.ensureDevice({ deviceId: MAC_A, ip: '10.0.0.1' })
    await harness.store.ensureDevice({ deviceId: MAC_B, ip: '10.0.0.2' })

    const created = await harness.call('/agents', { method: 'POST', body: { name: '客厅智能体' } })
    assert.equal(created.status, 200)
    const agentId = created.json.agent.id
    assert.equal(created.json.agent.name, '客厅智能体')
    assert.equal(created.json.agent.deviceCount, 0)

    // 绑定两台设备到同一个智能体。
    for (const deviceId of [MAC_A, MAC_B]) {
      const bound = await harness.call('/agents/bind', { method: 'POST', body: { agentId, deviceId } })
      assert.equal(bound.status, 200)
    }
    let list = (await harness.call('/agents')).json.agents
    assert.equal(list.length, 1)
    assert.equal(list[0].deviceCount, 2)
    assert.deepEqual(list[0].devices.map((device) => device.deviceId).sort(), [MAC_A, MAC_B].sort())

    // 第二个智能体 + 把 A 移过去：A 属于 B 的智能体，原智能体只剩 B。
    const other = await harness.call('/agents', { method: 'POST', body: { name: '书房智能体' } })
    const otherId = other.json.agent.id
    const moved = await harness.call('/agents/bind', { method: 'POST', body: { agentId: otherId, deviceId: MAC_A } })
    assert.equal(moved.status, 200)
    list = (await harness.call('/agents')).json.agents
    const living = list.find((agent) => agent.id === agentId)
    const study = list.find((agent) => agent.id === otherId)
    assert.equal(living.deviceCount, 1)
    assert.equal(study.deviceCount, 1)
    assert.equal(harness.store.get(MAC_A).agentId, otherId, '绑定是移动，不是复制')

    // 解绑后回到「未绑定」。
    const unbound = await harness.call('/agents/unbind', { method: 'POST', body: { agentId: otherId, deviceId: MAC_A } })
    assert.equal(unbound.status, 200)
    assert.equal(harness.store.get(MAC_A).agentId, '')
    assert.equal((await harness.call('/agents')).json.agents.find((agent) => agent.id === otherId).deviceCount, 0)

    // 不属于该智能体的设备不能被它解绑（先绑到另一个智能体上）。
    await harness.call('/agents/bind', { method: 'POST', body: { agentId: otherId, deviceId: MAC_A } })
    const wrong = await harness.call('/agents/unbind', { method: 'POST', body: { agentId, deviceId: MAC_A } })
    assert.equal(wrong.status, 400)
  } finally {
    await harness.dispose()
  }
})

test('agent names must be unique', async () => {
  const harness = await start()
  try {
    const first = await harness.call('/agents', { method: 'POST', body: { name: '重名测试' } })
    assert.equal(first.status, 200)
    const firstId = first.json.agent.id

    const duplicate = await harness.call('/agents', { method: 'POST', body: { name: '  重名测试  ' } })
    assert.equal(duplicate.status, 400)
    assert.equal(duplicate.json.error.code, 'duplicate-name')
    assert.equal(harness.agents.size, 1)

    const second = await harness.call('/agents', { method: 'POST', body: { name: '另一个' } })
    assert.equal(second.status, 200)
    const secondId = second.json.agent.id

    const renameDuplicate = await harness.call('/agents/update', {
      method: 'POST',
      body: { agentId: secondId, name: '重名测试' },
    })
    assert.equal(renameDuplicate.status, 400)
    assert.equal(renameDuplicate.json.error.code, 'duplicate-name')
    assert.equal(harness.agents.get(secondId).name, '另一个')

    // 改成自己当前的名字不算重复；同名比较会 trim。
    const self = await harness.call('/agents/update', {
      method: 'POST',
      body: { agentId: firstId, name: ' 重名测试 ' },
    })
    assert.equal(self.status, 200)
    assert.equal(harness.agents.get(firstId).name, '重名测试')
  } finally {
    await harness.dispose()
  }
})

test('agent config is shared by its devices and can be renamed', async () => {
  const harness = await start()
  try {
    await harness.store.ensureDevice({ deviceId: MAC_A })
    await harness.store.ensureDevice({ deviceId: MAC_B })
    const created = await harness.call('/agents', { method: 'POST', body: { name: '小智' } })
    const agentId = created.json.agent.id
    for (const deviceId of [MAC_A, MAC_B]) {
      await harness.call('/agents/bind', { method: 'POST', body: { agentId, deviceId } })
    }

    const updated = await harness.call('/agents/update', {
      method: 'POST',
      body: { agentId, name: '小智 2 号', systemPrompt: '你是小智', voice: 'zh_female_vv_uranus_bigtts', language: '英语' },
    })
    assert.equal(updated.status, 200)
    assert.equal(updated.json.agent.name, '小智 2 号')
    assert.equal(updated.json.agent.overrides.systemPrompt, '你是小智')
    assert.equal(updated.json.agent.overrides.voice, 'zh_female_vv_uranus_bigtts')
    assert.equal(updated.json.agent.overrides.language, '英语')
    assert.equal(updated.json.agent.deviceCount, 2)

    // 空串 = 删掉这条覆盖。
    const cleared = await harness.call('/agents/update', { method: 'POST', body: { agentId, voice: '' } })
    assert.equal(cleared.json.agent.overrides.voice, undefined)

    // 记忆与工具开关是智能体级的：两个接口都接受 agentId。
    const memoryAdd = await harness.call('/memory/add', { method: 'POST', body: { agentId, value: '喜欢喝冰美式' } })
    assert.equal(memoryAdd.status, 200)
    assert.equal(memoryAdd.json.facts[0].value, '喜欢喝冰美式')
    const tools = await harness.call('/tools?agentId=' + encodeURIComponent(agentId))
    assert.equal(tools.status, 200)
    assert.ok(Array.isArray(tools.json.tools))
  } finally {
    await harness.dispose()
  }
})

test('removing an agent cascades to its devices, history and memory', async () => {
  const harness = await start()
  try {
    await harness.store.ensureDevice({ deviceId: MAC_A })
    await harness.store.ensureDevice({ deviceId: MAC_B })
    await harness.store.ensureDevice({ deviceId: '02:4A:7D:E3:89:C1' })
    const created = await harness.call('/agents', { method: 'POST', body: { name: '待删除' } })
    const agentId = created.json.agent.id
    await harness.call('/agents/bind', { method: 'POST', body: { agentId, deviceId: MAC_A } })
    await harness.call('/agents/bind', { method: 'POST', body: { agentId, deviceId: MAC_B } })
    await harness.history.appendMessages(MAC_A, 's1', [{ role: 'user', content: '你好' }])
    await harness.history.appendMessages(MAC_B, 's2', [{ role: 'user', content: '在吗' }])
    await harness.memory.remember(agentId, '要记住的事')

    const removed = await harness.call('/agents/remove', { method: 'POST', body: { agentId } })
    assert.equal(removed.status, 200)
    assert.equal(removed.json.removedDevices, 2)

    assert.equal(harness.agents.get(agentId), undefined, '智能体已删除')
    assert.equal(harness.store.get(MAC_A), undefined, '绑定设备级联删除')
    assert.equal(harness.store.get(MAC_B), undefined)
    assert.ok(harness.store.get('02:4A:7D:E3:89:C1'), '没绑定的设备不受影响')
    assert.deepEqual(await harness.history.listConversations(MAC_A, 10), [], '历史一并清掉')
    assert.deepEqual((await harness.memory.summary(agentId)).facts, [], '记忆一并清掉')
  } finally {
    await harness.dispose()
  }
})

test('an agent history merges the conversations of all its devices', async () => {
  const harness = await start()
  try {
    await harness.store.ensureDevice({ deviceId: MAC_A })
    await harness.store.ensureDevice({ deviceId: MAC_B })
    const created = await harness.call('/agents', { method: 'POST', body: { name: '合并历史' } })
    const agentId = created.json.agent.id
    await harness.call('/agents/bind', { method: 'POST', body: { agentId, deviceId: MAC_A } })
    await harness.call('/agents/bind', { method: 'POST', body: { agentId, deviceId: MAC_B } })
    await harness.history.appendMessages(MAC_A, 'a1', [{ role: 'user', content: '手表 A 说的话' }])
    await harness.history.appendMessages(MAC_B, 'b1', [{ role: 'user', content: '手表 B 说的话' }])

    const merged = await harness.call('/history/agent-conversations?agentId=' + encodeURIComponent(agentId))
    assert.equal(merged.status, 200)
    assert.equal(merged.json.conversations.length, 2)
    assert.deepEqual(
      merged.json.conversations.map((conversation) => conversation.deviceId).sort(),
      [MAC_A, MAC_B].sort(),
    )
    // 每条会话带设备名，详情仍按设备 + 会话 id 取。
    const detail = await harness.call(
      `/history/conversation?deviceId=${encodeURIComponent(MAC_A)}&sessionId=a1`,
    )
    assert.equal(detail.status, 200)
    assert.equal(detail.json.found, true)
    assert.equal(detail.json.messages[0].content, '手表 A 说的话')
  } finally {
    await harness.dispose()
  }
})

test('legacy agent names copied from device nicknames are corrected once, edited names are kept', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-xiaozhi-agent-rename-'))
  try {
    const now = 1_800_000_000_000
    // 旧迁移产物：智能体名字 = 设备昵称，且从未被编辑过（updatedAt === createdAt）。
    const devices = [
      { deviceId: MAC_A, nickName: '小智', agentId: 'legacy-a' },
      { deviceId: MAC_B, nickName: '书房手表', agentId: 'edited-b' },
    ]
    const agentsDoc = {
      version: 1,
      agents: [
        { id: 'legacy-a', name: '小智', overrides: {}, toolDisabled: [], memoryEnabled: true, createdAt: now, updatedAt: now },
        { id: 'edited-b', name: '书房手表', overrides: {}, toolDisabled: [], memoryEnabled: true, createdAt: now, updatedAt: now + 1 },
      ],
    }
    await writeFile(join(dir, 'devices.json'), JSON.stringify({ version: 2, devices }, null, 2))
    await writeFile(join(dir, 'agents.json'), JSON.stringify(agentsDoc, null, 2))
    const store = new DeviceStore({ file: join(dir, 'devices.json'), logger: silent })
    const agents = new AgentStore({ file: join(dir, 'agents.json'), logger: silent })
    await store.load()
    await agents.load()

    const first = await adoptLegacyDevices({ devices: store, agents, memory: null, logger: silent })
    assert.equal(first.adopted, 0)
    assert.equal(first.renamed, 1, '只改「迁移产物」那一条')
    assert.equal(agents.get('legacy-a').name, '智能体 1', '不再与设备昵称共用名字')
    assert.equal(agents.get('edited-b').name, '书房手表', '用户编辑过的智能体名字不动')

    // 幂等：再跑一次不会再改。
    const second = await adoptLegacyDevices({ devices: store, agents, memory: null, logger: silent })
    assert.equal(second.renamed, 0)
    assert.equal(agents.get('legacy-a').name, '智能体 1')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('回答来源可以按智能体切到 DSH 会话，坏值被边界拒绝', async () => {
  const fakeSessions = {
    available: true,
    async list() {
      return [
        { sessionId: 'session-cccc', updatedAt: 20, running: false, blank: false, cwd: 'C:\\work' },
        { sessionId: 'session-dddd', updatedAt: 10, running: true, blank: false },
        { sessionId: 'session-child', updatedAt: 30, parentSessionId: 'session-cccc' },
      ]
    },
  }
  const ctx = await start({ sessions: fakeSessions })
  try {
    const created = await ctx.call('/agents', { method: 'POST', body: { name: '语音助手' } })
    assert.equal(created.status, 200)
    const agentId = created.json.agent.id

    const updated = await ctx.call('/agents/update', {
      method: 'POST',
      body: { agentId, backend: 'session', sessionId: 'session-cccc' },
    })
    assert.equal(updated.status, 200)
    assert.equal(updated.json.agent.overrides.backend, 'session')
    assert.equal(updated.json.agent.overrides.sessionId, 'session-cccc')

    // 空串 = 删掉覆盖（回到跟随全局 / 自动建）。
    const cleared = await ctx.call('/agents/update', {
      method: 'POST',
      body: { agentId, backend: '', sessionId: '' },
    })
    assert.equal(cleared.status, 200)
    assert.equal(cleared.json.agent.overrides.backend, undefined)
    assert.equal(cleared.json.agent.overrides.sessionId, undefined)

    const badBackend = await ctx.call('/agents/update', { method: 'POST', body: { agentId, backend: 'gpt' } })
    assert.equal(badBackend.status, 400)
    assert.equal(badBackend.json.error.code, 'invalid-backend')

    const badSession = await ctx.call('/agents/update', { method: 'POST', body: { agentId, sessionId: '../../etc' } })
    assert.equal(badSession.status, 400)
    assert.equal(badSession.json.error.code, 'invalid-session-id')

    const sessions = await ctx.call('/sessions')
    assert.equal(sessions.status, 200)
    assert.equal(sessions.json.available, true)
    assert.deepEqual(
      sessions.json.items.map((row) => row.sessionId),
      ['session-cccc', 'session-dddd'],
      '子代理会话不列为语音目标，按最近时间排序',
    )
  } finally {
    await ctx.dispose()
  }
})

test('宿主没有会话服务时 /sessions 回不可用，而不是 500', async () => {
  const ctx = await start()
  try {
    const response = await ctx.call('/sessions')
    assert.equal(response.status, 200)
    assert.deepEqual(response.json, { available: false, items: [] })
  } finally {
    await ctx.dispose()
  }
})
