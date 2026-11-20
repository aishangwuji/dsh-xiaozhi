# 对话链路、判停与地址

> 本文来自原 `AGENTS.md` §2–§4，描述一次语音对话从 OTA 到音频下行、判停策略与 mDNS 地址选择。改协议、判停或地址逻辑前先读。

## 一次完整对话

1. 手表开机 → `Ota` 按顺序试地址（NVS `ota_url` → mDNS 发现 → 编译期 LAN → 云端），拿到 `websocket.url` 和 `token`。
2. 唤醒词/点屏幕 → `WS: Connecting to websocket server: ws://<host>:8989/xiaozhi/v1/`。
3. 设备发 `hello`（version/transport/audio_params），服务端回 `hello`（含 `session_id` 和音频参数）。
4. 设备发 `listen start`，持续上行 Opus（16k/60ms）；服务端 `VoiceSession` 解码成 PCM、喂 ASR。
5. 判到句尾 → 服务端回 `stt` 文本 → LLM 流式 → 分句 → TTS → 下行 Opus（24k/20ms），状态消息是 `tts start` / `sentence_start` / `sentence_end` / `stop`。
6. 设备状态只在收到 `tts start` / `tts stop` 时变（固件里没有客户端判停逻辑）。

服务端每台设备一个 `VoiceSession`，adapter 按「全局默认 + 智能体覆盖」缓存，**改了配置要重连才生效**；插件代码本身要重启 DSH 才生效（见 `AGENTS.md` §2「生效时机」）。

## 判停：当前是设备说了算

- 固件里 AFE VAD 的参数来自 `main/audio/engines/afe_audio_engine.cc`：`vad_mode = VAD_MODE_2`、`vad_min_noise_ms = 300`（2026-11-06 为抗环境音误触发从 0/100 调到 300；2026-11-15 试过 500 又还原——500ms 对用户太迟钝，句中停顿交给服务端续话窗口兜底，**不再改固件值**）。
- **续话窗口（2026-11-15）**：设备发 `listen stop` 后服务端不再立刻收口，先等 `continuationMs`（默认 300ms）；窗口内又出现说话能量（RMS > `continuationThreshold`，默认 0.02）就取消收口，同一段话继续喂 ASR。见 `session.js` 的 `#scheduleFinalize` / `#onPcm` / `#cancelPendingFinalize`，trace 记 `listen.grace` 与 `turn.continue`。
- 固件在 `application.cc` 的 `MAIN_EVENT_VAD_CHANGE` 里记 `vad_speaking_`，从"说话"转到"静音"且处于 listening 时发 `listen stop`，串口打印 `VAD end of speech, sending listen stop`。
- 服务端 `voice.vadMode` 默认 `device`：收到 `listen stop` 才收口，音频持续喂 ASR，不再用自己的阈值判句尾。
- `vadMode: energy` 是给"不发 listen stop 的老固件"留的兜底：`silenceMs 400`（对齐 Go 服务端 `chat_max_silence_duration`），`minSpeechMs 120` / `vadThreshold 0.03` 是能量 VAD 自己的参数，和原厂神经 VAD 的 0.5/0.4 不是一个量纲。

## 地址：mDNS 优先，云端兜底

- 插件在 `src/mdns.js` 广播 `_xiaozhi._tcp`：SRV 端口 8989、TXT `path=/xiaozhi/ota/`、A 记录是本机 IPv4，主机名 `xiaozhi.local`。每 60 秒重新取一次地址再广播。
- **应答必须单播（2026-11-14 实测修）**：esp-idf 的 `mdns_query_ptr` 发出的查询是 `QU=0`（手表串口抓到的
  `qu=false`），旧逻辑只在 `QU=1` 时才单播、其余只发 multicast；这台机器有 VMware / Clash TUN 等虚拟网卡，
  Windows 上 multicast 出口由路由表决定，回答会从 `192.168.10.1` 之类的虚拟网卡出去，手表永远收不到，
  于是每次开机都 `mDNS: no _xiaozhi._tcp service` → 回落官方云。现在**一律先单播回查询方**（`rinfo`），
  再按查询方所在网段补一包 multicast；没有来源时才按所有 LAN 网卡逐个发。
  实测证据：临时应答器改成单播后，手表立刻日志 `Ota: mDNS: found 192.168.43.10 -> http://192.168.43.10:8989/xiaozhi/ota/`
  并走本地 OTA（`No mqtt section found` → WebSocket），不再连 `api.tenclass.net`。
- 这台机器同时有 Clash TUN（`198.18.0.0`）、`2.0.1.9`、VMware 网段、`169.254.x` 这些地址，多播默认跟着路由表走会从 TUN 出去。当前的做法：只广播 RFC1918 + `100.64/10`（`isLanAddress`），公告按网卡逐个发（`setMulticastInterface`），回答查询时从查询方所在网段回。
- 固件 `ota.cc` 的 `ResolveOtaUrlFromMdns()` 查 `_xiaozhi._tcp`，用 SRV 的 host/port 和 TXT 的 path 拼出 `http://<ip>:8989/xiaozhi/ota/`，串口打印 `mDNS: found ...`；一条公告里有多个 A 记录时，挑与手表自己同网段的那个（`esp_netif_get_ip_info` 拿自身 IP/掩码）。
- 候选顺序：NVS 手工 `ota_url` → mDNS → 编译期 `CONFIG_OTA_URL_LAN`（当前为空）→ `CONFIG_OTA_URL`（云端 `https://api.tenclass.net/xiaozhi/ota/`）。
- mDNS 查不到（路由器隔离多播等）时自然落到云端，设备仍然能用，只是换成了小智官方服务。
- OTA 返回的 `websocket.url` 是按请求的 `Host` 拼的，设备走哪条 OTA 就拿到哪一侧的地址。

