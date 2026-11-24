# 翻译质量评测

改翻译提示词、模型或参数之前和之后，用同一批样本对比译文，避免凭感觉判断。只在开发时运行，不进扩展安装包，也不在 `npm test` 里跑（要调用真实接口）。

## 组成

| 文件 | 作用 |
| --- | --- |
| `apps/extension/eval/samples.json` | 样本：日文、英文原文各 30 条，中文原文 20 条，覆盖新闻、论坛口语、技术文档、随笔、电商和界面短句；原文与目标是同一种语言的样本自动跳过 |
| `apps/extension/eval/variants.mjs` | 待对比的方案，每个方案只描述在线上请求体基础上改什么 |
| `apps/extension/eval/run.mjs` | 翻译、盲评、生成报告 |

脚本加载扩展自己的 `src/lib/providers.js`，照常调用 `translate`（整段）和 `translateBatch`（网页片段），发出请求前把请求体交给方案的 `patch`。因此 `baseline` 始终是当前代码的真实行为，改了提示词不需要同步评测代码。

## 运行

需要 `DEEPSEEK_API_KEY`，查找顺序与界面译文生成器相同（`apps/extension/.env.local`、根目录 `.env.local`、进程环境）。

```sh
npm run eval:translation -- --list
npm run eval:translation -- --variants baseline,temp-0.7
npm run eval:translation -- --variants baseline,temp-0.7 --from ja --genre forum,essay
npm run eval:translation -- --variants baseline --no-judge
npm run eval:translation -- --variants no-style,baseline --target en
```

`--variants` 的第一个是对照组，其余每个都和它两两比较。其他选项见 `--help`。

报告写到 `dist/eval/<时间>-<方案>/report.md`（另有 `results.json`）：先是各方案实际发出的参数，然后是按源语言、体裁、整段或片段分组的胜 / 平 / 负与两项平均分，最后是逐条译文和评审理由。

相同的请求会复用 `dist/eval/cache.json` 里的结果，重跑不花钱，对照组的译文也保持不变；要重新请求加 `--fresh`（只是不读缓存，新结果照常写回）。DeepSeek 默认温度 1.3，同一请求每次结果不同，比较两个方案时不要中途清缓存。

## 评审方式

评审模型拿到原文和两份译文（A、B 顺序按样本固定打乱，不知道哪份来自哪个方案），分别给「忠实」和「地道」打 1–5 分，再判断整体哪份更好；意思有明显错误的一份不能赢，差不多就判平。两份译文完全相同时不调用评审，直接记平。

默认评审模型是 `deepseek-flash`（开启思考）。不使用 `deepseek-v4-pro`，无论是做翻译方案还是做评审。可用 `JUDGE_MODEL`、`JUDGE_BASE_URL`、`JUDGE_API_KEY` 换成任何 OpenAI 兼容接口。

## 读结果时要注意

- 评审与被评的模型同属 DeepSeek，可能偏好自己习惯的说法，打分也偏宽松。条件允许时换一家的模型做评审。
- 60 条样本下，胜负差几条属于噪声。看胜负是否明显偏向一边、各分组方向是否一致，再读逐条译文确认。
- 「忠实度下降的样本」要人工复核：更顺口但意思走样的译文不算改进。
- 样本的 `watch` 字段是写给人看的提示（这条容易在哪里生硬），不会发给评审。

## 现有方案

| 方案 | 用途 |
| --- | --- |
| `baseline` | 当前代码（自带 Key 的提示词） |
| `no-style` | 去掉中文风格指南，回看它带来的差别 |
| `no-sense`、`hosted-no-sense` | 去掉已落地的义项提示（撥水、来年度），分别在自带 Key 与托管提示词上回看 |
| `hosted`、`hosted-no-style` | 换成后台 `hosted.js` 的提示词（托管翻译的基础提示词与扩展不同），带与不带风格指南 |
| `temp-0.7`、`temp-1.0`、`thinking` | 只改请求参数 |
| `baseline-resample` | 与 `baseline` 同义、只是不命中缓存，量同一方案重新采样的波动 |
| `refine` | 初译后再让同一模型对照原文审校改写一遍（只作用于整段），用来示范 `after` |

风格指南落地时的结果（带指南 对 不带指南，胜 / 平 / 负，评审 `deepseek-flash`）：

| 目标语言 | 指南 | 自带 Key 的提示词 | 托管提示词 | 地道分 |
| --- | --- | --- | --- | --- |
| 简体中文 | 中文专门版 | 40 / 7 / 13 | 36 / 12 / 12 | 约 3.8 → 4.5 |
| 英语 | 通用版 + 英语一条 | 39 / 3 / 8 | 33 / 6 / 11 | 3.56 → 4.74 |
| 日语 | 通用版 + 日语一条 | 34 / 5 / 11 | 34 / 4 / 12 | 3.53 → 4.39 |
| 韩语 | 通用版 | 48 / 12 / 19 | 未跑 | 3.64 → 4.45 |
| 西班牙语 | 通用版 | 46 / 12 / 22 | 未跑 | 3.87 → 4.52 |
| 法语 | 通用版 | 48 / 16 / 16 | 未跑 | 3.76 → 4.31 |

忠实分各语言持平或略降（不超过约 0.15）。其余目标语言没有评测；`deepseek-flash` 对小语种地道程度的判断也不可靠，结论只能当参考。

2026-11 第二轮（目标简体中文，每方案 60 条）：宽泛重写的指南、加整段示例、温度 1.0、开启思考、`refine` 对 `baseline` 都在 `baseline-resample` 的波动范围内，没有一项能算整体改进。`thinking` 忠实分略升（4.75 → 4.84），但输出 token 约是不开的 4.7 倍，流式首字更晚；`refine` 忠实分下降（4.79 → 4.57）。落地的只有逐条对比里方向明确的三处：「微妙」示例改成「一般、说不上好」，范围号「〜」写成「～」或「到」，网页片段补「链接项保留自己的意思」与两组切分示例。

改指南时：

- 中文专门版（`styleGuide`）：重跑 `--variants no-style,baseline`、`--variants hosted-no-style,hosted`，并用 `--target zh-Hant --no-judge` 看一遍繁体输出。繁体目标用繁体写的指南；用简体写时模型会跟着输出简体译文。
- 通用版（`generalStyleGuide`）：加 `--target en`、`--target ja` 等重跑同样的对比。第一版没有写「不许漏译」「片段不许返回空项」时，出现过丢掉结尾客套话、把只有句号的片段译成空字符串的情况，改动时留意这两点。

## 2026-11-24 简中候选：给易误译的表达补充上下文提示

此轮只改评测请求。模型为 `deepseek-flash`，翻译温度 1.3、关闭思考，同模型开启思考做 A/B 盲评。每个样本都有现版对照。

- 改三条通用行文建议（`zh-focus`），在固定 60 条上为 20 胜 / 16 平 / 24 负。现版重新采样为 22 / 17 / 21，没有观察到通用改写的优势。
- 另一种做法是在原文出现特定表达时，给模型一句词义提示，由上下文决定最终译法。五条提示的试验（`zh-sense`）中，客套语仍容易翻得生硬，例如「恕我们擅自安排」。缩小后的 `zh-precision` 保留三个可核对的区别：需求水平与增长趋势（high demand）、防泼水与防水（撥水）、年度与自然年（来年度）。
- 固定 60 条只有 3 条触发这三条提示。另写的 `sense-samples.json` 有 12 条定向样本，7 条触发。新增样本用来检查具体错误和反例，不能用来估计实际网页的命中率。自带 Key 路径合计 72 条中，其余 62 条请求与现版相同，复用同一译文。

下表只统计触发提示的 10 条，按候选胜 / 平 / 负计。托管列用评测器复现后台提示词，模型与自带 Key 列相同。

| 方向 | 自带 Key | 托管提示词 |
| --- | --- | --- |
| 英译简中（4 条） | 2 / 1 / 1 | 0 / 1 / 3 |
| 日译简中（6 条） | 5 / 0 / 1 | 4 / 1 / 1 |

「撥水」在两个单段样本、两条路径上都从“防水”纠正为“防泼水”。自带 Key 的批量样本 `ja-sense-02` 却把“连同袋子一起浸入水中”改成只说袋子。英语 `en-shop-04` 的自带 Key 现版把 high demand 译成“订单量激增”，候选为“需求量大”，评审更喜欢现版的整体措辞。这两例需要逐句核对词义与整句质量。建议优先扩大日译中商品说明整段的复测，英译中与批量片段继续保留对照。

分别用默认样本和专项样本复现自带 Key 的对比：

```sh
npm run eval:translation -- --variants baseline,zh-precision
npm run eval:translation -- --variants baseline,zh-precision --samples apps/extension/eval/sense-samples.json
```

托管对照将两个方案名换为 `hosted,hosted-zh-precision`。固定样本命中 `ja-news-01,ja-shop-02,en-shop-04`，专项样本命中 `en-sense-03,en-sense-04,en-sense-05,ja-sense-01,ja-sense-02,ja-sense-05,ja-sense-06`，可传给 `--ids` 单独复测。

### 落地：只保留撥水与来年度两条

逐条看译文，high demand 一条现版本来就译对，提示只换了措辞，不落地。撥水与来年度现版会稳定译错：撥水译成“防水”“拨水”“疏水”，来年度译成“明年”或照搬“明年度”。为此在 `sense-samples.json` 补了 6 条日译中样本（`ja-sense-07` 到 `ja-sense-12`，含规格表片段和财年、学年语境）。

两条提示写进扩展 `providers.js` 与后台 `hosted.js` 的 `senseHints`（`test/style-guide.mjs` 对照两边），放在风格指南之前，只在目标为简体中文、待译原文命中时出现；没命中时提示词与原来完全相同。批量翻译按段挑提示，没命中的段落缓存键不变。繁体中文不加：台湾商品说明本来就常用「撥水」。

只统计命中提示的 12 条日译中样本（专项 10 条加固定样本 `ja-news-01`、`ja-shop-02`），提示对现版的胜 / 平 / 负：

| 路径 | 胜 / 平 / 负 | 忠实分 |
| --- | --- | --- |
| 自带 Key | 9 / 2 / 1 | 约 4.2 → 4.9 |
| 托管提示词 | 9 / 1 / 2 | 约 4.3 → 4.9 |

三场负的样本（`ja-sense-02`、`ja-sense-08`、`ja-news-01`）两版都译对了词义，差别只在措辞。落地后用下面的命令复现，请求与评测时逐字相同，全部命中缓存：

```sh
npm run eval:translation -- --variants no-sense,baseline --samples apps/extension/eval/sense-samples.json --ids ja-sense-01,ja-sense-02,ja-sense-05,ja-sense-06,ja-sense-07,ja-sense-08,ja-sense-09,ja-sense-10,ja-sense-11,ja-sense-12
npm run eval:translation -- --variants no-sense,baseline --ids ja-news-01,ja-shop-02
```

托管对照换成 `hosted-no-sense,hosted`。要加新的义项提示时沿用这个做法：先找现版反复译错的词，写正反样本，在 `variants.mjs` 里做成方案对比，确认后两边一起改，并给 `no-sense` 留出回看的路径。

### 未采用：七语预设术语库

另试过随扩展附带 64 个商品与云计算概念的七语术语表，由用户在设置里开启。整句盲评对现版没有明显提升（译入简中 50 条：15 / 24 / 11；云计算类 7 / 7 / 8；译入德语、西班牙语、阿拉伯语、繁体中文均为负多于胜）。现版没用首选译名的地方，多数是可接受甚至更常用的说法，如钢丝棉、自动扩缩容、金丝雀发布。按字面匹配还会误报（「高碳钢」被提示成 carbon steel），而且规格表单元格这类片段常常过不了语境检查。真正有收益的只有撥水一类的词义区分，所以改用上面的义项提示。

## 添加样本

样本都是为评测自行撰写的，不摘抄真实网页。遇到实际使用中翻得生硬的句子，改写后加进 `samples.json`：

```json
{ "id": "ja-forum-07", "from": "ja", "genre": "forum", "text": "…", "watch": "容易出问题的地方" }
{ "id": "en-batch-05", "from": "en", "genre": "ui", "mode": "batch", "texts": ["…", "…"], "watch": "…" }
```

`mode: "batch"` 模拟网页翻译：`texts` 是一个页面上相邻的文本片段，可以包含被行内标签切开的半句话。

## 添加方案

在 `variants.mjs` 里加一项。改参数直接返回新的请求体；改系统提示词用 `withSystem`，`ctx.mode` 区分整段与片段，`ctx.target` 是目标语言的英文名：

```js
'zh-style': {
  note: '加中文风格指南',
  patch: withSystem((prompt, ctx) => (ctx.target.includes('Chinese') ? `${prompt}\n…` : prompt)),
},
```

要在初译之后再做一步（如审校改写），给方案加 `after({ mode, sample, target, output, call })`，`call(body)` 用同一个带缓存的接口再发一次请求，返回值作为最终译文（报告的 `results.json` 里另存初译 `draft`）。

温度 1.3 下同一方案每次结果不同。判断差距是否超出波动，可以加一个只在提示词末尾多一个换行的「重新采样」方案（如 `baseline-resample`）一起跑：2026-11 的一轮里 `baseline-resample` 对 `baseline` 是 14 / 25 / 21，胜负差在这个范围内的候选不能算改进。

方案验证有效后，再把改动落到 `src/lib/providers.js` 和后台 `src/translation/hosted.js`（两边保持一致），然后删掉对应的方案。
