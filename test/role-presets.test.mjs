/**
 * 角色模板：`src/client/agents/rolePresets.js` 与 `test/fixtures/role-presets.json` 逐字一致。
 *
 * 基准文件是 **`xiaozhi-esp32-server`**（原服务端）manager 种子数据
 * `main/manager-api/src/main/resources/db/changelog/202504092335.sql` 的 `ai_agent_template` 表
 * （湾湾小何 / 星际游子 / 英语老师 / 好奇男孩 / 汪汪队长）。改一个标点就红；
 * 要更新文案就重新跑导出生成，不要手改。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { ROLE_PRESETS, rolePresetPrompt, matchRolePreset } from '../src/client/agents/rolePresets.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/role-presets.json', import.meta.url), 'utf8'))

test('role presets match the original server templates verbatim', () => {
  assert.equal(ROLE_PRESETS.length, fixture.length)
  for (const [index, expected] of fixture.entries()) {
    assert.equal(ROLE_PRESETS[index].id, expected.id)
    assert.equal(ROLE_PRESETS[index].prompt, expected.prompt, `模板「${expected.name}」文案与基准不一致`)
    assert.ok(ROLE_PRESETS[index].prompt.trim().length > 80, '模板不能是空壳')
  }
})

test('the five personas are the original server agent templates', () => {
  assert.deepEqual(fixture.map((item) => item.name), ['湾湾小何', '星际游子', '英语老师', '好奇男孩', '汪汪队长'])
  for (const preset of ROLE_PRESETS) {
    assert.match(preset.prompt, /^\[角色设定\]/, '每段都要以 [角色设定] 开头')
    assert.match(preset.prompt, /\{\{assistant_name\}\}/, '每段都要保留 assistant_name 占位符')
    assert.ok(!/铁匠鲍勃|学者查理|守塔戴夫/.test(preset.prompt), '上一版 lingxi NPC 文案不应残留')
  }
})

test('{{assistant_name}} replacement and matchRolePreset keep working', () => {
  assert.equal(rolePresetPrompt('我叫{{assistant_name}}', ''), '我叫小智')
  assert.equal(rolePresetPrompt('我叫{{assistant_name}}', '手表'), '我叫手表')
  assert.equal(matchRolePreset(ROLE_PRESETS[0].prompt.replaceAll('{{assistant_name}}', '小智'), '小智'), 'wanwan-xiaohe')
  assert.equal(matchRolePreset(ROLE_PRESETS[1].prompt.replaceAll('{{assistant_name}}', '小智'), '小智'), 'star-wanderer')
  assert.equal(matchRolePreset(`${ROLE_PRESETS[2].prompt} 多一个字`, '小智'), '')
})
