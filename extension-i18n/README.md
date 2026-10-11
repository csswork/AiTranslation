# 扩展界面语言

`locales.json` 是 24 种语言的唯一注册表，包含目标语言描述、文字方向和 Chrome 语言代码。`en.json` 是英文基准，键为界面源文；其他语言各有一份完整目录。简体中文直接使用源文。

“跟随 Chrome”按 Chrome 首选语言列表选择首个支持的语言；取不到时依次使用 `navigator.languages`、`navigator.language` 和浏览器 UI locale，最后回退英文。显式选择的界面语言优先，已有翻译目标不随检测结果覆盖。

## 本地更新

```sh
node scripts/sync-extension-i18n.mjs          # 提取新增文案、补齐译文、生成运行文件
node scripts/sync-extension-i18n.mjs --watch  # 修改 src/ 文案或英文基准后自动刷新
bash package.sh                             # 先刷新并验证，再打包到 dist/
```

在本机 `.env.local` 设置 `DEEPSEEK_API_KEY`。生成器默认使用 DeepSeek V4.1 Flash 的模型 ID `deepseek-flash`；可通过 `DEEPSEEK_MODEL` 覆盖。不执行 env 文件中的代码，不输出 Key。

- 只发送公开的界面文案。扩展使用过程中不调用此生成器。
- `source-snapshot.json` 记录各语言对应的英文版本。新增源文或改动英文会触发增量翻译；未变化的内容直接复用，不请求 API。
- 新增界面文案用 `AITrI18n.t('中文源文', [参数])`，或放入扩展自有 HTML 模板。新增的源文先生成英文基准，再生成其他语言。动态业务内容不进入界面词条。
- 修改中文源文会产生新键；修改英文基准会使对应的旧译文过期。
- API 不可用时，已有完整目录仍可离线打包；有缺失或过期译文时构建失败，避免发布混合或缺失文案。
- 译文是 DeepSeek 生成并经过结构、变量和关键交互检查的，发布前可继续做母语润色。语言覆盖不代表每个平台、模型或语音识别引擎都支持相同语言。

## 安装包边界

安装包白名单为 `manifest.json`、`LICENSE`、`icons/`、`src/` 和 `_locales/`。

`extension-i18n/`、`scripts/`、`.env*`、测试、网站、开发工具、依赖、模型和缓存不进入安装包。

构建产物：

- `src/lib/languages.js`：统一语言表。
- `src/lib/messages.js`：词条索引与英文回退。
- `_locales/*/messages.json`：Chrome 支持的本地化语言。
- `src/locales/ur/messages.json`：乌尔都语界面目录。Chrome 原生 locale 列表不包含 `ur`，由扩展的本地加载器处理；浏览器自身显示的扩展名称按 Chrome 原生回退规则处理。

这些文件都必须随扩展打包，运行时只从安装包读取。所有 `$1` 等变量在构建时转换为 Chrome 的命名占位符。

验证：

```sh
node scripts/build-extension-i18n.mjs --check
bash test/run.sh
```
