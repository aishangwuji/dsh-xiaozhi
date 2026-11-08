import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DeviceIotRegistry } from '../src/voice/device-iot.js'

const DESCRIPTORS = [
  {
    name: 'Light',
    description: '客厅灯',
    properties: { power: { description: '开关', type: 'boolean' } },
    methods: {
      set_power: {
        description: '设置开关',
        parameters: { on: { description: '是否打开', type: 'boolean' } },
      },
    },
  },
]

test('IoT descriptors become get_* / <device>_<method> tools', () => {
  const iot = new DeviceIotRegistry({ sendJson: () => {} })
  const changed = iot.handleMessage({ type: 'iot', descriptors: DESCRIPTORS })
  assert.equal(changed, true)
  const names = iot.definitions().map((tool) => tool.function.name)
  assert.deepEqual(names, ['get_light_power', 'light_set_power'])
  assert.equal(iot.has('get_light_power'), true)
  assert.equal(iot.has('light_set_power'), true)
})

test('IoT get returns the state template and control sends a command', async () => {
  const sent = []
  const iot = new DeviceIotRegistry({ sendJson: (message) => sent.push(message) })
  iot.handleMessage({ type: 'iot', descriptors: DESCRIPTORS })
  iot.handleMessage({ type: 'iot', states: [{ name: 'Light', state: { power: true } }] })
  const got = await iot.execute('get_light_power', {
    response_success: '灯现在是{value}',
    response_failure: '查不到',
  })
  assert.equal(got, '灯现在是true')

  const controlled = await iot.execute('light_set_power', {
    on: false,
    response_success: '已关闭',
    response_failure: '失败',
  })
  assert.equal(controlled, '已关闭')
  assert.deepEqual(sent.at(-1), {
    type: 'iot',
    commands: [{ name: 'Light', method: 'set_power', parameters: { on: false } }],
  })
})
