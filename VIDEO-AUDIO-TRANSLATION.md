# 视频语音实时翻译 · 可行性调研与实施方案

> 需求：在网页里**右键一个 `<video>` 元素**，实时取到这个视频的语音，实时翻译出来。
> 本文所有「实测」结论都来自本机真实 Chrome 跑出来的结果，不是查资料推断的。

---

## 一、结论

**可行，而且不需要新增任何「看着吓人」的权限。**

核心技术动作只有一个：对 `<video>` 元素调用 `HTMLMediaElement.captureStream()`，
拿到一条**非破坏性**的音轨——用户照常听原声，我们同时得到一份音频副本。

关键结论一览（实测）：

| 问题 | 结论 |
| --- | --- |
| 能不能从 `<video>` 单独取音频 | ✅ 能，`captureStream()` 返回 1 条音轨 |
| 取到的是不是真声音 | ✅ 是。实测解码后 RMS 0.088、峰值 0.149，**主频正好 440 Hz**（与测试片源一致） |
| 会不会影响用户继续听 | ✅ 不影响：`muted=false`、`volume=1`、不停播、播放进度正常推进 |
| 能不能持续拿到数据流 | ✅ 能，MediaRecorder 每 250ms 稳定产出一片（约 1.25 KB / 32 kbps） |
| 真实站点行不行（YouTube） | ✅ 行，视频源是 `blob:`（MSE，同源），`captureStream()` 正常返回音轨 |
| 跨域视频行不行 | ❌ **直接抛错**：`Cannot capture from element with cross-origin data` |
| DRM 视频（Netflix 等） | ❌ 预期不可用（拿不到解密后音频），需人工确认 |

---

## 二、实测记录

环境：本机 Chrome for Testing 150（无头）+ 本地静态服务，测试片源为 ffmpeg 生成的
24 秒 440 Hz 正弦音视频（`tools/capture/pages/tone.mp4`）。

### 实验 1：同源视频（`http://localhost:8796/tone.mp4`）

```
captureStream：ok
音轨：{"audio":1,"video":1,"audioEnabled":true}
chunk 节奏：[315ms/1146B, 605ms/1245B, 903ms/1246B, 1202ms/1246B, 1500ms/1246B, 1803ms/1246B]
解码结果：{seconds:3.18, sampleRate:48000, channels:1, rms:0.0883, peak:0.149, peakFreq:440}
元素状态：{muted:false, volume:1, paused:false, currentTime:3.19}   ← 用户照常听
```

要点：**250ms 一片、每片 1.25 KB**，即约 5 KB/s（opus 32 kbps）。
这个量级对任何上行链路都不构成压力。

### 实验 2：跨域视频（页面在 :8796，视频在 :8797，服务端不发 CORS 头）

```
captureStream: throw
error: "Failed to execute 'captureStream' on 'HTMLMediaElement':
        Cannot capture from element with cross-origin data"
```

**这是整个方案最重要的分叉点**：跨域直链视频（大量 CDN 直链站）取不到音频，
而且不是「静音」，是明确抛错——所以能被捕获到、可以走降级路径。

### 实验 3：真实站点 YouTube

```
video: true
srcKind: blob(MSE)      ← 关键：MSE 用 blob: URL，属于同源
captureStream: ok
音轨：1 条
```

这解释了为什么「YouTube 能行、CDN 直链不行」：主流视频站走 MSE，
媒体数据是 `blob:` 同源 URL，不受跨域限制。

---

## 三、音频来源的三条路径

| 路径 | 取到什么 | 适用 | 代价 |
| --- | --- | --- | --- |
| **A. `video.captureStream()`** | 只这个 video 的音轨，**非破坏性** | 同源 / MSE（YouTube、B 站、多数流媒体） | 无新权限；跨域站点抛错 |
| **B. `chrome.tabCapture`** | 整个标签页的音频 | A 失败时的兜底，跨域也管用 | 需 `tabCapture` 权限；**会掐掉用户听到的声音**，必须自己接回来；会把广告等杂音一起收进来 |
| **C. `createMediaElementSource`** | 元素音频（需自己接 destination） | 不推荐 | 会让音频改道，且同样受跨域限制 |

**建议**：主用 A，A 抛错时提示用户「这个视频源不允许抓取，是否改用整页声音（B）」。
B 的官方文档写得很明确（[chrome.tabCapture](https://developer.chrome.com/docs/extensions/reference/api/tabCapture)）：

> 当标签页获得 MediaStream 时，该标签页中的音频将不再向用户播放……如需继续向用户播放音频：
> `const output = new AudioContext(); const source = output.createMediaStreamSource(stream); source.connect(output.destination);`

另外，Chrome 116+ 起，**在 Service Worker 里拿到的 streamId 可以直接交给 offscreen document 使用**，
这条正是我们需要的形态。

---

## 四、推荐架构

```
网页（内容脚本，运行在 video 所在的 frame）
  │  1. 右键菜单「实时翻译这个视频」→ 后台把 translate-video 发给该 frame
  │  2. video.captureStream() → 取音轨 → AudioContext(24000Hz)
  │     → ScriptProcessor/Worklet 出 PCM16 → base64
  │  3. chrome.runtime.sendMessage 直接发给 offscreen（每 100ms 一包，约 6.4 KB）
  ▼
offscreen document（扩展自己的源，不受网页 CSP / CORS 影响）
  │  4. 拿到用户 API Key → POST /v1/realtime/translations/client_secrets 换临时密钥
  │  5. WebSocket 连 /v1/realtime/translations（base64 PCM16 24kHz）
  │  6. 收 transcript delta（译文文本）
  ▼
后台 Service Worker
  │  7. 转发给发起翻译的那个标签页
  ▼
网页：字幕浮层（Shadow DOM，挂在 video 的容器上，跟随尺寸与全屏）
```

### 为什么网络请求不放在内容脚本里

内容脚本的 fetch/WebSocket **按网页的源计算 CORS，并受网页 CSP 约束**；
换成在 offscreen document 里发，用的是扩展自己的源，有 host permission 就能直连，
也不会被站点的 `connect-src` 掐掉。内容脚本只负责「取音频」这一件只有它能做的事。

### 数据量

| 形态 | 码率 | 说明 |
| --- | --- | --- |
| PCM16 24kHz 单声道（realtime 要求） | 48 KB/s | base64 后 64 KB/s |
| base64 后按 100ms 分片 | 6.4 KB/片 | chrome.runtime 消息完全无压力 |
| opus 32kbps（另一条路线） | 4 KB/s | 走「STT 服务商 + 现有文本翻译」时更省 |

---

## 五、翻译怎么做：两条路线

### 路线 1（推荐先做）：实时语音翻译 API，一步到位

OpenAI 现在有**专用的连续语音翻译会话**（[Realtime translation](https://developers.openai.com/api/docs/guides/realtime-translation)）：

- 模型 `gpt-realtime-translate`，端点 `/v1/realtime/translations`（与语音助手会话的 `/v1/realtime` 不同）
- 传输：浏览器侧推荐 **WebRTC**；服务端侧用 **WebSocket**（base64 PCM16 24kHz）
- 特点：**说话人还在说，译文文本与译文音频就在往外流**；不需要 `response.create`，持续灌音频即可
- 临时密钥：`POST /v1/realtime/translations/client_secrets`（用用户自己的 Key，在 offscreen 里发，不暴露给网页）

优点：链路最短、延迟最低、**一个接口同时给出译文文本（字幕）和译文语音（配音）**。
缺点：只有 OpenAI 一家（DeepSeek 无音频接口、DeepL 是纯文本 MT），成本按音频时长计。

### 路线 2：拆分链路（可复用现有 provider 层）

```
流式 STT（Deepgram / AssemblyAI / Azure Speech / OpenAI 转写）
   → 现有 AITrProviders.translate()（流式翻译，已经写好）
   → 字幕
```
优点：翻译层完全复用他们现有的设置页、多平台切换、流式解析；
缺点：多一跳，端到端延迟通常比路线 1 多 0.5–1.5 秒。

### 呈现形态

| 形态 | 价值 | 复杂度 | 建议 |
| --- | --- | --- | --- |
| **双语字幕浮层** | 最高频、最不打扰，和现有「弹窗显示译文」的产品调性一致 | 低 | **P0 先做** |
| 译文语音（配音） | 看剧场景加分 | 高：要压原声、混音、处理打断 | P1 |
| 字幕 + 可选配音 | 完整体验 | 高 | P2 |

---

## 六、需要动的地方（对照现有代码）

| 位置 | 改动 |
| --- | --- |
| `manifest.json` | 新增 `offscreen` 权限；`contextMenus` 增加一个 `contexts: ['video']` 的菜单项；**主路径不需要 `tabCapture`** |
| `src/background.js` | 菜单点击 → 给该 frame 发 `translate-video`；创建/复用 offscreen document；转发译文事件 |
| `src/content/video.js`（新） | `captureStream()`、PCM 抽取、发给 offscreen、字幕浮层渲染 |
| `src/lib/providers.js` | 增加 realtime 会话（换临时密钥 / WebSocket 或 WebRTC） |
| `src/options/` | 新增开关「视频实时翻译」、目标语言沿用现有设置 |
| 字幕浮层 | 可直接复用 `content.js` 里那套 Shadow DOM + `all: initial` 的写法 |

现有的三块地基能直接复用：**全站内容脚本（`all_frames: true`）**、
**Shadow DOM 弹窗那套防站点样式污染的写法**、**provider 抽象与流式解析**。

---

## 七、已知的坑与风险

1. **全屏时字幕不可见**（必须提前设计）
   现有弹窗挂在 `document.body` 上，而全屏只渲染全屏元素子树。
   字幕浮层必须挂到**视频自己的容器**里，或者监听 `fullscreenchange` 把浮层搬过去。

2. **跨域直链视频取不到音频**（实测已确认）
   抛错而非静音，可以据此判断并降级到 `tabCapture` 或明确提示用户。

3. **DRM 内容不可用**（预期，未实测）
   Netflix / Disney+ / Spotify 网页版走 Widevine，`captureStream()` 拿不到解密音频。
   需要在产品文案里写清楚，避免用户以为是 bug。

4. **`tabCapture` 会掐掉标签页声音**
   一旦走兜底路径，必须立刻把流接回 `AudioContext.destination`，否则用户会以为「扩展把声音弄没了」。

5. **成本敏感**
   实时音频是按分钟计费的，看一部电影的成本可观。建议：默认只在用户点开启用时计费，
   界面上有明确的运行指示与一键停止；或只做「字幕」不做「配音」以降低音频出口成本。

6. **延迟预期要对**
   实时翻译会话是「边说边出」，但字幕仍会落后语音约 0.5–1.5 秒。
   产品上不要承诺「同传级零延迟」。

7. **MV3 生命周期**
   Service Worker 会休眠，音频与连接必须活在 offscreen document 里，
   由它持有 WebSocket/WebRTC，并在标签页关闭时主动收尾。

---

## 八、分阶段计划

| 阶段 | 内容 | 验收标准 |
| --- | --- | --- |
| **P0**（1–2 天） | 打通「右键 video → captureStream → PCM → 本地统计 RMS/时长」的链路，不接任何 API | 在 YouTube 上能持续拿到 24kHz PCM，RMS 与视频声音同步变化 |
| **P1**（3–5 天） | 接 `gpt-realtime-translate`，字幕浮层显示译文 | 看一段英文视频，字幕落后语音 ≤1.5 秒，能正确处理全屏与切换视频 |
| **P2**（3–5 天） | 跨域兜底（tabCapture）、错误提示、运行指示与停止、成本提示 | 跨域站点给出明确提示；tabCapture 路径下用户仍能听到原声 |
| **P3**（可选） | 译文语音（配音）、原声压低/混音、按句对齐 | — |

---

## 九、还需要人工确认的两件事

1. **DRM 站点**：拿 Netflix / Spotify 网页版点一次 `video.captureStream()`，确认是抛错还是静音。
2. **`gpt-realtime-translate` 的计费与配额**：按官网定价页确认每分钟成本，再决定默认开关策略。

---

## 附：复现本文实测

```bash
cd tools/capture
node scripts/probe-video-audio.mjs    # 实验 1：同源视频取音频
node scripts/probe-crossorigin.mjs    # 实验 2：跨域视频（预期抛错）
node scripts/probe-youtube.mjs        # 实验 3：真实站点
```

测试片源与页面：`pages/tone.mp4`、`pages/video-test.html`、`pages/video-test-cross.html`。
这些脚本在 `tools/` 下，按约定不进 git。
