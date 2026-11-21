# 本机译文缓存

用户自带 Key 的翻译（ChatGPT、DeepSeek 等 OpenAI 兼容平台与 DeepL）结果缓存在扩展自己的 IndexedDB 里，同样的请求再来时直接使用，不再花用户的用量和等待时间。实现在 `apps/extension/src/lib/cache.js`（`AITrCache`），接入点只有 `src/lib/providers.js`。

## 范围

| 走本机缓存 | 不走 |
| --- | --- |
| 大模型单段翻译（`translate`，流式与非流式共用） | 点数翻译（托管）：重复内容交给后台进程内缓存，照常扣点 |
| 大模型与 DeepL 的批量翻译（`translateBatch`） | 本机翻译：本来就免费、够快 |
| DeepL 单段翻译 | 视频字幕（逐行带前文，已暂停） |
| 大模型识图（`readImageText`，只限 `data:` 图片） | 账号、会话、点数、订阅、版本检查等接口：必须以服务端为准 |
| 点词换说法（`alternatives`） | 设置页「测试连接」 |

内容脚本不加载 `cache.js`：它们的请求都经 service worker 发出，在那里命中。service worker 和扩展页面（翻译面板、双语阅读、PDF、图片翻译、设置页）同属扩展来源，共用同一个库。

## 缓存键

查找材料是 `JSON.stringify([FORMAT, ...影响结果的因素, 原文])`，进库前变成 HMAC：

- 大模型：平台、接口地址、模型、**完整系统提示词**、用户消息。目标语言、源语言、风格指南和用词偏好都在提示词里，改了任何一项就不会命中旧译文，不需要按扩展版本作废。
- DeepL：平台、目标语言代码、源语言代码、原文。缓存的是**替换用词偏好之前**的译文，取回后再套用偏好，改偏好不用作废缓存。
- 识图：平台、接口地址、模型、提示词（区分 `text` / `regions` / `regions-sfx`）、图片内容的 SHA-256。`http(s)` 图片地址不缓存，地址背后的图可能会变。
- `FORMAT`：改了存值的形状或解析逻辑时加一。

## 批量：逐段与整批

- `reader`、`pdf`、`image` 发的每一项都是完整的一段：逐段命中，只把没命中的段落发出去，再按原顺序拼回。
- `page`（区域翻译）与 `site`（整站翻译）发的是文本节点，同一句话常被行内标签切成几段（`<p>Read the <a>docs</a> first.</p>`），片段的译法依赖整句（提示词要求把被切开的句子连起来分回各项）。内容脚本用 `src/lib/segments.js` 的 `AITrSegments.isWhole` 判断每个节点是否独立成段，随请求发 `whole`（与 `texts` 等长）：
  - 独立成段的节点（导航链接、按钮、标题、列表项、没有行内标记的段落）逐段命中，和双语阅读、PDF 用同一套键，跨页面、跨功能都能命中。
  - 片段从不单独缓存，总是和没命中的段落一起发出，句子的前后文不受影响。
  - 另外按整批缓存一次：同一区域再翻、同样的一批再来时整批命中，片段也不用再请求。
  - 没带 `whole` 或长度不对时全部按片段处理（只剩整批命中）。
- `isWhole`：从节点往上走过计算后 `display` 为 `inline` / `contents` 的元素，到最近的块级容器，容器的全部文字（压缩空白后）就是这个节点自己才算完整。flex / grid 子项的 `display` 会被算成 `block`，所以 flex 导航里的链接各算一段。拿不到计算样式时按标签名判断。拿不准就当片段。必须在译文写回之前判断：区域翻译在收集节点时一次判断完，整站翻译在取批次时判断。
- 整站翻译把同一批里相同的文字去重后发送；同样的文字只要有一处是片段，就整体按片段处理。页面内的去重仍由 `site.js` 的内存缓存负责。

## 先显示命中的段落

只在 service worker 里命中还不够快：一批里只要有一段没命中，整批就得等这次网络请求。所以区域翻译和整站翻译走两步（`src/lib/requests.js`）：

1. `AITrRequests.lookupBatch` 发 `cache-lookup`，service worker 用 `AITrProviders.lookupBatch` 只读缓存（先整批、再逐段，不发请求），命中的段落立刻写到页面上。点数翻译、本机翻译、关掉缓存或缺 API Key 时不发这一步。
2. `AITrRequests.translateBatch` 只把没命中的段落（片段总是在内）发 `translate-batch`，回来后按原顺序合并。这一步在 service worker 里照常查缓存、写缓存。

整站翻译每批都这样做；区域翻译先把所有批次查一遍、写上命中的，再逐批请求剩下的。查询失败一律当作没命中，走原来的请求。

## 什么时候不写入

- 被中断（`signal.aborted`）、出错、解析失败的结果。
- 流式没有以 `finish_reason: stop` 收尾的（断流、截断）；非流式 `finish_reason` 不是 `stop` 的。
- 批量里非空原文得到空译文的段落（整批模式下整批不存）。

## 重新翻译

`fresh: true` 时不查缓存，但用新结果覆盖：划词弹窗的「重新翻译」、图片的「重新识别」和「只重新翻译这一段」会带上它（经 `retranslate`、`read-image`、`translate-batch` 消息传到 service worker）。换平台、换目标语言本身就是不同的键，不需要 `fresh`。

## 存储与隐私

- 库名 `aitr-cache`：`entries`（`{ id, iv, data, used }`，按 `used` 建索引）与 `meta`（不可导出的 HMAC 密钥，`CryptoKey` 直接存进库里）。
- `id` 是 `HMAC(密钥, 'id' + 材料)`；值用 `HMAC(密钥, 'key' + 材料)` 作 AES-256-GCM 密钥加密。库里没有原文，没有原文也解不开译文。思路与后台 `apps/backend/src/translation/cache.js` 一致。
- 30 天没用到的条目删除；超过 30000 条时删掉最久没用的，一次删到九成。命中时最多一天更新一次 `used`。清理在每个上下文首次写入时以及之后每 10 分钟最多一次。
- 读写失败一律当作没命中，不影响翻译。
- 设置项 `settings.cache`（默认开）。关掉只是不再读写；设置页「清除缓存」删除全部条目。卸载扩展时浏览器一并删除。
- 隐私说明见根目录 `PRIVACY.md` 与官网 `privacy.html` 的「只保存在你本机的内容」。

## 测试

- `apps/extension/test/cache.mjs`：用内存存储（语义与 IndexedDB 存储一致）覆盖加密存取、淘汰、各平台接入、逐段与整批（含 `whole` 标记）、`fresh`、不写入的情况。
- `apps/extension/test/segments.mjs`：用最小的假 DOM 覆盖 `isWhole` 的各种结构（导航、被切开的句子、按钮、`br`、自定义元素、shadow root、flex 子项）。
- IndexedDB 存储层在 node 里跑不了；改动 `idbBackend` 后在浏览器里实测（跨实例共享密钥、读写、淘汰、清空）。
