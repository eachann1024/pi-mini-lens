<p align="center">
  <img src="assets/mini-lens-hero.png" alt="Mini Lens for Pi — 会话状态，一眼清晰。紧凑底栏呈现模型、Token、缓存、费用、上下文与生成速度。" width="100%">
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="#安装">安装</a> · <a href="#按你所需">设置</a> · <a href="https://github.com/user-attachments/assets/5f2f4816-45ed-4759-b035-d9ee59e8a763">演示视频</a>
</p>

[Pi](https://pi.dev) 的紧凑、可配置底栏。模型、用量、预估费用、上下文与生成速度，一眼清晰。

## 极简输出

执行 `/mini-lens-settings`，进入 **Lens** 或 **极简输出** 分组。极简模式默认开启（保留用户显式关闭的设置）：

- `/mini-lens-minimal on`：用户原文使用强调色背景；执行过程和最终回复均无背景色，最终回复直接显示，无标题、无额外背景。不重复添加底部面板。
- 每轮工具、Agent、Skill 与思考统一为状态树，默认显示最近 **6 条摘要**；`Ctrl+O` 展开完整过程，再按一次收起。新提问恢复默认折叠。工具暂未输出时保留执行状态并每秒更新等待时长；空进度不会覆盖已有内容。支持流式思考（模型提供时）、工具调用、执行输出与读取的 skill。完整原始消息仍保留在会话中。
- Agent/subagent 调用与工具、Skill 按发生顺序合并，`Ctrl+O` 展开任务与 Markdown 输出；摘要中的“完成”仅表示工具调用返回，不代表后台任务完成。
- 接管 pi-subagents 的 `async subagent` / `Async agents` 后台摘要，使用无背景状态树，保留详情快捷键和输出路径。仅在极简模式开启时启用；关闭后恢复原视图，未知格式保持原样。设计参考 [pi-cc-extensions](https://github.com/minuque/pi-cc-extensions) 的调用分组。
- `/mini-lens-history`：按轮翻阅收起的完整过程内容，每页最多 5 条。
- 最终正文随文本事件实时流式展示；中止或失败会显示相应状态。
- `/reload` 后自动重新挂载，原生模式产生的历史消息也按当前极简样式重建；展开详情的竖线跨段落、空行和代码块连续显示。
- `/mini-lens-minimal off`：恢复原生消息展示。

用户块背景由 Pi 当前强调色与用户背景色混合；过程和回答无背景，文字适配深浅主题。用户块内边距为左右 2 列、上下 1 行（终端不支持 px）。全程支持 Markdown、表格、代码高亮和 Mermaid 终端图表；图表不支持、未完整或过宽时保留源码。**极简模式依赖 Pi 0.85.x 的私有消息区布局**，不修改 Pi 安装文件；无法识别布局时拒绝启用并保留原生输出。Pi 升级后需重新验证兼容性，其他扩展同时替换消息区时也可能冲突。

开发验证：`npm run check && npm test`；真实终端冒烟：`python3 test/minimal-pty.py`（Python 3、Node，以及依赖中 Pi 的 bundled CLI）。后者使用临时会话验证 regular/fullscreen、开关恢复、六条摘要、Ctrl+O 展开/收起、历史结果和窄屏，不调用模型。

## 安装

```bash
pi install npm:@each1024/pi-mini-mode
```

在 Pi 中执行 `/reload` 即可加载。需要 **Pi ≥ 0.84.0**。

<details>
<summary>也可以从 GitHub 安装</summary>

```bash
pi install git:github.com/eachann1024/pi-mini-mode
```

</details>

---

<table>
<tr>
<td width="50%" valign="top">

### 会话状态，尽在眼前

- 模型与思考等级
- 会话累计 Token
- 缓存用量与命中率
- 会话预估费用
- 上下文占用与进度
- 最近一次生成速度

</td>
<td width="50%" valign="top">

### 按你所需

自由选择显示字段。每次调整都有即时预览，并跟随你的 Pi 主题。

<a href="assets/mini-lens-settings.jpg"><img src="assets/mini-lens-settings.jpg" alt="Pi 浅色主题下的 Mini Lens 设置界面，包含即时预览与字段开关。点击查看原图。" width="100%"></a>

[观看设置演示](https://github.com/user-attachments/assets/5f2f4816-45ed-4759-b035-d9ee59e8a763)

</td>
</tr>
</table>

执行 `/mini-lens-settings` 自定义底栏，修改即时生效。

**自然融入终端。** 跟随 Pi 主题，适配窄窗口。仅替换底栏，保留 Pi 内置的工具与思考展示。

## 详细参考

<details>
<summary><strong>首次运行与配置</strong> — 默认值、操作方式和配置文件</summary>

首次在交互式 TUI 会话运行时，Mini Lens 会展示所有字段默认开启的预览：

```text
deepseek-v4-flash  high  Total 45K  Cached 25K  CH 40.0%  $0.012  500/1.0M  █░░░░░░░░░  1%  120 tok/s
```

首次运行选择器提供 **Keep defaults** 和 **Configure now**。保持默认会持久化全部显示项均为开启，并不再重复提示；立即配置会直接打开同一份设置列表。print、JSON 等非交互模式绝不会弹出提示。

以后随时执行下面的命令打开设置界面：

```text
/mini-lens-settings
```

当前设置项与上方对应预览字段同步使用主题强调色 `accent` 加粗高亮，并带有 `selectedBg` 背景。Pi 全屏模式支持鼠标悬停定位、点击切换；普通终端模式使用键盘导航。仅悬停不会修改设置。

修改会立即刷新底栏；该命令需要在 Pi TUI 模式中执行。设置面板中的预览始终使用固定示例数据，而不会读取当前会话，并会立即反映每个开关。

设置保存在 Pi 的全局 agent 目录（通常是 `~/.pi/agent/mini-lens.json`；若 Pi 使用其他配置目录，则随 Pi 的目录而定）。文件缺失或损坏时会安全地回退为默认值。

```json
{
  "mini-lens-model-show": true,
  "mini-lens-thinking-show": true,
  "mini-lens-ch-show": true,
  "mini-lens-session-tokens-show": true,
  "mini-lens-cache-tokens-show": true,
  "mini-lens-cost-show": true,
  "mini-lens-context-show": true,
  "mini-lens-context-dots-show": false,
  "mini-lens-context-percent-show": true,
  "mini-lens-speed-show": true,
  "mini-lens-speed-unit-show": true,
  "onboardingCompleted": true
}
```

| 配置项 | 默认值 | 控制内容 |
| --- | --- | --- |
| `mini-lens-model-show` | `true` | 不含 provider 前缀的模型 ID |
| `mini-lens-thinking-show` | `true` | thinking level |
| `mini-lens-ch-show` | `true` | 会话缓存命中率（`CH`） |
| `mini-lens-session-tokens-show` | `true` | 会话累计 Token（`Total`） |
| `mini-lens-cache-tokens-show` | `true` | 累计缓存读取 + 缓存写入 Token |
| `mini-lens-cost-show` | `true` | 会话列表价预估 |
| `mini-lens-context-show` | `true` | 已用/总上下文 Token 和进度条 |
| `mini-lens-context-dots-show` | `false` | 使用单行点阵进度条，默认保留原实心样式 |
| `mini-lens-context-percent-show` | `true` | 上下文使用百分比 |
| `mini-lens-speed-show` | `true` | 最右侧生成速度 |
| &nbsp;&nbsp;&nbsp;&nbsp;`mini-lens-speed-unit-show` | `true` | 生成速度的子项：是否在数值后显示 `tok/s` |
| `onboardingCompleted` | 初始为 `false` | 用于防止再次出现首次运行提示的内部标记 |

- **生成速度**
  - **Show tok/s unit**（`mini-lens-speed-unit-show`）是 `/mini-lens-settings` 中 **Show latest generation speed** 下方缩进的次级设置。关闭后仍显示速度数值（例如 `40.0`），但去掉 `tok/s`。
  - 关闭生成速度主项时，子项值会被保留，但不会生效。

</details>

<details>
<summary><strong>指标如何计算</strong> — Token、缓存、速度与预估费用</summary>

会话累计值从当前会话分支上每个已完成的 `assistant` 和 `toolResult` 条目聚合。工具上报的嵌套 LLM 用量（例如子代理）也会恰好计入一次。`Total` 优先使用服务商上报的 `totalTokens`；旧版或自定义工具结果没有该字段时，回退为 input、output、cache-read、cache-write Token 之和。`Cached` 是 cache-read + cache-write，属于 Total 的一部分；`CH` 是 cache-read / (input + cache-read)。只统计已持久化的最终用量，因此流式更新不会重复累计。

assistant 流式输出期间，一旦同时有正数的累计 `usage.output` 和已过时间，速度就会出现；流式期间会持续刷新，计算为从该 assistant 消息开始至今的输出 Token / 时间。完成后的速度会保留：之后只有工具调用或等待输出的 assistant 消息不会清除它；只有新的可测量生成才会替换它。output 倒退或时间未递增的采样会忽略。对于只在工具完成时上报嵌套 LLM 用量、没有流式事件的工具，最终速度为输出 Token / 该工具执行时长。工具没有上报 output 用量时无法可靠测速，会保留之前的速度。

还没有可测量的响应时，速度字段会完全隐藏，绝不显示 `-- tok/s` 占位内容。速度出现时固定在底栏最右侧；若开启上下文百分比，百分比紧邻在速度左边。速度颜色使用 Pi 主题语义色：>=30 tok/s 为 **success**，10–29.9 tok/s 为 **warning**，低于 10 tok/s 为 **error**。没有硬编码颜色，因此会契合当前 Pi 主题。

价格来自同一份当前分支最终用量和模型配置的每百万 Token 单价，是预估值而不是服务商账单。窄终端会降级或截断低优先级内容，以保持单行且不溢出。

</details>

<details>
<summary><strong>开发</strong> — 本地安装与检查</summary>

开发时只能安装本地副本；同时安装 npm 与本地副本会重复注册扩展：

```bash
pi remove npm:@each1024/pi-mini-mode && pi install /path/to/pi-rolling-process
npm run check
npm test
```

修改源码后，在已打开的 Pi 会话中执行 `/reload`。`npm run check` 做 TypeScript 检查，`npm test` 运行底栏、设置交互和发布自检。

</details>

## 发布

每次推送到 `main`，通过 `npm ci`、`npm run check` 和 `npm test` 后自动发布 npm；也可在 `main` 手动触发工作流。发布版本取本地版本基线与 npm 最新稳定版本 patch 加一的较大值。版本仅在 runner 工作副本中修改，不回写版本提交、不创建 tag；发布 major/minor 时，提高 `package.json` 和 lockfile 中的本地基线即可。已发布的 commit 会跳过。Actions 并发机制可能合并待运行的 push，不保证每次 push（或一次 push 中每个 commit）都单独发包。

一次性配置：先由已登录的维护者账号首次发布 `@each1024/pi-mini-mode@1.3.1`，再在 npm 包设置中绑定 **Trusted Publisher**：GitHub owner `eachann1024`、repo `pi-mini-mode`、workflow `publish.yml`（不填 environment），并允许直接 `npm publish`。后续通过 OIDC 发布并附带 provenance，无需 npm token。

---

[MIT 许可证](LICENSE) · 为 [Pi](https://pi.dev) 而作
