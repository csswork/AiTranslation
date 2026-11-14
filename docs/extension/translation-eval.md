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
| `hosted`、`hosted-no-style` | 换成后台 `hosted.js` 的提示词（托管翻译的基础提示词与扩展不同），带与不带风格指南 |
| `temp-0.7`、`temp-1.0`、`thinking` | 只改请求参数 |

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

改指南时：

- 中文专门版（`styleGuide`）：重跑 `--variants no-style,baseline`、`--variants hosted-no-style,hosted`，并用 `--target zh-Hant --no-judge` 看一遍繁体输出。繁体目标用繁体写的指南；用简体写时模型会跟着输出简体译文。
- 通用版（`generalStyleGuide`）：加 `--target en`、`--target ja` 等重跑同样的对比。第一版没有写「不许漏译」「片段不许返回空项」时，出现过丢掉结尾客套话、把只有句号的片段译成空字符串的情况，改动时留意这两点。

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

方案验证有效后，再把改动落到 `src/lib/providers.js` 和后台 `src/translation/hosted.js`（两边保持一致），然后删掉对应的方案。
