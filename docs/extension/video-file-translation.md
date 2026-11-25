# 整份视频翻译

右键网页里的视频，选「翻译这个视频」：扩展把整个视频文件取下来，识别出完整文稿，整篇一次翻译，带时间轴整套交给页面，按播放时间显示双语字幕。面向 9GAG 这类直链短视频；可行性与实测数据见 `video-audio-translation.md` 第十节和本机的 `tools/video-file-probe/`。

和「视频实时字幕（实验）」的区别：实时字幕截取标签页声音边播边识别、逐行翻译，碎片多、译文晚；整份翻译先拿到完整文稿再分句、整篇翻译，不依赖视频是否在播放、是否静音（9GAG 默认静音自动播放）。

## 入口与分流

视频只有一个右键菜单项「翻译这个视频」（`contexts: ['video']`，常驻；Firefox 没有 offscreen 文档，不建）。点击后在 `background.js` 的 `translateVideo` 分流：

1. 这个标签页正开着实时字幕：关掉（与原来「再点一次就关」一致）。
2. 视频地址是 http(s) 直链：整份翻译。
3. 地址是 `blob:` 等（YouTube、X 这类分段串流）：打开了实时字幕（实验）就改走实时字幕，否则浮层说明没法整份翻译。

菜单项各自的 `contexts` 两两不重叠，所以不另加第二个视频项（重叠会被 Chrome 折叠进子菜单，见 `test/menu.mjs`）。

## 流程

```
右键视频 → background.translateVideo → AITrVideoFile.open（lib/video-file.js）
  注入 content/video-file.js（字幕浮层），发 { video-file-open, jobId }
浮层 → 长连接 ai-video-file，带 jobId 认领（只认同一标签页、同一框架、未认领的任务）
service worker → offscreen（offscreen/file.js）：video-file-start { jobId, url, lang, mode }
  取文件（不带 Cookie 与 Referer，≤ 100 MB，第一块就按文件头确认是音视频）
  解码音轨 → 16 kHz 单声道（≤ 10 分钟）；整段静音就直接报没有声音
  mode 'local'：播进 MediaStreamDestination（不出声）→ 设备端识别，1 倍速跑完整段
  mode 'audio'：编成 WAV 交回
  进度、结果用 video-file-event 报回（每秒一次，顺带让 service worker 保持运行）
service worker：mode 'audio' 时 AITrProviders.transcribe（OpenAI whisper-1）
  → AITrProviders.translateTranscript → 带时间的字幕 → 浮层
浮层：按 video.currentTime 显示「译文大字 + 原文小字」；跟随视频位置、大小与全屏
```

## 浮层

- 处理中：视频下方显示进度（读取视频的百分比、本机识别的秒数进度条、翻译中）。
- 字幕准备好时：视频停着（9GAG 帖子页默认停着）或已播完就从头播放，正在播的不打断；提示「边播边显示，也可以点「全部字幕」直接看」。只在有人说话的时间段出字幕，第一句之前、两句之间画面上没有字幕，所以要有下面这条常驻的说明。
- 视频左上角常驻一条：「双语字幕 · 全部字幕 · ×」，视频停着时多一个「播放」。「全部字幕」打开整篇双语对照（时间、译文、原文），点一句就跳到那里播放，当前句高亮。× 关掉字幕并取消这一路。
- 没有可显示的字幕（没有声音、没识别到人声）：提示几秒后自动收起。

- 视频地址只用右键菜单给的 `info.srcUrl`。浮层只能凭 jobId 认领任务，不能提交网址；offscreen 只接受 service worker 的消息（`sender.tab` 为空）。不要改成让内容脚本传网址。
- 浮层断开（点关闭、刷新、跳走、视频被页面回收）就取消这一路，连同 offscreen 里的下载与识别。
- offscreen 读不到设置和界面语言，只报错误代码（`fetch-failed`、`too-large`、`too-long`、`not-media`、`no-audio`、`sr-unsupported`、`pack-*`、`sr-error`），文案由 `AITrVideoFile.offscreenError` 生成。
- 本页翻好的视频由浮层记在内存里（键含平台、目标语言、识别语言），再点同一个视频直接显示。

## 识别

| 翻译平台 | 识别 | 说明 |
| --- | --- | --- |
| ChatGPT（有 Key） | OpenAI `whisper-1`，`verbose_json`，词级 + 段级时间 | 自动判断语种，几秒出结果；发往用户填的 Base URL 的 `/audio/transcriptions`。结果按音频内容缓存在本机 |
| 其他（DeepSeek、DeepL、本机翻译、点数翻译） | 浏览器设备端识别 | 声音不出浏览器；要先在设置页下载「视频语言」的离线语言包；只能 1 倍速，等待时间 = 视频时长 |

- 设备端识别没有词级时间：每个词取它第一次出现在中间结果里的时刻，减 0.7 秒识别延迟（`AITrTranscript.timedTokens`）。时间按 `AudioContext.currentTime` 算：offscreen 里的音频上下文刚建好时可能还没跑起来，按墙上时间会整体偏晚约 3 秒（实测）。
- 2 倍速播放给识别器几乎认不出字（探针实测），不要为了省时间加速。
- Whisper 在纯音乐上会编句子：段落 `no_speech_prob > 0.6` 且 `avg_logprob < -1`、或 `compression_ratio > 2.4`、或 `avg_logprob < -1.5` 时整段丢掉（`AITrTranscript.fromWhisper`）。设备端识别在没人说话时基本零输出，不需要过滤。
- 识别语言沿用设置里的「视频语言」（`videoLang`，与实时字幕共用）；中日文等不加空格的语言按 `Intl.Segmenter` 分词。

## 翻译

`AITrProviders.translateTranscript`（计入功能统计的 `subtitle`）：

- **大模型（ChatGPT、DeepSeek）**：一次请求同时切句和翻译。用户消息是 `{ title, tokens: [[序号, 词, 秒], …] }`（秒数让模型看得出停顿），模型按序号范围返回 `{ cues: [{ from, to, text, tr }] }`，不抄原文，对齐不会错位（探针里让模型抄原文时 16 个视频错位 3 个）。每条最多约 12 个英文单词、宁短勿长。请求带 `response_format: json_object`，沿用各平台的翻译调参（DeepSeek 关思考：探针里开思考慢到 47 秒且质量差别不大），只把温度降到 0.7（`CUE_TEMPERATURE`）：用 DeepSeek 翻译的 1.3 时，同一段 127 个词切出 12 到 34 条，偶尔一条 29 个词；0.7 时稳定在 19 到 25 条。提示词末尾加风格指南与用词偏好。超过 600 个词的文稿在最长停顿处分段并行请求。回复不合格（越界、重叠、缺译文）时这一段退回下面的做法。结果缓存在本机（`llm-cues`）。
- **DeepL、本机翻译、点数翻译**：按停顿（0.9 秒）、句末标点和长度（12 个词 / 18 个不加空格语言的词）切句，再走 `translateBatch` 整批翻译（同一批里有前后文）。
- 每句显示到下一句开始或最后一个词后 0.8 秒，至少 1.2 秒，不越过下一句（`AITrTranscript.cueTimes`）。识别器在音频放完后才吐出的词，时间会落在片尾之后，这类句子挪回片尾前，否则播不到。

## 限制

- 只支持能整份下载的 http(s) 视频文件：≤ 100 MB、≤ 10 分钟、能解出音轨。分段串流（`blob:`）、HLS 播放列表、DRM 都不行。
- 取文件不带 Cookie：要登录才能看的视频取不到。不带 Referer：要求特定 Referer 的防盗链取不到。
- 设备端识别要选对语言；混着几种语言说的视频会认错（探针里英日混说的视频成了乱码）。
- 画面里烧录的字幕、梗图标题不翻（那是图片翻译的范围）。
- 第一版只在页面内存里记结果；设备端识别的结果没有存进本机缓存，换页后再翻要重新识别。

## 发布前

- 更新隐私说明（`PRIVACY.md` 与官网 `privacy.html`，中英文）：整份视频翻译时扩展会下载视频文件、在本机解码；翻译平台是 ChatGPT 时视频的声音发给 OpenAI 转写，其余平台声音不离开浏览器；识别出的文字按翻译模式发给翻译平台或我们的服务器。核对商店数据声明。
- `tabCapture` / `offscreen` 权限说明里补上整份翻译（offscreen 现在也用于解码与识别视频文件，不只是实时字幕）。
- 官网首页与更新日志的文案等扩展发布后再加。

## 验证

- 单元测试：`test/transcript.mjs`（词时间、切句、回复校验、Whisper 过滤、WAV、容器识别）、`test/video-file.mjs`（大模型 / DeepL 翻译、OpenAI 转写请求、错误文案）、`test/menu.mjs`（菜单项常驻与分流）。
- 真实 Chrome：`tools/video-file-probe/e2e-extension.mjs`（不进 git；`GAG=1` 时用 9GAG 帖子页的结构与真实 CDN 视频：链接包着视频、三个 `<source>`、视频停着，验证准备好后自动播放、常驻条、全部字幕与点句跳转。真实 9GAG 页面对自动化浏览器有 Cloudflare 人机验证，没法直接跑）用 CDP `Extensions.loadUnpacked` 加载扩展，页面与视频分属两个源、视频不带 CORS 头，调用与右键菜单相同的 `AITrVideoFile.open`，再用 CDP 穿透 closed shadow root 读出浮层文字、逐 0.25 秒核对字幕时间。CDP 点不到原生右键菜单，菜单本身由 `test/menu.mjs` 覆盖。
