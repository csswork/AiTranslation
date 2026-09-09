# AI 划词翻译

一个 Chrome 扩展：**选中非中文文字 → 右键「翻译成中文」→ 屏幕中央弹窗流式显示译文**。
翻译由 AI 大模型完成，支持 **ChatGPT（OpenAI）** 和 **DeepSeek** 两个平台，可随时切换。

## 功能

- **只在需要时出现**：选中的文字如果本身就是中文，右键菜单里不会出现这一项；纯数字、纯标点、纯 emoji 同样不出现。日文、韩文都会正常提供翻译。
- **屏幕中央弹窗**：不是跟着鼠标的小气泡，而是居中的模态弹窗，标题栏可拖动，`Esc` 或点击遮罩关闭。
- **流式输出**：译文逐字显示，不用干等整段返回。
- **双平台**：ChatGPT / DeepSeek，弹窗右上角可直接切换平台重译。
- **一键复制**、**重新翻译**、**原文对照**（可折叠）。
- 跟随系统深色 / 浅色模式。

## 安装

1. 打开 `chrome://extensions/`；
2. 打开右上角的 **开发者模式**；
3. 点 **加载已解压的扩展程序**，选中本目录（`AiTranslation`）。

首次安装会自动打开设置页。

## 配置

在设置页选一个平台并填入 API Key：

| 平台 | 申请地址 | 默认模型 | 接口地址 |
| --- | --- | --- | --- |
| ChatGPT | <https://platform.openai.com/api-keys> | `gpt-5.6-luna` | `https://api.openai.com/v1` |
| DeepSeek | <https://platform.deepseek.com/api_keys> | `deepseek-v4-flash` | `https://api.deepseek.com` |

两边都默认选了各自最便宜的档位（翻译是高频短任务）。候选里还有
`gpt-5.6-terra` / `gpt-5.6-sol` / `gpt-6-astra` 和 `deepseek-v4-pro`，
也可以直接手填该平台支持的任意模型名。填好后点 **测试连接** 验证。

其他可调项：目标语言（简体 / 繁體，右键菜单标题会跟着变）、流式输出、弹窗内是否保留原文。

## 使用

选中一段外文 → 右键 → **翻译成中文**。

## 目录结构

```
manifest.json              Manifest V3 声明
src/
  background.js            Service worker：菜单显隐、发起翻译、把结果流式推给页面
  lib/
    lang.js                语言判定（这段文字要不要翻译）
    settings.js            平台定义与配置读写
    providers.js           OpenAI 兼容接口请求、SSE 解析、错误映射
  content/content.js       选区上报 + Shadow DOM 弹窗
  options/                 设置页
  popup/                   工具栏弹窗（状态一览 + 快速切换平台）
icons/                     图标
```

## 几个实现上的取舍

- **菜单显隐的时机**：Chrome 在右键按下的那一刻就确定了菜单项，而 `contextMenus.update()` 是异步的。所以页面脚本在 `mouseup` / `selectionchange` 时（也就是右键之前）就把选中的文字上报给后台并更新菜单状态，`contextmenu` 事件只作兜底。菜单默认可见，万一上报没跑起来也不会让功能凭空消失。

- **「是不是中文」怎么判断**：先排除假名（日文）和谚文（韩文），再看汉字占全部字母的比例，达到 50% 就算中文、不提供翻译。所以「这个 API 很好用」不提供，「ChatGPT is 很 good」会提供。

- **弹窗为什么用 Shadow DOM**：页面里 `* { font-family: ... !important }` 这类全局样式非常常见，Shadow DOM 才能保证弹窗在任何站点上长得一样。宿主节点用 `all: initial` 打底，可继承属性在面板上全部显式声明。

- **弹窗只在顶层框架显示**：选区上报在所有 iframe 里都跑（否则 iframe 里选中的文字判断不了），但后台固定 `connect(frameId: 0)`，所以弹窗始终居中于整个页面，而不是某个小 iframe。

- **端口由页面侧关闭**：后台紧跟 `postMessage('done')` 就 `disconnect()` 有丢消息的风险，所以改由页面收到 `done` 后自己断开。

- **两边都要显式关掉「思考」**：DeepSeek v4 默认 `thinking.type: enabled`（且 `reasoning_effort` 默认 high），OpenAI 的 gpt-5.x / gpt-6 默认 `reasoning.effort: medium`。翻译并不受益于思考，只会白白增加延迟和 token 费用，所以请求里显式压到最低：DeepSeek 传 `thinking: {type: 'disabled'}`，OpenAI 传 `reasoning_effort: 'low'`（`none` 档 `gpt-6-astra` 不支持，会返回 400，官方对延迟敏感场景也建议从 `low` 起步）。

- **temperature 按平台分开取值**：OpenAI 的非推理模型用 `0.2`；DeepSeek 用 `1.3`——这是它官方参数文档里「翻译」场景的推荐值，和 OpenAI 的语义不一样，不能照抄。推理模型不传 temperature。

- **参数被拒时会降级重试**：两个平台的模型阵容和参数都在变，用户还能手填任意模型名。所以一旦返回 400 且报的是参数问题，就自动去掉全部可选调参、用最小请求体（只剩 `model` / `messages` / `stream`）重试一次，避免因为一个不被支持的字段就彻底翻不了。非参数类的 400 不重试。

- **API Key 存在哪**：`chrome.storage.local`，只留在本机，不走 Chrome 账号同步、不上传任何第三方。请求只发往你所选平台的接口地址。

## 已知限制

- `chrome://`、Chrome 应用商店等受保护页面无法注入脚本，扩展在这些页面上不工作。
- 单次最多翻译 6000 个字符，超出部分会被截断并在弹窗中提示。
- 自定义接口地址（代理 / 中转）需要额外授权域名，点「测试连接」时会弹出授权请求；只支持 https。

## 许可

本项目以 [GNU General Public License v3.0](LICENSE) 授权发布。

    AI 划词翻译 — 用 AI 把选中的外文翻译成中文的 Chrome 扩展
    Copyright (C) 2026  Haibo

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
