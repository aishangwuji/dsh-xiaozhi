/**
 * 「家庭成员语音后端」（dsh-family 的 `familyVoice` 服务）契约测试。
 *
 * 覆盖 M1 最容易踩坏的语义：
 *   - 设备绑定成员：`devices.json` 的 `familyMemberId`、坏文件容错、绑定/解绑/无效成员；
 *   - `GET /family/members` 透传 family 的公开字段，服务不可用时 `available:false` 不报 500；
 *   - 适配器把 `ask` 的结果转成 `text` 事件，把 409 busy / 成员不存在 / 服务不可用转成
 *     `notice`（设备气泡，不朗读）；
 *   - `onApproval` / `onQuestion` 接到 `VoiceSession.askApproval` / `askUserQuestions`，
 *     说不清（返回 null）时回落 `null` 交给 family 放行到 PWA；
 *   - `backend` 边界只收 llm / session / family。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentStore, adoptLegacyDevices, nextAgentName } from '../src/agents.js'
import { createControlHandler } from '../src/control.js'
import { ConnectionHub } from '../src/hub.js'
import { DeviceStore } from '../src/store.js'
import { FAMILY_NOTICES, SPOKEN_NOTICES, createFamilyLlm, familyNoticeFor } from '../src/voice/adapters/family.js'

const silent = { info() {}, warn() {}, error() {} }
const CONTROL = '/dsh-xiaozhi-7c3a'
const MAC = '02:4A:7D:E3:89:BF'
const tick = () => new Promise((resolve) => setImmediate(resolve))

function headers() {
  return { 'content-type': 'application/json', 'x-dsh-xiaozhi': '1' }
}

const MEMBER_DAD = { id: 'm-dad', name: '爸爸', roleLabel: '家长', isAdmin: true }
const MEMBER_MOM = { id: 'm-mom', name: '妈妈', roleLabel: '家长', isAdmin: true }

/** 控制面 harness：设备名册 + 智能体 + 可选 fake familyVoice。 */
async function start({ familyVoice, seedDevices } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-xiaozhi-family-'))
  if (seedDevices) {
    await writeFile(join(dir, 'devices.json'), JSON.stringify({ version: 2, devices: seedDevices }, null, 2))
  }
  const store = new DeviceStore({ file: join(dir, 'devices.json'), logger: silent })
  const agents = new AgentStore({ file: join(dir, 'agents.json'), logger: silent })
  await store.load()
  await agents.load()
  store.onCreated = async (device) => {
    if (device.agentId) return
    const agent = await agents.create({ name: nextAgentName(agents) })
    await store.setAgentId({ deviceId: device.deviceId, agentId: agent.id })
  }
  await adoptLegacyDevices({ devices: store, agents, logger: silent })
  const hub = new ConnectionHub({ logger: silent })
  const control = createControlHandler({
    store,
    agents,
    hub,
    config: { host: '127.0.0.1', port: 0 },
    familyVoice,
    logger: silent,
    ready: Promise.resolve(),
  })
  const server = createServer((req, res) => control.handler(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (path, { method = 'GET', body, csrf = true } = {}) => {
    const response = await fetch(`${base}${CONTROL}${path}`, {
      method,
      headers: method === 'GET' || !csrf ? {} : headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, json: await response.json().catch(() => null) }
  }
  return {
    dir,
    store,
    agents,
    call,
    async device(deviceId = MAC) {
      const { device } = await store.ensureDevice({ deviceId, ip: '127.0.0.1', autoProvision: true })
      return device
    },
    async dispose() {
      await new Promise((resolve) => server.close(resolve))
      await store.persist()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

function fakeFamilyVoice(members = [MEMBER_DAD, MEMBER_MOM], overrides = {}) {
  return {
    version: 1,
    async listMembers() {
      return members
    },
    ...overrides,
  }
}

async function collect(iterator) {
  const chunks = []
  for await (const chunk of iterator) chunks.push(chunk)
  return chunks
}

// ------------------------------------------------------------------ 存储与绑定

test('devices.json 保存 familyMemberId，坏值容错成未绑定', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-xiaozhi-family-store-'))
  try {
    const file = join(dir, 'devices.json')
    const store = new DeviceStore({ file, logger: silent })
    await store.load()
    await store.ensureDevice({ deviceId: MAC, autoProvision: true })
    assert.equal(store.get(MAC).familyMemberId, '')
    await store.setFamilyMemberId({ deviceId: MAC, memberId: 'm-dad' })
    assert.equal(store.get(MAC).familyMemberId, 'm-dad')

    // 重新加载：绑定要持久化；非字符串/超长值当未绑定，不让坏文件阻断启动。
    await writeFile(
      file,
      JSON.stringify({
        version: 2,
        devices: [
          { deviceId: MAC, familyMemberId: 'm-dad' },
          { deviceId: '02:4A:7D:E3:89:C0', familyMemberId: 42 },
        ],
      }),
    )
    const reloaded = new DeviceStore({ file, logger: silent })
    await reloaded.load()
    assert.equal(reloaded.get(MAC).familyMemberId, 'm-dad')
    assert.equal(reloaded.get('02:4A:7D:E3:89:C0').familyMemberId, '')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('GET /family/members 透传公开字段；服务不可用/抛错时 available:false 而不是 500', async () => {
  const ctx = await start({ familyVoice: () => fakeFamilyVoice() })
  try {
    const list = await ctx.call('/family/members')
    assert.equal(list.status, 200)
    assert.equal(list.json.available, true)
    assert.deepEqual(list.json.members, [MEMBER_DAD, MEMBER_MOM])

    // 密钥/头像这类内部字段不下发。
    const leaky = await start({
      familyVoice: () =>
        fakeFamilyVoice([{ ...MEMBER_DAD, apiKey: 'sk-secret', avatar: Buffer.from('x') }]),
    })
    try {
      const trimmed = await leaky.call('/family/members')
      assert.deepEqual(Object.keys(trimmed.json.members[0]).sort(), ['id', 'isAdmin', 'name', 'roleLabel'])
    } finally {
      await leaky.dispose()
    }
  } finally {
    await ctx.dispose()
  }

  for (const familyVoice of [
    undefined,
    () => undefined,
    () => fakeFamilyVoice([], { async listMembers() { throw new Error('family down') } }),
  ]) {
    const ctxDown = await start({ familyVoice })
    try {
      const list = await ctxDown.call('/family/members')
      assert.equal(list.status, 200)
      assert.deepEqual(list.json, { available: false, members: [] })
    } finally {
      await ctxDown.dispose()
    }
  }
})

test('POST /devices/family 绑定/解绑，无效成员 400，服务不可用 409，缺 CSRF 403', async () => {
  const ctx = await start({ familyVoice: () => fakeFamilyVoice() })
  try {
    await ctx.device()

    const bound = await ctx.call('/devices/family', {
      method: 'POST',
      body: { deviceId: MAC, memberId: MEMBER_MOM.id },
    })
    assert.equal(bound.status, 200)
    assert.equal(bound.json.device.familyMemberId, MEMBER_MOM.id)
    assert.equal(ctx.store.get(MAC).familyMemberId, MEMBER_MOM.id)

    // 换成员 = 改这一个字段（不是新增一条绑定）。
    const switched = await ctx.call('/devices/family', {
      method: 'POST',
      body: { deviceId: MAC, memberId: MEMBER_DAD.id },
    })
    assert.equal(switched.json.device.familyMemberId, MEMBER_DAD.id)

    // 空串 = 解绑。
    const cleared = await ctx.call('/devices/family', {
      method: 'POST',
      body: { deviceId: MAC, memberId: '' },
    })
    assert.equal(cleared.status, 200)
    assert.equal(cleared.json.device.familyMemberId, '')

    const invalid = await ctx.call('/devices/family', {
      method: 'POST',
      body: { deviceId: MAC, memberId: 'm-ghost' },
    })
    assert.equal(invalid.status, 400)
    assert.equal(invalid.json.error.code, 'member-not-found')

    // 类型不对不能当成「解绑」静默处理。
    const badType = await ctx.call('/devices/family', {
      method: 'POST',
      body: { deviceId: MAC, memberId: 42 },
    })
    assert.equal(badType.status, 400)
    assert.equal(badType.json.error.code, 'invalid-member-id')

    const noCsrf = await ctx.call('/devices/family', {
      method: 'POST',
      csrf: false,
      body: { deviceId: MAC, memberId: MEMBER_DAD.id },
    })
    assert.equal(noCsrf.status, 403)

    const unknownDevice = await ctx.call('/devices/family', {
      method: 'POST',
      body: { deviceId: '02:00:00:00:00:99', memberId: '' },
    })
    assert.equal(unknownDevice.status, 404)
  } finally {
    await ctx.dispose()
  }

  // 服务不可用：非空成员不能盲写（409）；解绑必须仍可做（family 挂了也要能解除绑定）。
  const ctxDown = await start({ familyVoice: () => undefined })
  try {
    await ctxDown.device()
    const rejected = await ctxDown.call('/devices/family', {
      method: 'POST',
      body: { deviceId: MAC, memberId: MEMBER_DAD.id },
    })
    assert.equal(rejected.status, 409)
    assert.equal(rejected.json.error.code, 'family-unavailable')

    const cleared = await ctxDown.call('/devices/family', {
      method: 'POST',
      body: { deviceId: MAC, memberId: '' },
    })
    assert.equal(cleared.status, 200)
    assert.equal(cleared.json.device.familyMemberId, '')
  } finally {
    await ctxDown.dispose()
  }
})

test('backend 只收 llm / session / family，family 可保存', async () => {
  const ctx = await start()
  try {
    const created = await ctx.call('/agents', { method: 'POST', body: { name: '家庭 Bot' } })
    const agentId = created.json.agent.id
    const saved = await ctx.call('/agents/update', { method: 'POST', body: { agentId, backend: 'family' } })
    assert.equal(saved.status, 200)
    assert.equal(saved.json.agent.overrides.backend, 'family')
    const bad = await ctx.call('/agents/update', { method: 'POST', body: { agentId, backend: 'pwa' } })
    assert.equal(bad.status, 400)
    assert.equal(bad.json.error.code, 'invalid-backend')
  } finally {
    await ctx.dispose()
  }
})

// -------------------------------------------------------------------- 适配器

test('family 适配器把 ask 的 text 转成 text 事件，并按成员/原话调用', async () => {
  const asked = []
  const service = {
    async ask(request) {
      asked.push(request)
      return { text: '**已经**开了，客厅灯现在是亮的。', threadId: 't-1', title: '语音', memberId: request.memberId, elapsedMs: 18 }
    },
  }
  const adapter = createFamilyLlm({ familyVoice: () => service, memberId: 'm-dad', logger: silent })
  const out = await collect(adapter.stream({ messages: [{ role: 'user', content: '客厅灯开了吗' }] }))
  assert.deepEqual(out, ['已经开了，客厅灯现在是亮的。'])
  assert.equal(asked.length, 1)
  assert.equal(asked[0].memberId, 'm-dad')
  assert.equal(asked[0].text, '客厅灯开了吗')
  assert.equal(typeof asked[0].onApproval, 'function')
  assert.equal(typeof asked[0].onQuestion, 'function')
})

test('成员每轮重新解析：切换成员下一轮生效，不用重连', async () => {
  const seen = []
  let current = 'm-dad'
  const service = {
    async ask(request) {
      seen.push(request.memberId)
      return { text: '在。' }
    },
  }
  const adapter = createFamilyLlm({ familyVoice: () => service, memberId: () => current, logger: silent })
  await collect(adapter.stream({ messages: [{ role: 'user', content: '一' }] }))
  current = 'm-mom'
  await collect(adapter.stream({ messages: [{ role: 'user', content: '二' }] }))
  assert.deepEqual(seen, ['m-dad', 'm-mom'])
})

test('ask 抛 busy / 成员不存在 / 服务不可用 / 未绑成员 → 上屏并念出提示，不抛错', async () => {
  const cases = [
    [{ async ask() { throw Object.assign(new Error('busy'), { status: 409, code: 'busy' }) } }, 'm-dad', FAMILY_NOTICES.busy],
    [
      { async ask() { throw Object.assign(new Error('gone'), { status: 404, code: 'member-not-found' }) } },
      'm-dad',
      FAMILY_NOTICES.memberMissing,
    ],
    [{ async ask() { throw Object.assign(new Error('no workspace'), { code: 'no-workspace' }) } }, 'm-dad', FAMILY_NOTICES.noWorkspace],
    [undefined, 'm-dad', FAMILY_NOTICES.unavailable],
    [{ async ask() { return { text: '不该被调用' } } }, '', FAMILY_NOTICES.noMember],
  ]
  for (const [service, memberId, notice] of cases) {
    const adapter = createFamilyLlm({ familyVoice: () => service, memberId, logger: silent })
    const out = await collect(adapter.stream({ messages: [{ role: 'user', content: '在吗' }] }))
    // 气泡只显示、text 才朗读：两件都要有，否则手表用户以为死机。
    assert.deepEqual(out, [
      { type: 'notice', text: notice },
      { type: 'text', text: SPOKEN_NOTICES[notice] },
    ])
  }
  // 未绑成员时根本不该调用 ask。
  let called = false
  const never = createFamilyLlm({
    familyVoice: () => ({ async ask() { called = true; return { text: 'x' } } }),
    memberId: '',
    logger: silent,
  })
  await collect(never.stream({ messages: [{ role: 'user', content: '在吗' }] }))
  assert.equal(called, false)
})

test('familyNoticeFor 只认可解释的失败；其它错误交给会话层兜底', () => {
  assert.equal(familyNoticeFor({ status: 409 }), FAMILY_NOTICES.busy)
  assert.equal(familyNoticeFor({ code: 'member-not-found' }), FAMILY_NOTICES.memberMissing)
  assert.equal(familyNoticeFor({ code: 'no-workspace' }), FAMILY_NOTICES.noWorkspace)
  assert.equal(familyNoticeFor({ code: 'service-unavailable' }), FAMILY_NOTICES.unavailable)
  // 带 code 的其它 404（如会话没了）不是「成员失效」，交给会话层播通用兜底。
  assert.equal(familyNoticeFor({ code: 'thread-not-found', status: 404 }), '')
  assert.equal(familyNoticeFor({ status: 404 }), FAMILY_NOTICES.memberMissing)
  assert.equal(familyNoticeFor(new Error('boom')), '')
  assert.equal(familyNoticeFor(null), '')

  const adapter = createFamilyLlm({
    familyVoice: () => ({ async ask() { throw new Error('会话服务炸了') } }),
    memberId: 'm-dad',
    logger: silent,
  })
  return assert.rejects(
    collect(adapter.stream({ messages: [{ role: 'user', content: '在吗' }] })),
    /会话服务炸了/,
  )
})

test('onApproval 接到 session.askApproval：返回 null 时回落 null，允许时原样透传', async () => {
  const calls = []
  const session = {
    async askApproval(args) {
      calls.push(args)
      return calls.length === 1 ? null : 'allowed-once'
    },
  }
  let round = 0
  const service = {
    async ask(request) {
      round += 1
      const answer = await request.onApproval({ id: `a${round}`, tool: 'bash', reason: '要执行删除命令' })
      return { text: answer === 'allowed-once' ? '好，我继续。' : '那就先不做了。' }
    },
  }
  const adapter = createFamilyLlm({ familyVoice: () => service, memberId: 'm-dad', logger: silent })

  const first = await collect(adapter.stream({ messages: [{ role: 'user', content: '删了吧' }], session }))
  assert.deepEqual(first, ['那就先不做了。'])
  assert.equal(calls.length, 1)
  assert.match(calls[0].text, /要执行删除命令/)
  assert.equal(calls[0].timeoutMs, 12_000)

  const second = await collect(adapter.stream({ messages: [{ role: 'user', content: '删了吧' }], session }))
  assert.deepEqual(second, ['好，我继续。'])
  assert.equal(calls.length, 2)

  // 没有 session（比如宿主没接语音会话）时不能崩：直接回 null 交给 family 放行 PWA。
  let outcome = 'unset'
  const bare = createFamilyLlm({
    familyVoice: () => ({
      async ask(request) {
        outcome = await request.onApproval({ id: 'a3', tool: 'bash', reason: 'x' })
        return { text: '好。' }
      },
    }),
    memberId: 'm-dad',
    logger: silent,
  })
  await collect(bare.stream({ messages: [{ role: 'user', content: '在吗' }] }))
  assert.equal(outcome, null)
})

test('onQuestion 接到 session.askUserQuestions，失败/为空时回落 null', async () => {
  const calls = []
  const session = {
    async askUserQuestions(questions, options) {
      calls.push({ questions, options })
      return { answers: [{ id: 'q1', selected: ['绿茶'] }] }
    },
  }
  const questions = [
    {
      id: 'q1',
      question: '喝点什么',
      header: '饮料',
      options: [{ label: '绿茶' }, { label: '咖啡', description: '含咖啡因' }],
      multiSelect: false,
    },
  ]
  const service = {
    async ask(request) {
      const result = await request.onQuestion({ id: 'qq', questions })
      return { text: result ? `你选了${result.answers[0].selected[0]}。` : '那我先不点了。' }
    },
  }
  const adapter = createFamilyLlm({ familyVoice: () => service, memberId: 'm-mom', logger: silent })
  const out = await collect(adapter.stream({ messages: [{ role: 'user', content: '来杯喝的' }], session }))
  assert.deepEqual(out, ['你选了绿茶。'])
  assert.equal(calls[0].questions, questions)
  assert.equal(calls[0].options.timeoutMs, 15_000)

  const failing = createFamilyLlm({
    familyVoice: () => ({
      async ask(request) {
        const result = await request.onQuestion({ id: 'qq', questions })
        return { text: result === null ? '那我先不点了。' : '不对' }
      },
    }),
    memberId: 'm-mom',
    logger: silent,
  })
  const fallback = await collect(
    failing.stream({
      messages: [{ role: 'user', content: '来杯喝的' }],
      session: { async askUserQuestions() { throw new Error('voice question failed') } },
    }),
  )
  assert.deepEqual(fallback, ['那我先不点了。'])
})

test('最终回复先做语音摘要；摘要为空回落 toSpeech', async () => {
  const service = { async ask() { return { text: '## 结论\n\n**都办好了**，文件在会话里。' } } }
  const seen = []
  const adapter = createFamilyLlm({
    familyVoice: () => service,
    memberId: 'm-dad',
    summarize: async (text) => {
      seen.push(text)
      return '都办好了，文件在会话里。'
    },
    summaryMinChars: 10,
    logger: silent,
  })
  const out = await collect(adapter.stream({ messages: [{ role: 'user', content: '整理一下' }] }))
  assert.equal(seen.length, 1)
  assert.match(seen[0], /都办好了/)
  assert.deepEqual(out, [{ type: 'progress', text: '我整理一下，马上说。' }, '都办好了，文件在会话里。'])

  const fallback = createFamilyLlm({
    familyVoice: () => service,
    memberId: 'm-dad',
    summarize: async () => '',
    summaryMinChars: 10,
    logger: silent,
  })
  const out2 = await collect(fallback.stream({ messages: [{ role: 'user', content: '整理一下' }] }))
  assert.equal(out2[out2.length - 1], '结论 都办好了，文件在会话里。')
})

test('打断会取消 family 侧这一轮，且不再吐字', async () => {
  const canceled = []
  let release
  const pending = new Promise((resolve) => {
    release = resolve
  })
  const service = {
    async ask() {
      return pending
    },
    cancel(request) {
      canceled.push(request.memberId)
      return true
    },
  }
  const adapter = createFamilyLlm({ familyVoice: () => service, memberId: 'm-mom', logger: silent })
  const controller = new AbortController()
  const results = collect(
    adapter.stream({ messages: [{ role: 'user', content: '讲个故事' }], signal: controller.signal }),
  )
  await tick()
  controller.abort()
  assert.deepEqual(canceled, ['m-mom'])
  release({ text: '晚了' })
  assert.deepEqual(await results, [])
})

test('已中止的信号不发 ask', async () => {
  let called = false
  const adapter = createFamilyLlm({
    familyVoice: () => ({ async ask() { called = true; return { text: 'x' } } }),
    memberId: 'm-dad',
    logger: silent,
  })
  const controller = new AbortController()
  controller.abort()
  const out = await collect(
    adapter.stream({ messages: [{ role: 'user', content: '在吗' }], signal: controller.signal }),
  )
  assert.deepEqual(out, [])
  assert.equal(called, false)
})
