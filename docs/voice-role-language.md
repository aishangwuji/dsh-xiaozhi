# 官方「角色 ↔ 音色 ↔ 语种」对照：查证与移植方案

- 查证对象：`D:\Demo\esp-xiaozhi\xiaozhi-esp32-server\main`（Java + Python 分支）与 `D:\Demo\esp-xiaozhi\xiaozhi-golang-src`（Go 分支，dsh-xiaozhi 的同源后端）。
- 只写能在这些仓库里指到行号的事实；云端控制台私有的角色市场文案不在开源仓库里，不臆测。

## 0. 一句话结论

**官方没有「角色 → 音色」对照表。** 只有三层彼此独立的东西：

1. **音色库**（`ai_tts_voice` / Go 的 `VoiceOptions`）：每个音色自带 `name`、`voice id`、`languages`、demo 音频；
2. **角色**（`roles` 表 / `ai_agent_template`）：`prompt` + 一个**可选**的默认 `voice` 字段；
3. **语种**（`tts_language` → TTS `language` → 提示词 `{{language}}`）：真正决定“说日语”的开关。

所以图 2 里下拉框的「邻家女孩 / 渊博小叔 / 阳光青年 / 湾区大叔 / 呆萌川妹」**不是角色名，是音色名**（前三个是豆包音色，后两个是方言音色）。看着像“角色对应音色”，其实是“音色起名像角色”。

## 1. 三条证据链

| 概念 | 官方落点 | 说明 |
|---|---|---|
| 角色 | `manager/backend/models/models.go:152-176` | `Name / Description / Prompt / TTSConfigID / Voice`；`Voice` 是可为空的指针，同一角色随时可换音色 |
| 角色（Java 分支） | `202503141346.sql:59` 建表、`202504092335.sql:5-75` 种子 | 有 `tts_voice_id` / `lang_code` / `language` 字段，但 5 条种子全用同一个 `TTS_EdgeTTS0001` |
| 音色 | `202503141346.sql:41` | `name`、`tts_voice`、`languages`、`voice_demo` —— 语种是**音色的属性**，不是角色的 |
| 语种生效 | `ConfigServiceImpl.java:154-159` → `prompt_manager.py:291-317` → `agent-base-prompt.txt:14-33` | 音色 `languages` 第一项（或 agent 手选 `tts_language`）写成 TTS `language`，再渲染进系统提示词 |

`agent-base-prompt.txt` 节选：

```text
<output_language_directive>
CRITICAL OUTPUT-LANGUAGE RULE
You MUST write EVERY response in {{language}}, regardless of the language the user speaks.
</output_language_directive>
```

这就是“日语”的**主要**实现方式：先用提示词把模型输出锁成日语，再挑一个能读日语的音色；TTS 参数反而次要。

## 2. 日语怎么配（官方三层）

### 2.1 音色层：必须选多语种音色

| 音色名（官方） | 音色 ID | 语种 | 模型族 | 备注 |
|---|---|---|---|---|
| Vivi | `zh_female_vv_uranus_bigtts` | 普通话、日语、印尼语、墨西哥西班牙语 | 豆包 2.0 | dsh-xiaozhi 叫「vivi 2.0」 |
| かずね（和音） | `multi_male_jingqiangkanye_moon_bigtts` | 日语、西语 | 豆包 1.0 | 中文表里这个 ID 是「京腔侃爷/Harmony」 |
| はるこ（晴子） | `multi_female_shuangkuaisisi_moon_bigtts` | 日语、西语 | 豆包 1.0 | 中文表里叫「爽快思思/Skye」 |
| あけみ（朱美） | `multi_female_gaolengyujie_moon_bigtts` | 日语 | 豆包 1.0 | 中文表里叫「高冷御姐」 |
| ひろし（広志） | `multi_male_wanqudashu_moon_bigtts` | 日语、西语 | 豆包 1.0 | 插件没有；与中文「湾区大叔」（`zh_female_wanqudashu_moon_bigtts`）**不是同一个 ID** |
| loongtomoka-日语女 | `loongtomoka_v2` | 日语 | 阿里百炼 | 插件不支持该厂商 |
| loongtomoya-日语男 | `loongtomoya_v2` | 日语 | 阿里百炼 | 同上 |

> `multi_*` 是“一语双名”：中文表用中文角色名、日语表用日文名，ID 相同。不是两套音色。
>
> **实测补充（2026-11-05，本机火山账号）**：`seed-tts-2.0` 只接受 `*_uranus_bigtts` 与 `saturn_*_tob`；
> `*_moon_bigtts` / `*_mars_bigtts` / `*_jupiter_bigtts` / `multi_*` 一律回
> `55000000 resource ID is mismatched with speaker related resource`，表现是**有字没声**。
> 换成 `seed-tts-1.0` 也不行——该账号没有开通 1.0 资源（`45000030` resource not granted）。
> 所以这台机器上日语只有 Vivi 一条路。

### 2.2 参数层：豆包 2.0 的 `additions`

`/api/v3/tts/unidirectional` 的 `req_params.additions` 里：

- `explicit_language`：显式指定朗读语种，如 `ja`；语义是**只朗读该语种文本**，混排的其它语种会被跳过；
- `crosslingual`：多语种前端（`zh/en/ja/es-ms/id/pt-br`），适合中英日混说。

官方同时说明：2.0 中只有 `zh_xxx_xxxx_uranus_bigtts` 这类音色支持 nl/no/uk/fi/da/cs/hu/el/ro/hi/es-es 扩展语种。

**dsh-xiaozhi 两项都没发**：`src/voice/adapters/volc-http-tts.js:28-37` 只有 `text / speaker / model / audio_params`。

### 2.3 提示词层：`{{language}}`

Java/Python 分支有，Go 分支与 dsh-xiaozhi 都没有：

- Go：`config/config.yaml` 只有 `system_prompt`，无模板、无 `{{language}}`；
- 插件：`index.js:50-57` 只追加时间；`src/settings.js:55-67` 的 `voice.tts` 没有 `language` 字段。

### 2.4 ASR 层（可选）

`language_hints`（`config.yaml:604`）、qwen3-asr 的 `language`（`config.yaml:559`）、豆包多语种模式（`doubao_stream.py:57`）。听得懂日语要单独配。

## 3. 插件与官方数据的差距

把 `src/voice/voices.js` 的 101 条 `volc` 音色逐条比对官方 `ai_tts_voice`（同 ID 取最新一条）：

| 指标 | 数值 |
|---|---|
| 插件 volc 音色数 | 101 |
| 能找到同 ID | 38（其中 2.0 表 9 条、1.0 表 17 条、其余 12 条只在旧网关/HTTP 表） |
| 名字实质不一致（去掉「（女声）」后仍不同） | 5 |
| 官方表里没有该 ID（1.0 专属 / ICL 复刻 / 已下架） | 63 |

**同名不同 ID / 同 ID 不同名**是主要坑：

| 插件标签 | 音色 ID | 官方最新名 | 官方语种 |
|---|---|---|---|
| 小何（女声） | `zh_female_xiaohe_uranus_bigtts` | 湾湾小何（旧种子文件里叫「小何」） | 普通话、英语 |
| 湾湾小何（女声） | `zh_female_wanwanxiaohe_moon_bigtts` | 湾湾小何（1.0，台湾口音） | 中文 |
| 天才同桌（男声） | `saturn_zh_male_tiancaitongzhuo_tob` | 爽朗少年（官方种子写错名） | 普通话、英语 |
| 高冷御姐（女声） | `zh_female_gaolengyujie_moon_bigtts` | 高冷御姐（日语表里同 ID 叫「あけみ（朱美）」） | 中文 |

结论：现在的下拉框只能“选个声音”，选不出“这个声音会说哪些语言”。

## 4. 能抄吗？分四档

### A. 音色 → 语种 数据（建议抄，纯数据、零风险）

官方 `ai_tts_voice` 共 206 个唯一音色 ID（跨厂商按 ID 去重），含 `languages` 与 demo URL。做法：给 `VOICE_OPTIONS` 每项补 `languages`；下拉按语种分组/过滤；标签显示「Vivi（女声·日语/印尼语/西语）」。新增音色跑脚本导出，不手抄（官方种子自己有错行）。

### B. 语种字段 + 提示词指令（建议抄，改动小、收益最大）

对应 Java 的 `tts_language` + `<output_language_directive>`，落到插件四处：

1. `src/settings.js` 的 `voice.tts` 加 `language`（空 = 不干预）；
2. `src/profiles.js` 档案加 `tts.language` 并进 fingerprint（否则改语种不重建会话）；
3. `index.js` 的 `withClock` 旁边加 `withLanguage(prompt, language)`；
4. `src/client/agents/AgentConfigDialog.js` 角色页加「输出语种」下拉（普通话/英语/日语/粤语/韩语）。

### C. 豆包 2.0 语种参数（可抄，要灰度）

在 `volc-http-tts.js` 的 `req_params` 补 `additions: JSON.stringify({ explicit_language: 'ja' })`。风险：explicit_language 是过滤语义；只有多语种音色认；1.0 音色配 2.0 资源族会报错（Go：`internal/domain/tts/doubao/model.go:190-192`）。

### D. 角色文案库（抄不到）

图 2 那种 `# Role: … ## 人设标签 ## 互动方式` 成稿是云端/用户产物，仓库只有 5 条官方模板（附录 B）和 3 条 Go 默认角色（`setup.go:154-173`：助手/老师/朋友）。要做“角色即音色”的一键预设，只能自建 `{ name, prompt, 推荐 voice, language }`。

## 5. 最小落地顺序

1. 导出音色表（含 languages）→ 增强 `voices.js` + UI 语种标签/过滤；
2. 加 `language` + 提示词指令 + fingerprint，先支持普通话/英语/日语；
3. 用 Vivi 跑通日语端到端；
4. 再加 `explicit_language` 与 ASR 语种提示；
5. 角色预设最后做（产品问题，不是数据问题）。

验收：同一句中文提问，语种=日语 → 输出全日语、Vivi 正常出声；切回普通话立即恢复；改语种在下一次连接生效。

## 附录 A：官方音色表结构

```sql
CREATE TABLE `ai_tts_voice` (
  `id` VARCHAR(32), `tts_model_id` VARCHAR(32), `name` VARCHAR(20),
  `tts_voice` VARCHAR(50), `languages` VARCHAR(50), `voice_demo` VARCHAR(500),
  `remark` VARCHAR(255), `sort` INT, ...
)
```

## 附录 B：官方角色模板（Java 种子 5 条）

| 模板名 | 默认音色 | 角色设定首句 |
|---|---|---|
| 湾湾小何 | `TTS_EdgeTTS0001` | 我是{{assistant_name}}，来自中国台湾省的00后女生… |
| 星际游子 | 同上 | 我是{{assistant_name}}，编号TTZ-817，因量子纠缠被困在白色魔方中… |
| 英语老师 | 同上 | 我是一个叫{{assistant_name}}（Lily）的英语老师… |
| 好奇男孩 | 同上 | 我是一个叫{{assistant_name}}的8岁小男孩… |
| 汪汪队长 | 同上 | 我是一个名叫 {{assistant_name}} 的 8 岁小队长… |

来源 `202504092335.sql:5-75`。五条全用同一个 Edge 音色 → 模板与音色不绑定。

## 附录 C：豆包 2.0 音色全表

| 音色名 | 音色 ID | 语种 |
|---|---|---|
| Dacey | `en_female_dacey_uranus_bigtts` | 英语 |
| Stokie | `en_female_stokie_uranus_bigtts` | 英语 |
| Tim | `en_male_tim_uranus_bigtts` | 英语 |
| Vivi | `zh_female_vv_uranus_bigtts` | 普通话、日语、印尼语、墨西哥西班牙语 |
| 云舟 | `zh_male_m191_uranus_bigtts` | 普通话、英语 |
| 佩奇猪 | `zh_female_peiqi_uranus_bigtts` | 普通话、英语 |
| 儒雅逸辰 | `zh_male_ruyayichen_uranus_bigtts` | 普通话、英语 |
| 刘飞 | `zh_male_liufei_uranus_bigtts` | 普通话、英语 |
| 古风少御 | `zh_female_gufengshaoyu_uranus_bigtts` | 普通话、英语 |
| 可爱女生 | `saturn_zh_female_keainvsheng_tob` | 普通话、英语 |
| 唐僧 | `zh_male_tangseng_uranus_bigtts` | 普通话、英语 |
| 大壹 | `zh_male_dayi_uranus_bigtts` | 普通话、英语 |
| 奶气萌娃 | `zh_male_naiqimengwa_uranus_bigtts` | 普通话、英语 |
| 婆婆 | `zh_female_popo_uranus_bigtts` | 普通话、英语 |
| 小天 | `zh_male_taocheng_uranus_bigtts` | 普通话、英语 |
| 少年梓辛/Brayan | `zh_male_shaonianzixin_uranus_bigtts` | 普通话、英语 |
| 开朗姐姐 | `zh_female_kailangjiejie_uranus_bigtts` | 普通话、英语 |
| 悬疑解说 | `zh_male_xuanyijieshuo_uranus_bigtts` | 普通话、英语 |
| 撒娇学妹 | `zh_female_sajiaoxuemei_uranus_bigtts` | 普通话、英语 |
| 流畅女声 | `zh_female_liuchangnv_uranus_bigtts` | 普通话、英语 |
| 清新女声 | `zh_female_qingxinnvsheng_uranus_bigtts` | 普通话、英语 |
| 温婉珊珊 | `saturn_zh_female_wenwanshanshan_cs_tob` | 普通话、英语 |
| 温暖阿虎/Alvin | `zh_male_wennuanahu_uranus_bigtts` | 普通话、英语 |
| 湾湾小何 | `zh_female_xiaohe_uranus_bigtts` | 普通话、英语 |
| 爽快思思 | `zh_female_shuangkuaisisi_uranus_bigtts` | 普通话、英语 |
| 爽朗少年 | `saturn_zh_male_shuanglangshaonian_tob` | 普通话、英语 |
| 爽朗少年 | `saturn_zh_male_tiancaitongzhuo_tob` | 普通话、英语 |
| 猪八戒 | `zh_male_zhubajie_uranus_bigtts` | 普通话、英语 |
| 猴哥 | `zh_male_sunwukong_uranus_bigtts` | 普通话、英语 |
| 甜美小源 | `zh_female_tianmeixiaoyuan_uranus_bigtts` | 普通话、英语 |
| 甜美桃子 | `zh_female_tianmeitaozi_uranus_bigtts` | 普通话、英语 |
| 知性灿灿 | `zh_female_cancan_uranus_bigtts` | 普通话、英语 |
| 调皮公主 | `saturn_zh_female_tiaopigongzhu_tob` | 普通话、英语 |
| 轻盈朵朵 | `saturn_zh_female_qingyingduoduo_cs_tob` | 普通话、英语 |
| 邻家女孩 | `zh_female_linjianvhai_uranus_bigtts` | 普通话、英语 |
| 阳光青年 | `zh_male_yangguangqingnian_uranus_bigtts` | 普通话、英语 |
| 霸气青叔 | `zh_male_baqiqingshu_uranus_bigtts` | 普通话、英语 |
| 魅力女友 | `zh_female_meilinvyou_uranus_bigtts` | 普通话、英语 |
| 魅力苏菲 | `zh_female_sophie_uranus_bigtts` | 普通话、英语 |
| 鸡汤女 | `zh_female_jitangnv_uranus_bigtts` | 普通话、英语 |
| 黑猫侦探社咪仔 | `zh_female_mizai_uranus_bigtts` | 普通话、英语 |

## 附录 D：插件 101 条 volc 音色 ↔ 官方

| 插件标签 | 音色 ID | 官方名 | 官方语种 | 官方来源 |
|---|---|---|---|---|
| 灿灿 / Shiny（女声） | `zh_female_cancan_mars_bigtts` | 灿灿/Shiny | 中文、美式英语 | TTS_VolcesAiGatewayTTS |
| vivi 2.0（女声） | `zh_female_vv_uranus_bigtts` | Vivi | 普通话、日语、印尼语、墨西哥西班牙语 | TTS_HSDSTTS_V2 |
| vivi O版（女声） | `zh_female_vv_jupiter_bigtts` | — | — | 官方表无此 ID |
| 小何 O版（女声） | `zh_female_xiaohe_jupiter_bigtts` | — | — | 官方表无此 ID |
| 知性灿灿（女声） | `saturn_zh_female_cancan_tob` | — | — | 官方表无此 ID |
| 可爱女生（女声） | `saturn_zh_female_keainvsheng_tob` | 可爱女生 | 普通话、英语 | TTS_HSDSTTS_V2 |
| 调皮公主（女声） | `saturn_zh_female_tiaopigongzhu_tob` | 调皮公主 | 普通话、英语 | TTS_HSDSTTS_V2 |
| 小何（女声） | `zh_female_xiaohe_uranus_bigtts` | 湾湾小何 | 普通话、英语 | TTS_HSDSTTS_V2 |
| 甜美桃子（女声） | `zh_female_tianmeitaozi_mars_bigtts` | — | — | 官方表无此 ID |
| 湾湾小何（女声） | `zh_female_wanwanxiaohe_moon_bigtts` | 湾湾小何 | 中文 | TTS_HuoshanDoubleStreamTTS |
| 亲切女声（女声） | `zh_female_qinqienvsheng_moon_bigtts` | — | — | 官方表无此 ID |
| Vivi（女声） | `zh_female_vv_mars_bigtts` | — | — | 官方表无此 ID |
| 甜美小源（女声） | `zh_female_tianmeixiaoyuan_moon_bigtts` | 甜美小源 | 中文 | TTS_VolcesAiGatewayTTS |
| 清澈梓梓（女声） | `zh_female_qingchezizi_moon_bigtts` | 清澈梓梓 | 中文 | TTS_VolcesAiGatewayTTS |
| 开朗姐姐（女声） | `zh_female_kailangjiejie_moon_bigtts` | 开朗姐姐 | 中文 | TTS_VolcesAiGatewayTTS |
| 甜美悦悦（女声） | `zh_female_tianmeiyueyue_moon_bigtts` | 甜美悦悦 | 中文 | TTS_VolcesAiGatewayTTS |
| 心灵鸡汤（女声） | `zh_female_xinlingjitang_moon_bigtts` | 心灵鸡汤 | 中文 | TTS_VolcesAiGatewayTTS |
| 知性女声（女声） | `zh_female_zhixingnvsheng_mars_bigtts` | 知性女声 | 中文 | TTS_VolcesAiGatewayTTS |
| 温柔淑女（女声） | `zh_female_wenroushunv_mars_bigtts` | — | — | 官方表无此 ID |
| 温柔小雅（女声） | `zh_female_wenrouxiaoya_moon_bigtts` | — | — | 官方表无此 ID |
| 邻家女孩（女声） | `zh_female_linjianvhai_moon_bigtts` | 邻家女孩 | 中文 | TTS_HuoshanDoubleStreamTTS |
| 爽快思思/Skye（女声） | `zh_female_shuangkuaisisi_moon_bigtts` | 爽快思思/Skye | 中文、英文 | TTS_HuoshanDoubleStreamTTS |
| 高冷御姐（女声） | `zh_female_gaolengyujie_moon_bigtts` | 高冷御姐 | 中文 | TTS_HuoshanDoubleStreamTTS |
| 魅力女友（女声） | `zh_female_meilinvyou_moon_bigtts` | 魅力女友 | 中文 | TTS_HuoshanDoubleStreamTTS |
| 柔美女友（撒娇）（女声） | `zh_female_sajiaonvyou_moon_bigtts` | 柔美女友 | 中文 | TTS_HuoshanDoubleStreamTTS |
| 撒娇学妹（女声） | `zh_female_yuanqinvyou_moon_bigtts` | 撒娇学妹 | 中文 | TTS_HuoshanDoubleStreamTTS |
| 温柔女神（女声） | `ICL_zh_female_wenrounvshen_239eff5e8ffa_tob` | — | — | 官方表无此 ID |
| 纯真少女（女声） | `ICL_zh_female_chunzhenshaonv_e588402fb8ad_tob` | — | — | 官方表无此 ID |
| 精灵向导（女声） | `ICL_zh_female_jinglingxiangdao_1beb294a9e3e_tob` | — | — | 官方表无此 ID |
| 贴心妹妹（女声） | `ICL_zh_female_yilin_tob` | — | — | 官方表无此 ID |
| 成熟姐姐（女声） | `ICL_zh_female_chengshujiejie_tob` | — | — | 官方表无此 ID |
| 病娇姐姐（女声） | `ICL_zh_female_bingjiaojiejie_tob` | — | — | 官方表无此 ID |
| 妩媚御姐（女声） | `ICL_zh_female_wumeiyujie_tob` | — | — | 官方表无此 ID |
| 傲娇女友（女声） | `ICL_zh_female_aojiaonvyou_tob` | — | — | 官方表无此 ID |
| 贴心女友（女声） | `ICL_zh_female_tiexinnvyou_tob` | — | — | 官方表无此 ID |
| 性感御姐（女声） | `ICL_zh_female_xingganyujie_tob` | — | — | 官方表无此 ID |
| 理性圆子（客服女声） | `ICL_zh_female_lixingyuanzi_cs_tob` | — | — | 官方表无此 ID |
| 元气甜妹（女声） | `ICL_zh_female_wuxi_tob` | — | — | 官方表无此 ID |
| 知性温婉（女声） | `ICL_zh_female_zhixingwenwan_tob` | 知性温婉 | 中文 | TTS_VolcesAiGatewayTTS |
| 爽朗少年（男声） | `saturn_zh_male_shuanglangshaonian_tob` | 爽朗少年 | 普通话、英语 | TTS_HSDSTTS_V2 |
| 天才同桌（男声） | `saturn_zh_male_tiancaitongzhuo_tob` | 爽朗少年 | 普通话、英语 | TTS_HSDSTTS_V2 |
| 云舟 O版（男声） | `zh_male_yunzhou_jupiter_bigtts` | — | — | 官方表无此 ID |
| 小天 O版（男声） | `zh_male_xiaotian_jupiter_bigtts` | — | — | 官方表无此 ID |
| 云舟（男声） | `zh_male_m191_uranus_bigtts` | 云舟 | 普通话、英语 | TTS_HSDSTTS_V2 |
| 小天（男声） | `zh_male_taocheng_uranus_bigtts` | 小天 | 普通话、英语 | TTS_HSDSTTS_V2 |
| Tim（英文男声） | `en_male_tim_uranus_bigtts` | Tim | 英语 | TTS_HSDSTTS_V2 |
| 阳光青年（男声） | `zh_male_yangguangqingnian_moon_bigtts` | 阳光青年 | 中文 | TTS_HuoshanDoubleStreamTTS |
| 清爽男大（男声） | `zh_male_qingshuangnanda_mars_bigtts` | 清爽男大 | 中文 | TTS_VolcesAiGatewayTTS |
| 温柔小哥（男声） | `zh_male_wenrouxiaoge_mars_bigtts` | 温柔小哥 | 中文 | TTS_VolcesAiGatewayTTS |
| 擎苍（男声） | `zh_male_qingcang_mars_bigtts` | — | — | 官方表无此 ID |
| 儒雅青年（男声） | `zh_male_ruyaqingnian_mars_bigtts` | — | — | 官方表无此 ID |
| 解说小明（男声） | `zh_male_jieshuoxiaoming_moon_bigtts` | 解说小明 | 中文 | TTS_VolcesAiGatewayTTS |
| 邻家男孩（男声） | `zh_male_linjiananhai_moon_bigtts` | 邻家男孩 | 中文 | TTS_VolcesAiGatewayTTS |
| 渊博小叔（男声） | `zh_male_yuanboxiaoshu_moon_bigtts` | 渊博小叔 | 中文 | TTS_HuoshanDoubleStreamTTS |
| 温暖阿虎/Alvin（男声） | `zh_male_wennuanahu_moon_bigtts` | 温暖阿虎/Alvin | 中文、英文 | TTS_HuoshanDoubleStreamTTS |
| 少年梓辛/Brayan（男声） | `zh_male_shaonianzixin_moon_bigtts` | 少年梓辛/Brayan | 中文、英文 | TTS_HuoshanDoubleStreamTTS |
| 北京小爷（男声） | `zh_male_beijingxiaoye_moon_bigtts` | 北京小爷 | 中文 | TTS_HuoshanDoubleStreamTTS |
| 京腔侃爷/Harmony（男声） | `zh_male_jingqiangkanye_moon_bigtts` | 京腔侃爷/Harmony | 中文、英文 | TTS_HuoshanDoubleStreamTTS |
| 广州德哥（男声） | `zh_male_guozhoudege_moon_bigtts` | 广州德哥 | 中文 | TTS_HuoshanDoubleStreamTTS |
| 浩宇小哥（男声） | `zh_male_haoyuxiaoge_moon_bigtts` | 浩宇小哥 | 中文 | TTS_HuoshanDoubleStreamTTS |
| 深夜播客（男声） | `zh_male_shenyeboke_moon_bigtts` | 深夜播客 | 中文 | TTS_HuoshanDoubleStreamTTS |
| 傲娇霸总（男声） | `zh_male_aojiaobazong_moon_bigtts` | 傲娇霸总 | 中文 | TTS_HuoshanDoubleStreamTTS |
| 东方浩然（男声） | `zh_male_dongfanghaoran_moon_bigtts` | — | — | 官方表无此 ID |
| 悠悠君子/Lucas（男声） | `zh_male_M100_conversation_wvae_bigtts` | — | — | 官方表无此 ID |
| 快乐小东/Daníel（男声） | `zh_male_xudong_conversation_wvae_bigtts` | — | — | 官方表无此 ID |
| 阳光阿辰（男声） | `zh_male_qingyiyuxuan_mars_bigtts` | — | — | 官方表无此 ID |
| 开朗学长（男声） | `en_male_jason_conversation_wvae_bigtts` | — | — | 官方表无此 ID |
| 冷酷哥哥（男声） | `ICL_zh_male_lengkugege_v1_tob` | — | — | 官方表无此 ID |
| 机灵小伙（男声） | `ICL_zh_male_shenmi_v1_tob` | — | — | 官方表无此 ID |
| 炀炀（男声） | `ICL_zh_male_BV705_streaming_cs_tob` | — | — | 官方表无此 ID |
| 闷油瓶小哥（男声） | `ICL_zh_male_menyoupingxiaoge_ffed9fc2fee7_tob` | — | — | 官方表无此 ID |
| 黯刃秦主（男声） | `ICL_zh_male_anrenqinzhu_cd62e63dcdab_tob` | — | — | 官方表无此 ID |
| 孤傲公子（男声） | `ICL_zh_male_guaogongzi_v1_tob` | — | — | 官方表无此 ID |
| 病弱公子（男声） | `ICL_zh_male_bingruogongzi_tob` | — | — | 官方表无此 ID |
| 病娇弟弟（男声） | `ICL_zh_male_bingjiaodidi_tob` | — | — | 官方表无此 ID |
| 傲慢少爷（男声） | `ICL_zh_male_aomanshaoye_tob` | — | — | 官方表无此 ID |
| 纯真学弟（男声） | `ICL_zh_male_chunzhenxuedi_tob` | — | — | 官方表无此 ID |
| 优柔公子（男声） | `ICL_zh_male_yourougongzi_tob` | — | — | 官方表无此 ID |
| 贴心男友（男声） | `ICL_zh_male_tiexinnanyou_tob` | — | — | 官方表无此 ID |
| 少年将军（男声） | `ICL_zh_male_shaonianjiangjun_tob` | — | — | 官方表无此 ID |
| 病娇哥哥（男声） | `ICL_zh_male_bingjiaogege_tob` | — | — | 官方表无此 ID |
| 学霸男同桌（男声） | `ICL_zh_male_xuebanantongzhuo_tob` | — | — | 官方表无此 ID |
| 幽默叔叔（男声） | `ICL_zh_male_youmoshushu_tob` | — | — | 官方表无此 ID |
| 温柔男同桌（男声） | `ICL_zh_male_wenrounantongzhuo_tob` | — | — | 官方表无此 ID |
| 幽默大爷（男声） | `ICL_zh_male_youmodaye_tob` | — | — | 官方表无此 ID |
| 神秘法师（男声） | `ICL_zh_male_shenmifashi_tob` | — | — | 官方表无此 ID |
| 冷峻上司（男声） | `ICL_zh_male_lengjunshangsi_tob` | — | — | 官方表无此 ID |
| Michael（美式英语男声） | `ICL_en_male_michael_tob` | — | — | 官方表无此 ID |
| 鲁班七号（男声） | `zh_male_lubanqihao_mars_bigtts` | — | — | 官方表无此 ID |
| 林潇（女声） | `zh_female_yangmi_mars_bigtts` | — | — | 官方表无此 ID |
| 玲玲姐姐（女声） | `zh_female_linzhiling_mars_bigtts` | — | — | 官方表无此 ID |
| 春日部姐姐（女声） | `zh_female_jiyejizi2_mars_bigtts` | — | — | 官方表无此 ID |
| 唐僧（男声） | `zh_male_tangseng_mars_bigtts` | — | — | 官方表无此 ID |
| 猪八戒（男声） | `zh_male_zhubajie_mars_bigtts` | — | — | 官方表无此 ID |
| 直率英子（女声） | `zh_female_naying_mars_bigtts` | — | — | 官方表无此 ID |
| 女雷神（女声） | `zh_female_leidian_mars_bigtts` | — | — | 官方表无此 ID |
| 猴哥（男声） | `zh_male_sunwukong_mars_bigtts` | — | — | 官方表无此 ID |
| 熊二（男声） | `zh_male_xionger_mars_bigtts` | — | — | 官方表无此 ID |
| 佩奇猪（女声） | `zh_female_peiqi_mars_bigtts` | — | — | 官方表无此 ID |
| 樱桃丸子（女声） | `zh_female_yingtaowanzi_mars_bigtts` | — | — | 官方表无此 ID |
| 四郎（男声） | `zh_male_silang_mars_bigtts` | — | — | 官方表无此 ID |

## 附录 E：已落地的改动（2026-11-05）

按第 4 节的 A/B/C 三档实现，D（角色文案库）按结论不做。

| 改动 | 文件 | 说明 |
|---|---|---|
| 音色语种 | `src/voice/voices.js` | 105 条 volc 音色；38 条补上官方 `languages`，末尾新增 4 条 `multi_*` 日语音色 |
| 语种白名单/指令 | `src/voice/language.js`（新增） | 普通话/英语/日语/粤语/韩语；`<output_language_directive>`；非白名单值退化为空 |
| 提示词注入 | `index.js` | `withOutputLanguage(withClock(prompt), tts.language)`；adapter 缓存 key 补进 provider/voice/language |
| 运行时配置 | `src/settings.js` | `voice.tts.language`（白名单）；顺手修掉 tts patch 里 `llm`/`asr` 越界引用会抛错的老问题 |
| 智能体级覆盖 | `src/control.js` + `src/agents.js` | `/agents/update` 接受 `language`（`/devices/config` 为兼容入口），非白名单折叠为空（空 = 删覆盖、回落全局） |
| 豆包参数 | `src/voice/adapters/volc-http-tts.js` | 非中文时补 `req_params.additions.explicit_language`（`en`/`ja`/`ko`）；`55000000` 翻成人话 |
| 控制台 | `src/client/agents/AgentConfigDialog.js` | 设备「角色」页加输出语种；音色下拉按 Resource ID 过滤同代音色；2026-11-08 起音色只在设备级选（全局 TTS 不再配音色），下拉首项「默认音色」= 用厂商默认 |
| 资源族护栏 | `src/voice/voices.js`、`index.js` | 每条 volc 音色标 `tier`（2.0 / 1.x）；会话建立时若音色与资源不同代，直接打 error 说明「有字没声」的原因 |
| 测试 | `test/voice-language.test.mjs`（新增）、`voices.test.mjs`、`vendors.test.mjs`、`settings.test.mjs`、`http.test.mjs` | 白名单、指令拼接、音色语种匹配、additions、资源族过滤、设备覆盖；全量 78 项 |

粤语没有 `explicit_language` 码，因此只走提示词 + 音色本身。`multi_*` 这类 1.x 音色不仅需要把 Resource ID 换成 `seed-tts-1.0`，账号还必须真的开通该资源；本机账号只有 2.0（实测 `45000030`），所以那 4 条日语 `multi_*` 目前不可用。

> **2026-11-08 归属调整**：全局设置 → TTS 合成只配「厂商 + 凭据」，原先「配置向导 TTS 步骤加全局默认音色」的说法作废。音色（= TTS 模型族）改在「设备 → 配置 → 角色」按设备选，留空 = 厂商默认（`src/voice/voices.js` 的 `DEFAULT_TTS_VOICES`：火山 `zh_female_vv_uranus_bigtts` / Edge `zh-CN-XiaoxiaoNeural` / 讯飞 `xiaoyan`）；设备残留的跨厂商音色由 `resolveTtsVoice` 回落为本厂商默认。输出语种仍是全局默认 + 设备级覆盖。

## 附录 F：音色列表改为官方接口（2026-11-08）

**之前**：`src/voice/voices.js` 的内置清单（105 条 volc 音色，按官方文档整理），`GET /voices` 只是把它发给前端；
前端按 `resourceId` 过滤 1.x / 2.0。**无法知道某个音色在当前账号下是否真的开通**。

**现在**：火山官方「大模型音色列表」`ListSpeakers`（Action=`ListSpeakers`，Version=`2025-05-20`，
Service=`speech_saas_prod`，Region=`cn-beijing`）——已核对官方文档：
<https://docs.volcengine.com/docs/doubao-voice/list-speakers-large-model-sound-list-new-interface>

- 鉴权是 **AK/SK HMAC-SHA256 签名**（`open.volcengineapi.com`），不是 TTS 数据面的 `X-Api-Key`；
  所以控制台的火山 TTS 主用配置里增加了**可选的** `AccessKey ID` / `SecretAccessKey`（复用
  `appId` / `apiSecret` 两个存储槽位，只出现在主用编辑弹窗，备用条目不需要）。
- 签名实现：`src/voice/volc-sign.js`；用官方文档里的 GET/POST 固定向量做了单测
  （`test/volc-sign.test.mjs`），不是凭记忆写的。
- 拉取/分页/缓存：`src/voice/volc-speakers.js`（`Limit=100`，最多 5 页，缓存 10 分钟）。
- `GET /voices?provider=volc&resourceId=seed-tts-2.0`：配置了 AK/SK 就返回官方 `Speakers[]`
  （`source:'api'`）；没配置/调用失败则回内置清单（`source:'catalog'`，带 `error`）。
- 前端 `AgentConfigDialog` 打开时按「全局 TTS provider + resourceId」拉一次；`source==='api'`
  显示「音色来自火山官方接口」，回退时显示「未配置 AccessKey/SecretKey，当前为内置清单，可能含未开通音色」。

**边界**：
- AK/SK 只用于拉音色列表，**合成仍然用 `X-Api-Key`**；两套凭据不要混。
- 官方列表是「该账号/资源下可用的音色」，不是「已购买」的精确账单；1.x 资源（`multi_*` 等）仍需账号实际开通。
- 真实 AK/SK 的线上 `ListSpeakers` 调用**未在本次环境实测**（单测覆盖签名向量、分页、缓存、错误分支）；
  配好后点开智能体「角色」页即可验证。
