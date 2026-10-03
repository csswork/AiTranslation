# 视频语音实时翻译 · 可行性调研与实施方案

> 需求：在网页里**右键一个 `<video>` 元素**，实时取到这个视频的语音，翻译成字幕。
>
> 前后两轮实测，都在本机真实 Chrome 上跑：
>
> - **第一轮**：Chrome for Testing 150（无头），测 `video.captureStream()` 取音。脚本在 `tools/capture/scripts/`。
> - **第二轮（2026-10-03）**：Chrome 154.0.8037.95 正式版，测「tabCapture → offscreen → Chrome 设备端语音识别」整条链路。
>   脚本、探针扩展、用法和踩过的坑见 `tools/audio-feasibility/README.md`。
>
> 文中标注：**实测** = 本机跑出来的结果；**文档** = 官方文档写明；**推断** = 还没验证，列在第九节待确认。

---

## 一、结论

**可行。推荐路线：右键 video → `chrome.tabCapture` 取标签页音频 → offscreen 文档里用 Chrome 设备端语音识别
→ 识别出的文字交给现有 `src/lib/providers.js` 翻译 → 字幕浮层。**

这条路线的好处：

- **音频不出浏览器**：识别在本机完成，发出去的只有识别出的文字，而且只发往用户自己选的翻译平台，和现有隐私承诺一致。
- **识别免费**：不按音频时长计费；翻译只按文字计费，量很小。
- **复用现有翻译层**：平台切换、Key 管理、流式解析都不用动。
- **不新增权限警告**（实测，见第三节）：发布更新后扩展不会因新权限被停用。

**和上一版的区别**：上一版推荐「`captureStream()` + OpenAI `gpt-realtime-translate`」，当时没考虑 Chrome 设备端识别。
设备端识别的语言包按源隔离、安装需要用户手势，只有 tabCapture 路线能在扩展自己的源里用上它（第四节）。
OpenAI 实时翻译改为备选（第五节）；如果走那条路，上一版「主用 captureStream、跨域降级 tabCapture」的思路仍然成立。

关键结论一览：

| 问题 | 结论 | 来源 |
| --- | --- | --- |
| tabCapture → offscreen → `getUserMedia(tab)` | ✅ 通，0.6–0.9 秒建立，原始轨 48kHz 双声道 | 实测 |
| offscreen 里做语音识别 | ✅ `SpeechRecognition.start(track)` 可以直接喂 tab 原始轨，云端、设备端都行 | 实测 |
| 设备端识别 · 英文 | ✅ 首字约 0.76 秒，准确率高，不联网 | 实测 |
| 设备端识别 · 日语 | ⚠️ 语言包装好、状态 available，但**零结果**（同一段音频云端正常），要用真实日语视频复测 | 实测 |
| 云端识别 · 英 / 日 | ✅ 都通，首字约 0.9 秒；但**音频发往 Google** | 实测 |
| 截取后用户还听得到吗 | ✅ 在 offscreen 里把流接回 `AudioContext.destination` 即可；不接则标签页静音 | 实测 / 文档 |
| 加 `tabCapture` / `offscreen` 会不会多出安装警告 | ✅ 不会，现有警告已经覆盖 | 实测 |
| 右键菜单点击能否满足 tabCapture 的「用户调用」 | ❓ 大概率能，要手动验证 | 推断 |
| 主流站点右键能不能点到 video 菜单项 | ❓ 自定义播放器可能拦截右键，要验证；有兜底入口 | 推断 |
| `captureStream()` 单独取 video 的音频 | 同源 / 带 CORS / MSE（YouTube）可以；跨域无 CORS 抛 `SecurityError` | 实测 |
| DRM 视频 | ❓ 未测 | — |
| 翻译环节延迟 | ❓ 未测（需要 API Key） | — |

---

## 二、推荐架构

```
网页：用户右键 <video>
  │ 1. 右键菜单「实时翻译这个视频」（contextMenus，contexts: ['video']）
  ▼
后台 Service Worker
  │ 2. chrome.tabCapture.getMediaStreamId({ targetTabId })   ← 必须发生在用户调用之后
  │ 3. 创建 / 复用 offscreen 文档（reasons: ['USER_MEDIA']），把 streamId 发过去
  ▼
offscreen 文档（扩展自己的源）
  │ 4. getUserMedia({ audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId } } })
  │ 5. AudioContext 把流接回 destination（否则标签页静音）
  │ 6. SpeechRecognition：processLocally = true、continuous、interimResults → rec.start(track)
  │ 7. 按中间结果自行断句，每句发回后台
  ▼
后台 Service Worker
  │ 8. 读设置 → AITrProviders.translate()（现有，流式）
  │ 9. 原文 + 译文转发给发起翻译的标签页
  ▼
网页：字幕浮层（Shadow DOM，挂在 video 的容器上，跟随尺寸与全屏）

设置页：「安装语音识别语言包」按钮（用户手势 → SpeechRecognition.install），装一次全扩展共享
```

几处分工的原因：

- **翻译要回到后台做**：offscreen 文档里能用的扩展 API 只有 `chrome.runtime`（实测：即使声明了 `storage` 权限也一样），读不到 `chrome.storage` 里的设置和 Key。
  放在后台正好沿用现有流程，所有发往翻译平台的请求仍然集中在 `providers.js`。
- **一个扩展同时只能有一个 offscreen 文档**（文档）：多个标签页同时翻译时，要在同一个 offscreen 里按 tabId 分路管理。
- **断句要自己做**：设备端识别在连续模式下基本不发 `isFinal` 结果（实测），不能等「最终句」再翻译。
  可行做法：中间结果一段时间不再变化、或累计长度超过阈值时，把已稳定的部分切成一句提交，记下已提交的前缀，避免重复翻译。具体参数在原型里调。
- **识别要指定源语言**：`SpeechRecognition` 按 `lang` 识别，不会自己判断语种（文档）。界面上要让用户选视频的语言，可以拿页面的 `lang` 做默认值。
- **语言包在设置页装**：`install()` 在状态为 downloadable 时必须有用户手势（实测），offscreen 文档没有用户手势，所以放在设置页装。
  支持哪些语言要用 `SpeechRecognition.available()` 探测，不同语言状态可能不同。

---

## 三、实测记录

### 第二轮：tabCapture + 设备端识别（2026-10-03，Chrome 154.0.8037.95）

环境：独立临时 profile 的无头 Chrome；一次性探针扩展（`tabCapture` + `offscreen`），
通过 CDP `Extensions.loadUnpacked` 加载、`Extensions.triggerAction` 模拟点击图标；
语音样本由 macOS `say` 生成（英文、日语各一段，原文见 `tools/audio-feasibility/*.txt`）。

| 项 | 结果 |
| --- | --- |
| tabCapture → offscreen → `getUserMedia(tab)` | 通，0.6–0.9s 建立，原始轨 48kHz 双声道 |
| offscreen 里 `SpeechRecognition.start(track)` | 通（云端、设备端都行）；tab 原始轨可以直接喂，不必先转单声道 |
| 设备端 · 英文 | 首字约 0.76s，准确率高，识别不联网 |
| 设备端 · 日语 | 失败：install 成功、状态 available，但零结果、无报错（同一段音频云端正常） |
| 云端 · 英 / 日 | 都通，首字约 0.9s；音频发往 Google |
| 语言包 | 按源隔离：扩展页里装的，offscreen（同为扩展源）能直接用；普通网页要按网页的源另装 |
| `install()` | 状态为 downloadable 时必须有用户手势 |
| 设备端连续模式 | 基本不发 isFinal 结果 |
| `captureStream()` | 同源、跨域带 CORS、MSE 都可以；跨域无 CORS 抛 `SecurityError` |
| offscreen 文档里的扩展 API | 只有 `chrome.runtime`；声明了 `storage` 权限，`chrome.storage` 仍是 undefined |
| 扩展未被调用就 `getMediaStreamId` | 报错：`Extension has not been invoked for the current page (see activeTab permission). Chrome pages cannot be captured.` |
| 权限警告（`chrome.management.getPermissionWarningsByManifest`） | 现有 manifest 加上 `tabCapture`、`offscreen` 后，警告仍只有「读取和更改您在所有网站上的所有数据」，没有新增 |

关于权限警告：`tabCapture` 单独出现时带的就是「读取和更改您在所有网站上的所有数据」这一条，
现有 manifest 因为 `<all_urls>` 内容脚本本来就有这条警告；`offscreen` 没有警告。所以加上这两个权限后，已安装的用户升级不会被停用。

这一轮踩过的坑（详见 `tools/audio-feasibility/README.md`）：

- **puppeteer 默认参数会让设备端识别静默失效**：`--disable-background-networking` 一类参数会导致 `install()` 返回 true、状态 available，
  但零结果、不报错。必须 `ignoreDefaultArgs: true` 自己给参数。日语那次失败的测试脚本是直接启动 Chrome 的，不受这个坑影响。
- puppeteer 无头模式默认带 `--mute-audio`，tabCapture 截到的是静音（RMS 0）。

### 第一轮：`video.captureStream()`（Chrome for Testing 150，无头）

测试片源为 ffmpeg 生成的 24 秒 440 Hz 正弦音视频（`tools/capture/pages/tone.mp4`），本地静态服务。

**实验 1：同源视频**（`http://localhost:8796/tone.mp4`）

```
captureStream：ok
音轨：{"audio":1,"video":1,"audioEnabled":true}
chunk 节奏：[315ms/1146B, 605ms/1245B, 903ms/1246B, 1202ms/1246B, 1500ms/1246B, 1803ms/1246B]
解码结果：{seconds:3.18, sampleRate:48000, channels:1, rms:0.0883, peak:0.149, peakFreq:440}
元素状态：{muted:false, volume:1, paused:false, currentTime:3.19}   ← 用户照常听
```

取到的是真声音（主频正好 440 Hz），不影响用户继续听；MediaRecorder 每 250ms 稳定产出约 1.25 KB（opus 32 kbps）。

**实验 2：跨域视频**（页面在 :8796，视频在 :8797，服务端不发 CORS 头）

```
captureStream: throw
error: "Failed to execute 'captureStream' on 'HTMLMediaElement':
        Cannot capture from element with cross-origin data"
```

是抛错而不是静音，所以能捕获到、可以走降级。

**实验 3：真实站点 YouTube**

```
video: true
srcKind: blob(MSE)      ← MSE 用 blob: URL，属于同源
captureStream: ok
音轨：1 条
```

主流视频站走 MSE，媒体数据是 `blob:` 同源 URL，不受跨域限制；CDN 直链站则会撞上实验 2 的错误。

---

## 四、为什么取音用 tabCapture，而不是 captureStream

|  | `chrome.tabCapture` | `video.captureStream()` |
| --- | --- | --- |
| 取到什么 | 整个标签页的声音（含广告、页面里其他视频） | 只有这个 video |
| 用户听感 | 截取后标签页静音，要自己接回 destination | 不受影响 |
| 跨域视频 | 不受影响 | 无 CORS 时抛错 |
| 音轨在哪 | offscreen 文档（扩展的源） | 内容脚本（网页的源） |
| 设备端识别 | 设置页装一次语言包，全扩展共享 | 见下 |
| 权限 | `tabCapture`（不新增警告），必须先有用户调用 | 无 |

起决定作用的是最后三行。设备端语言包按源隔离（实测），`install()` 又要用户手势：

- tabCapture 的音轨在 offscreen 里，和设置页同为扩展的源，设置页装一次就全扩展共享。
- captureStream 的音轨在内容脚本里，按网页的源算。在网页里直接识别，就得每个站点各装一次语言包、各要一次用户手势；
  `MediaStreamTrack` 也没法通过 `chrome.runtime` 消息传给 offscreen。
  理论上可以把 PCM 经消息转给 offscreen，在那里重新合成一条音轨再识别（未测），但链路更长，要处理分片和时钟，跨域视频照样取不到。

tabCapture 的两个代价（收整页声音、必须接回播放）都能处理，所以主路径选它。

---

## 五、识别与翻译：三条路线

| 路线 | 链路 | 音频去向 | 计费 | 现状 |
| --- | --- | --- | --- | --- |
| **A. 设备端识别 + 现有文本翻译**（推荐） | tabCapture → 设备端识别 → `providers.js` | 不出浏览器，只有文字发往所选平台 | 只按文字 | 英文实测可用；日语待复测；翻译延迟未测 |
| B. OpenAI 实时语音翻译 | 音频 → `gpt-realtime-translate` | 发往 OpenAI | 按音频时长 | 未测 |
| C. 云端识别 + 现有文本翻译 | tabCapture → 云端 Web Speech → `providers.js` | 发往 Google | 识别免费 | 英 / 日实测可用 |

### 路线 A（推荐）

见第二节。主要风险是语言覆盖：日语是中文用户看番剧的高频场景，如果设备端日语复测仍不可用，日语要靠 B 或 C 兜底。

### 路线 B：OpenAI 实时语音翻译

OpenAI 有专用的连续语音翻译会话（[Realtime translation](https://developers.openai.com/api/docs/guides/realtime-translation)）：

- 模型 `gpt-realtime-translate`，端点 `/v1/realtime/translations`（和语音助手的 `/v1/realtime` 不同）
- 传输：浏览器侧推荐 WebRTC；服务端侧用 WebSocket（base64 PCM16 24kHz）
- 说话人还在说，译文文本和译文音频就在往外流；不需要 `response.create`，持续灌音频即可
- 临时密钥：`POST /v1/realtime/translations/client_secrets`（用用户自己的 Key，在扩展页里发，不暴露给网页）

优点：链路最短，一个接口同时给出译文文本（字幕）和译文语音（配音）。
缺点：只有 OpenAI 一家（DeepSeek 没有音频接口，DeepL 只做文本），按音频时长计费，看一部电影的成本可观。

**走这条路时取音方式要反过来**：音频本来就要外发，设备端语言包的限制不存在了，
主用 `captureStream()`（只取这个 video、不影响用户听、不用新权限），跨域抛错时再降级到 tabCapture。
数据量：PCM16 24kHz 单声道 48 KB/s，base64 后 64 KB/s，按 100ms 分片每片 6.4 KB，`chrome.runtime` 消息完全扛得住。

同类的还有「第三方流式 STT（Deepgram / AssemblyAI / Azure Speech）+ 现有文本翻译」，音频同样外发，比 B 多一跳。

### 路线 C：云端识别

识别本身免费、英日都通，但音频会发给 Google，违背「内容只发往你选的那家平台」的现有承诺。
最多只能作为用户主动打开的选项，并在隐私政策里写明，默认不启用。

### 呈现形态

| 形态 | 价值 | 复杂度 | 建议 |
| --- | --- | --- | --- |
| **双语字幕浮层** | 最高频、最不打扰，和现有「弹窗显示译文」的产品调性一致 | 低 | **先做** |
| 译文语音（配音） | 看剧场景加分 | 高：要压原声、混音、处理打断；路线 A 还需要额外的 TTS | 以后 |

---

## 六、需要动的地方（路线 A，对照现有代码）

| 位置 | 改动 |
| --- | --- |
| `manifest.json` | `permissions` 加 `tabCapture`、`offscreen`（实测不新增安装警告） |
| `src/background.js` · 右键菜单 | 新增 `contexts: ['video']` 菜单项。现有「为这个区域添加翻译按钮」用的是 `'page'`，而 `'page'` 本来就不含视频，所以仍然保持「任何时刻只出现一项」 |
| `src/background.js` · 流程 | 菜单点击 → `getMediaStreamId` → 创建 / 复用 offscreen；收 offscreen 送来的句子 → `AITrProviders.translate()` → 转发给标签页；标签页关闭或用户停止时收尾 |
| `src/offscreen/`（新） | `getUserMedia(tab)`、接回播放、`SpeechRecognition`、断句、按 tabId 分路 |
| `src/content/video.js`（新） | 字幕浮层：复用 `content.js` 里 Shadow DOM + `all: initial` 的写法，挂在 video 容器上，处理全屏 |
| `src/options/` | 「视频实时翻译」开关、视频语言选择、语言包状态与安装按钮（`available()` / `install()`） |
| `src/lib/providers.js` | 不用改 |
| `docs/privacy.html` | 上线时补一行：视频语音在本机识别，只把识别出的文字发往你选的平台 |

---

## 七、已知的坑与风险

1. **全屏时字幕不可见**（必须提前设计）
   现有弹窗挂在 `document.body` 上，而全屏只渲染全屏元素的子树。
   字幕浮层必须挂到视频自己的容器里，或者监听 `fullscreenchange` 把浮层搬过去。

2. **主流站点右键不一定能点到 video 菜单项**（推断）
   YouTube、B 站等播放器会拦截右键、弹出自己的菜单，或者在 video 上盖一层透明元素，这时 Chrome 菜单的上下文是 page 而不是 video。
   兜底入口：popup 里放「翻译本页视频」按钮，或者加一个快捷键。点图标、快捷键都会授予 activeTab，满足 tabCapture 的前提（文档）。
   tabCapture 取的是整个标签页的声音，入口本来就不需要精确指向某个 video；video 元素只用来定位字幕，没有指向时取页面里正在播放的、最大的那个即可。
   注意现有 manifest 配了 `default_popup`，点图标不会触发 `action.onClicked`，要从 popup 里发起。

3. **右键菜单能否满足 tabCapture 的「用户调用」**（推断，大概率能）
   官方文档只举了点击图标的例子。实测：扩展未被调用就 `getMediaStreamId` 会报错，报错文案明确指向 activeTab；
   而右键菜单点击会授予 activeTab（文档）。自动化里模拟不了右键菜单，需要手动验证。

4. **设备端日语零结果**（实测，原因未明）
   语言包装好、状态 available，同一段音频云端能识别。可能的原因：样本是 `say` 合成音、语言标签写法、设备端日语模型本身的问题。
   要用真实日语视频复测，必要时换 `ja` / `ja-JP` 等写法对照。

5. **设备端连续模式基本不发 isFinal**（实测）
   断句要自己做，见第二节。断句太早会把半句话送去翻译，太晚则字幕延迟高，需要在原型里调。

6. **tabCapture 收的是整个标签页的声音**
   广告、页面里其他视频的声音也会进识别。截取后标签页默认静音，必须立刻接回 `AudioContext.destination`，否则用户会以为扩展把声音弄没了。

7. **隐私**
   只有路线 A 符合「内容只发往你选的那家平台」。路线 B / C 的音频都会外发，上线前必须改隐私政策，并在界面上让用户明确知情。

8. **DRM 内容**（未测）
   Netflix / Disney+ 等走 Widevine，captureStream 和 tabCapture 能否拿到解密后的音频都没测过。要在产品文案里写清楚，避免用户以为是 bug。

9. **MV3 生命周期**
   Service Worker 会休眠，音频与识别必须放在 offscreen 文档里；标签页关闭、导航或用户停止时由后台通知 offscreen 收尾。

10. **延迟预期要对**
    字幕延迟 = 识别首字（实测约 0.76s）+ 断句等待 + 翻译首字（未测）。产品上不要承诺「同传级零延迟」。

---

## 八、分阶段计划（路线 A）

| 阶段 | 内容 | 验收标准 |
| --- | --- | --- |
| **P0** | 右键 video → tabCapture → offscreen 设备端识别 → 字幕浮层显示**原文**（暂不翻译）；设置页装语言包 | 手动右键能拿到 streamId（或确定兜底入口）；英文视频原文字幕持续输出、标签页声音正常；拿真实日语视频确认设备端日语是否可用 |
| **P1** | 断句 + 接现有翻译，双语字幕 | 英文视频双语字幕稳定；量出翻译环节延迟 |
| **P2** | 全屏、切换视频、多标签、运行指示与一键停止、错误提示（不支持的语言、语言包未装、chrome:// 页面） | 主流站点（YouTube、B 站）全流程可用 |
| **P3**（可选） | 路线 B 或 C 作为可选识别来源（如日语兜底）、配音 | — |

---

## 九、还需要人工确认

1. **右键菜单 → tabCapture**：在真实浏览器里手动右键 video，确认 `getMediaStreamId` 成功。
2. **主流站点的右键入口**：YouTube、B 站上能否点到 video 菜单项；不能就以 popup 按钮或快捷键为主入口。
3. **设备端日语**：用真实日语视频复测。
4. **翻译延迟**：用用户自己的 API Key 量从句子提交到译文首字的时间。
5. **DRM 站点**：Netflix 等站点上 captureStream / tabCapture 是抛错、静音还是能用。
6. 如果走路线 B：按官网定价页确认 `gpt-realtime-translate` 每分钟成本，再定默认开关策略。

---

## 附：复现

**第一轮**（captureStream）：

```bash
cd tools/capture
node scripts/probe-video-audio.mjs    # 实验 1：同源视频取音频
node scripts/probe-crossorigin.mjs    # 实验 2：跨域视频（预期抛错）
node scripts/probe-youtube.mjs        # 实验 3：真实站点
```

测试片源与页面：`pages/tone.mp4`、`pages/video-test.html`、`pages/video-test-cross.html`。

**第二轮**（tabCapture + 设备端识别）：用法和环境变量见 `tools/audio-feasibility/README.md`，主脚本是 `e2e.mjs`（完整链路）、
`asr-test.mjs`（单独测识别）、`ctx-test.mjs`（语言包按源隔离）、`cors-test.mjs`（captureStream 各场景）。
其中 e2e / ctx-test 会从扬声器放出测试语音。

有两项没有单独留脚本，用探针扩展手动查即可：

- 权限警告：在扩展的 Service Worker 里，对 manifest 字符串调用 `chrome.management.getPermissionWarningsByManifest()`（不需要 `management` 权限）。
- offscreen 里的 API：创建 offscreen 文档后，在它的上下文里看 `Object.keys(chrome)`。

`tools/` 整体不进 git。
