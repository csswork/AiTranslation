# 自愿分享功能使用记录（方案，未实现）

> 状态：方案草稿，待审核。下文的表、接口、设置项都还不存在。

## 要解决什么

管理端「托管功能使用统计」（`apps/backend/src/usage/features.js`）只能看到点数翻译：数据来自 `usage_events` 与 `usage_rejections`，服务端本来就要为计费记录这些请求。以下使用完全不经过后台，目前一无所知：

- 自带 Key 的大模型（ChatGPT、DeepSeek）与 DeepL；
- 本机翻译（浏览器内置 `Translator`）；
- 上面两类里命中本机译文缓存的使用。

于是无法回答「双语阅读、整份 PDF、整站翻译到底有多少人在用」「自带 Key 用户偏爱哪些功能」「本机翻译值不值得继续投入」。本方案让用户**自己选择**把这部分使用情况以按天汇总的计数交给我们，默认关闭。

## 吸取上一版的教训

2026-11-19 的上一版（`630e9d5`，后由 `4b59977` 与迁移 `021` 撤掉）做法是：开启后在托管请求里附带 `countFeatureUse` 标记，另加「授权技术支持查看」表。撤掉的原因是托管请求的功能统计直接用已有记录就能算，标记和授权都是多余的。本方案因此：

1. **只覆盖后台看不到的部分**：点数翻译不再重复上报，仍按现有记录统计，不受这个开关影响。
2. **不随翻译请求附带**：改为独立接口、每天最多一次、只发已结束的日子，避免把统计和某次具体请求的时间对应起来。
3. **不做技术支持授权**：用户本人可在用户中心查看与删除，运营只看汇总。

## 收集什么、不收集什么

每条记录是「某个本地日期 × 功能 × 平台」的计数：

| 字段 | 取值 | 说明 |
| --- | --- | --- |
| `day` | 浏览器本地日期 `YYYY-MM-DD` | 只发已结束的日子，最多回溯 30 天 |
| `feature` | 现有 `SURFACES` 枚举 + `alternatives` | 与托管统计同一套口径 |
| `provider` | `openai` / `deepseek` / `deepl` / `local` | 固定枚举；不含 `hosted` |
| `requests` | 1–10000 的整数 | 当天发出的翻译/识图/换说法调用次数（含缓存命中），超出按上限截断 |
| `failures` | 0–10000 的整数 | 其中失败的次数（Key 无效、额度用尽、网络等），不细分原因 |

随请求已有的扩展版本（`x-huaci-version`）与浏览器/系统家族（`requestClient`）照常按现有低基数枚举记录。

**不收集**：原文、译文、网址或域名、页面标题、语言对、模型名、自定义接口地址、API Key 的任何部分、精确时间、无痕窗口里的使用。

> 首版不加目标语言（2026-11-21 确认）：它对「先支持哪些语言」有用，但会让记录更细；以后要加须另行评估并更新隐私说明。

## 用户体验

- 设置页新增一张卡片「帮助改进」，一个开关「分享功能使用情况（不含翻译内容）」，**默认关闭**。说明文字逐项列出上表字段，并说明点数翻译的记录本来就在用户中心可见、不受此开关影响。
- 「查看待发送的内容」展开本机队列（纯文本表格），用户看到的就是会发出的全部内容。
- 关闭开关：立即清空本机队列，不再发送；已发送的记录到用户中心删除（见下）。
- 只在设置页提供（2026-11-21 确认）：不在安装页、欢迎页、弹窗或翻译过程中询问或提示开启。
- Firefox：开关打开时在同一次点击里调用 `browser.permissions.request({ data_collection: ['technicalAndInteraction'] })`；打包器已把它声明为可选权限（`scripts/prepare-store-package.mjs`），未授予时开关保持关闭。版本上报已依赖同一权限（`account.js` 的 `canShareVersion`），两者口径一致。
- 开关存 `chrome.storage.local` 的 `settings.shareUsage`，与其他设置一样不经 Chrome 账号同步：同意按浏览器单独给出。

## 扩展实现

**计数点**：在 `src/lib/providers.js` 的统一出口（`translate`、`translateBatch`、`alternatives`、`readImageText`、`translateCaption`）里，平台形态为 `llm` / `mt` / `local` 时调用新的 `AITrUsage.count({ surface, provider, ok })`；`hosted` 不计。缓存命中照样计一次请求。需要先核对所有调用点都带上了 `surface`（页面、整站、PDF、双语阅读已通过 `message.surface` 传入；识图固定为 `image`，换说法为 `alternatives`，字幕为 `subtitle`），缺的补齐，不认识的值丢弃。

**无痕窗口**：Chrome 默认「spanning」模式下无痕标签页与普通标签页共用 service worker。计数调用需带上发起标签页的 `sender.tab.incognito`，为 `true` 时不计；无法判断来源的（例如扩展页面自身）按普通窗口计。

**本机队列**：新文件 `src/lib/usage.js`，在 `chrome.storage.local` 的 `usageShare` 里按 `day|feature|provider` 累加；只在开关开启时写入。超过 35 天的条目丢弃。每行首次创建时生成随机 `id`（UUID），用于服务端幂等。

**发送**：复用 `background.js` 现有 alarm 机制，新增一个每 24 小时的 alarm：取出所有早于今天的条目（最多 200 条）POST 到 `/api/extension/usage-share`，204 后从队列删除；失败留到下一次。没有扩展会话（访客领取失败且未登录）时不发，条目到期自然丢弃。退出登录时清空队列，避免把上一个账户的使用记到下一个账户。

## 后端实现

**迁移 `024_shared_feature_usage.sql`**（只追加）：

```sql
CREATE TABLE shared_feature_usage (
  id uuid PRIMARY KEY,                       -- 扩展生成，重复提交时 ON CONFLICT DO NOTHING
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day date NOT NULL,
  feature text NOT NULL CHECK (feature IN ('selection','panel','page','site','image','pdf','reader','subtitle','alternatives')),
  provider text NOT NULL CHECK (provider IN ('openai','deepseek','deepl','local')),
  requests integer NOT NULL CHECK (requests BETWEEN 1 AND 10000),
  failures integer NOT NULL CHECK (failures BETWEEN 0 AND requests),
  ext_version text, browser text, os text,   -- 与 usage_events 相同的约束
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shared_feature_usage_day ON shared_feature_usage (day DESC);
CREATE INDEX shared_feature_usage_user ON shared_feature_usage (user_id);
```

**接口**（`src/api/extension.js`，`requireExtension`）：

- `POST /usage-share`：`{ rows: [...] }`，最多 200 条；逐字段按枚举与范围校验，`day` 不得晚于服务端「今天 + 1 天」、不得早于 35 天前，任一条不合格整批 400。按用户限频（例如每小时 6 次）。返回 204。
- `DELETE /usage-share`：删除本人全部分享记录（扩展里不提供按钮，留给用户端调用同一函数）。

**访客合并**：`src/guest/index.js` 合并时与 `usage_events` 一样把 `shared_feature_usage` 迁到正式账户。

**保留期**：只保留 180 天，在现有定期清理处追加 `DELETE ... WHERE day < current_date - 180`。账户删除时级联删除。

**运营规则**：保留期、单批上限、限频若要可调，按约定放进 `app_settings` 并更新 `src/settings`；首版可先写常量。

## 界面

**管理端**：「托管功能使用统计」改名「功能使用统计」，分两块：

- 托管（全部用户）：现有表格不变。
- 自带 Key / 本机（仅开启分享的用户）：各功能的使用天次（账户 × 日）、账户数、请求数、失败率，以及按平台拆分；表头注明「样本只含开启分享的 N 个账户，不代表全部用户」。不把两块相加，避免有偏样本混进全量数字。

用户详情页（`userPage` 的 `featureUsage`）同样分两块显示。

**用户端**：「用量与点数」页下新增「你分享的功能使用情况」：最近 30 天按功能、平台汇总，附「删除全部分享记录」按钮（POST 表单，按现有同源校验）。文案进 `apps/backend/i18n/` 并跑 `npm --prefix apps/backend run i18n`。

## 隐私与商店

- 更新 `PRIVACY.md` 与官网隐私页（中文源 + 生成的各语言）：新增「自愿分享的功能使用情况」一节，列出字段、默认关闭、发送频率、保留 180 天、如何关闭与删除。
- Chrome Web Store / Edge 的数据使用声明：核对是否需要勾选「用户活动」类别并更新说明；Firefox 依靠上面的可选 `technicalAndInteraction` 权限。
- 官网首页不提此功能；随扩展版本发布后只在隐私页与更新日志说明。

## 测试

- 扩展：`usage.js` 的累加、跨天、35 天丢弃、开关关闭清空、退出清空、无痕不计、`hosted` 不计；Firefox 权限未授予时不写入。
- 后端：字段校验（枚举、范围、日期窗口、条数上限）、幂等重复提交、限频、访客合并迁移、用户端删除、管理端两块数字互不相加。
- 隐私页：多语言一致性检查覆盖新段落。

## 分步

1. 后端：迁移、`POST/DELETE /usage-share`、访客合并、清理、测试。
2. 扩展：`usage.js`、计数点与 `surface` 补齐、设置卡片与预览、Firefox 权限、alarm 发送、界面文案与测试。
3. 管理端与用户端展示、后端 i18n。
4. 隐私说明、商店数据声明，随下一个扩展版本发布。

## 已定

- 记录关联账户（2026-11-21 确认），不另设匿名安装 ID。用现有扩展会话（访客或正式账户）的 `user_id` 入库，能和托管数据按「账户 × 日」去重，随访客合并迁移、随账户删除。因此隐私说明要写明这些记录与账户关联，用户可在用户中心查看与删除。
- 首版不收集目标语言（2026-11-21 确认）。
- 开关只放在设置页，不做任何提示开启（2026-11-21 确认）。

## 待审核决定

1. 保留期 180 天是否合适。
