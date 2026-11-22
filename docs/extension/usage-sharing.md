# 自愿分享功能使用记录

> 状态：已在 `main` 实现（2026-11-21），随下一个扩展版本发布；后端需部署迁移 `024_shared_feature_usage.sql`。尚未上架商店。

## 要解决什么

管理端的功能统计原本只能看到点数翻译：数据来自 `usage_events` 与 `usage_rejections`，服务端本来就要为计费记录这些请求。以下使用完全不经过后台：

- 自带 Key 的大模型（ChatGPT、DeepSeek）与 DeepL；
- 本机翻译（浏览器内置 `Translator`）；
- 上面两类里命中本机译文缓存的使用。

这项功能让用户**自己选择**把这部分使用情况以按天汇总的计数交给我们，默认关闭。

## 与上一版的区别

2026-11-19 的上一版（`630e9d5`，后由 `4b59977` 与迁移 `021` 撤掉）在托管请求里附带 `countFeatureUse` 标记，另加「授权技术支持查看」表。托管请求的功能统计用已有记录就能算，标记和授权都是多余的。这一版：

1. **只覆盖后台看不到的部分**：点数翻译不上报，仍按现有记录统计，不受开关影响。
2. **不随翻译请求附带**：独立接口，只发已结束的日子，统计不对应某次具体请求的时间。
3. **不做技术支持授权**：用户本人在用户中心查看与删除，运营只看汇总。

## 收集什么、不收集什么

每条记录是「浏览器本地日期 × 功能 × 平台」的计数，关联到扩展会话的账户（访客或正式账户）：

| 字段 | 取值 | 说明 |
| --- | --- | --- |
| `id` | UUID | 扩展为每个计数生成，服务端据此去重 |
| `day` | `YYYY-MM-DD` | 浏览器本地日期；只发已结束的日子，后台只收 35 天内、不晚于 UTC 今天 |
| `feature` | `selection` `panel` `page` `site` `image` `pdf` `reader` `subtitle` `alternatives` | 与托管统计同一套口径 |
| `provider` | `openai` `deepseek` `deepl` `local` | 点数翻译（`hosted`）不计 |
| `requests` | 1–10000 | 当天的调用次数（翻译、识图、换说法；含缓存命中、被取消的调用），超出按上限截断 |
| `failures` | 0–`requests` | 其中失败的次数，不细分原因；被取消不算失败 |

服务端另按现有口径记录扩展版本与浏览器、系统家族（`requestClient`）。

**不收集**：原文、译文、网址或域名、页面标题、语言（首版确认不加目标语言）、模型名、自定义接口地址、API Key 的任何部分、精确时间、无痕窗口里的使用。

## 扩展

- **设置**：`settings.shareUsage`，默认 `false`，存 `chrome.storage.local`，不经 Chrome 账号同步。设置页「帮助改进」卡片里的开关是唯一入口，不在安装页、欢迎页、弹窗或翻译过程中提示开启。卡片可展开「查看待发送的内容」，并链接到用户中心的「用量与点数」。
- **Firefox**：打开开关时在同一次点击里请求可选的 `technicalAndInteraction` 数据收集权限（打包器已声明为可选），未授予则保持关闭；撤销权限时清空队列，设置页随之把开关关掉。版本上报也依赖同一权限。
- **计数点**：`src/lib/providers.js` 导出的 `translate`、`translateBatch`、`lookupBatch`、`alternatives`、`readImageText`、`translateCaption` 包了一层计数（`tracker`）。`lookupBatch` 只在全部命中缓存时计一次（部分命中由随后的 `translateBatch` 计）。内部互相调用的是原函数，不会重复计数。
- **无痕窗口**：service worker 把发起标签页的 `sender.tab.incognito`（划词用 `chrome.tabs.get`）作为 `incognito` 传给上述函数，为真时不计；扩展页面另查 `chrome.extension.inIncognitoContext`。
- **本机队列**：`src/lib/usage.js`（`AITrUsage`）在 `chrome.storage.local` 的 `usageShare` 里按 `day|feature|provider` 累加，只在开关开启时写入，超过 35 天的丢弃。写入只在 service worker 里排队进行；扩展页面（阅读、PDF、图片、翻译面板）直接调用 providers，经 `usage-count` 消息交给 service worker（只接受扩展自己的页面）。
- **发送**：alarm `usage-share` 每 6 小时检查一次，把早于今天的条目（最多 200 条）POST 到 `/api/extension/usage-share`；204 后删除，400 丢弃，其他失败留待下次。没有扩展会话时不发、也不为此领取访客试用。
- **清空**：关闭开关、本机退出登录（含 401）时清空队列，不把上一个账户的计数记到下一个账户。

## 后端

- **迁移** `024_shared_feature_usage.sql`：表 `shared_feature_usage`，字段如上，外加 `user_id`（随账户级联删除）、`ext_version`、`browser`、`browser_major`、`os`、`received_at`。
- **接口** `POST /api/extension/usage-share`（`src/api/extension.js`，只接受扩展会话）：`{ rows }`，校验在 `src/usage/shared.js` 的 `readSharedRows`，任一条不合格整批 400；`ON CONFLICT (id) DO NOTHING`；每个用户每小时 6 次。不保存请求里的其他字段。
- **访客合并**：`mergeGuest` 与 `usage_events` 一样把记录迁到正式账户。
- **保留期**：180 天，按 `day` 删除；接收请求时每小时至多顺带清理一次（`pruneSharedUsage`）。
- **管理端** `/features`（改名「功能使用统计」）：上面是点数翻译（全部用户），下面是「自带 Key / 本机翻译（自愿分享）」：使用天次（账户 × 日）、人数、覆盖率（以开启分享的账户为分母）、请求数、失败率与各平台的使用天次。两块不相加。用户详情页另列该用户的分享记录。
- **用户端** `/usage`：有记录时显示「你分享的功能使用情况」（最近 30 天按功能、平台汇总），`POST /usage/shared/delete` 删除本人全部记录。

## 隐私与商店

`PRIVACY.md` 与官网隐私页有「自愿分享的功能使用情况」一节；商店说明见 `apps/extension/store-assets/privacy-tab.md`（User activity）、`edge/submission.json` 与 `firefox/submission.json`。官网首页不介绍此功能。

## 测试

- 扩展：`test/usage.mjs`（默认关闭、计数口径、无痕与点数翻译不计、失败与取消、缓存命中、只发已结束日子、收下 / 被拒 / 重试、关闭与退出清空、扩展页面经消息计数）。
- 后端：`test/usage-share.test.mjs`（字段校验、幂等、限频、清理、访客合并、级联删除、管理端汇总、用户端查看与删除）。
