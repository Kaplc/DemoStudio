# DSH × VS Code × DemoStudio 集成需求文档（PRD）

| 项目 | 内容 |
|---|---|
| 文档版本 | v0.1（草案） |
| 日期 | 2026-08-22 |
| 状态 | 待评审 |
| 适用范围 | DemoStudio 仓库内的 VS Code 扩展工程 + DSH 插件包工程 |

---

## 1. 背景与目标

### 1.1 背景

- **DemoStudio**（本仓库）：基于 Electron + Three.js 的游戏编辑器，已提供 HTTP 控制面（`127.0.0.1:9877+`，`/api/command`、`/api/status`、`/api/console-logs`）和 MCP 服务器（`editor/mcp-server.mjs`，stdio，工具：`start_game`、`stop_game`、`toggle_game`、`get_status`、`send_command` 等），可被外部 agent 控制。
- **DeepSeek Harness（DSH）**：DeepSeek 官方的 agent 运行框架，基于 Cordis 插件架构，以 `@deepseek-ai/dsh-*` 系列 npm 包发布（当前 `0.1.0-rc.6`）。提供可嵌入内核 `@deepseek-ai/dsh-headless`（无 Host/HTTP/浏览器层）、官方扩展面（工具注册、事件、技能、UI 槽等）与 profile/bundle 插件加载机制。
- **缺口**：目前引擎只能被"通用 MCP 工具"粗粒度控制；缺少一个原生 VS Code 体验的 agent 工作台，且缺少与引擎深度耦合的特化 agent 能力（场景检查、实体生成、测试闭环、崩溃自动诊断等）。

### 1.2 目标

1. **内核跟随官网更新**：DSH 内核不 fork、不冻结，升级路径 = 官方 npm 包升级，自定义代码零侵入。
2. **与引擎完美结合**：agent 能深度操控 DemoStudio 编辑器（场景、实体、运行、日志），形成"改代码 → 引擎验证 → 读反馈 → 迭代"闭环。
3. **VS Code 原生体验**：聊天侧边栏、命令面板、状态栏、原生终端/任务、原生文件系统，而非嵌入 DSH Web UI。

### 1.3 非目标（Non-Goals）

- 不 fork 或修改 DSH 内核源码。
- 不重写 DemoStudio 编辑器本体。
- 不把 DSH 的 Web UI 直接嵌入 VS Code（外壳型方案仅作为备选/兜底）。
- 不做多用户/云端协作。

---

## 2. 术语表

| 术语 | 含义 |
|---|---|
| DSH | DeepSeek Harness，DeepSeek 官方 agent 运行框架（Cordis 插件架构） |
| Cordis | DSH 底层的插件化框架（服务注入、事件总线、生命周期） |
| Profile | `~/.dsh/profiles/<name>/` 下的插件组合目录，含 `package.json`、`dsh.profile`（bundles 清单）、`cordis.patch.yml`（配置补丁层） |
| Bundle | 一组插件包（官方包解析自内核安装，第三方包解析自 profile 的 node_modules） |
| Extension Host | VS Code 扩展宿主进程（Node.js），扩展代码运行于此 |
| WebviewView | VS Code 侧边栏内的网页视图（本方案用于自绘聊天 UI） |
| EngineBridge | 插件内唯一接触 DemoStudio 引擎的适配模块 |
| MCP | Model Context Protocol，工具协议（本项目已有 `editor/mcp-server.mjs` 实现） |
| Tool Guard | DSH 工具执行前的拦截/审批门（allow / deny / ask） |
| Skill | DSH 技能机制（markdown 指令/知识，可被 agent 调用） |
| Slot | DSH Web 平面 UI 槽，插件可注册自定义组件（如场景预览卡片） |

---

## 3. 用户场景（核心用例）

| 编号 | 场景 | 涉及需求 |
|---|---|---|
| U1 | 用户在 VS Code 打开 DemoStudio 仓库，在侧边栏聊天中下达"给 Snake 增加速度等级，敌人生成加快"，agent 修改代码 → 自动通过引擎桥启动游戏 → 读取 console-logs 验证 → 必要时迭代 | FR-1、FR-3、FR-4 |
| U2 | 游戏运行中崩溃，插件捕获引擎事件，自动拉起 agent 诊断崩溃原因并提出修复 | FR-4.3、FR-5 |
| U3 | DSH 官方发布新版本，插件状态栏提示可更新；用户一键更新内核，自定义引擎功能不受影响 | FR-2 |
| U4 | 用户在 VS Code 中直接对编辑器下命令（命令面板：启动/停止游戏、打开聊天），无需打开聊天 | FR-1.1、FR-3 |
| U5 | 第三方 agent（如 VS Code 内置 Copilot/Claude）通过 MCP 使用引擎工具（现有能力，保持兼容） | FR-3.5 |

---

## 4. 总体架构

```
┌─ VS Code ──────────────────────────────────────────────────────┐
│  Extension Host (Node)                                          │
│                                                                 │
│  ┌─────────────────────────────┐    ┌────────────────────────┐  │
│  │ 原生 UI 层                   │    │ 内核层：DSH             │  │
│  │ · 聊天侧边栏 WebviewView     │◄──►│ · 外置 CLI 进程 或       │  │
│  │ · 命令面板 / 状态栏          │消息 │   内置 dsh-headless     │  │
│  │ · 原生终端 / 任务 (tasks)    │    │ · Agent/工具/事件/技能   │  │
│  └──────────────┬──────────────┘    └───────────┬────────────┘  │
│                 │ postMessage                  │ DSH 插件包      │
└─────────────────┼──────────────────────────────┼────────────────┘
                  │                              │
      ┌───────────▼────────────┐   ┌─────────────▼──────────────┐
      │ EngineBridge (适配层)   │◄──│ @demostudio/dsh-engine-tools│
      │ · 端口探测/拉起编辑器    │   │ (工具/守卫/事件/技能/UI槽)   │
      │ · MCP client            │   └─────────────┬──────────────┘
      └───────────┬────────────┘                 │
                  │   MCP (stdio)                │ 直接调用或复用 MCP
      ┌───────────▼────────────┐                 │
      │ editor/mcp-server.mjs  │◄────────────────┘
      │ (已有，复用)            │
      └───────────┬────────────┘
                  │ HTTP 127.0.0.1:9877+ (/api/command, /api/status, /api/console-logs)
          ┌───────▼────────┐
          │ Electron 编辑器  │ (Three.js 场景/游戏运行时)
          └────────────────┘
```

### 4.1 职责边界（三层解耦）

| 层 | 归属 | 更新路径 | 改动面 |
|---|---|---|---|
| 内核层（DSH） | 官方 `@deepseek-ai/*` 包 | npm 升级（官网发布） | 只动 `src/dsh/adapter.ts` |
| 引擎特化层 | `@demostudio/dsh-engine-tools` + `dsh-profile/` | 随本仓库版本 | 只动插件包与配置 |
| 集成壳层 | VS Code 扩展（本仓库新工程） | 随本仓库版本 | 不含引擎知识、不含 DSH 内部实现 |
| 通用桥（MCP） | `editor/mcp-server.mjs`（已有） | 随本仓库版本 | 保持向后兼容 |

---

## 5. 功能需求

### FR-1 VS Code 扩展壳

| 编号 | 需求 | 验收标准 |
|---|---|---|
| FR-1.1 | 注册命令面板命令：`DSH: 打开聊天`、`DSH: 启动引擎`、`DSH: 停止引擎`、`DSH: 启动游戏`、`DSH: 停止游戏`、`DSH: 重启内核`、`DSH: 检查内核更新` | 命令存在且可执行；无引擎时"启动游戏"给出明确引导 |
| FR-1.2 | 提供活动栏/侧边栏聊天视图（`WebviewViewProvider` + React 自绘 UI），消息流使用自定义薄协议 `{type, payload}` | 可收发消息；消息历史在会话内保留；UI 适配 VS Code 深浅主题 |
| FR-1.3 | 状态栏显示：引擎状态（未启动/运行中/游戏运行中）、内核版本、更新提示徽标 | 状态随事件实时更新；点击可跳转对应命令 |
| FR-1.4 | agent 的 shell 类工具映射到 VS Code 原生终端（`createTerminal`）或任务（`tasks.executeTask`），用户可见、可中断 | 命令在 VS Code 终端可见执行；中断可停止 agent 等待 |
| FR-1.5 | agent 的文件操作用 `vscode.workspace.fs`（获得 VS Code 权限/监视模型） | 文件改动出现在 VS Code 资源管理器与 Git 面板 |
| FR-1.6 | 扩展自身输出接入 `OutputChannel`（`DSH` 通道），含内核启动日志与桥接日志 | 日志可查；异常时有堆栈 |

### FR-2 内核接入与更新（跟随官网）

| 编号 | 需求 | 验收标准 |
|---|---|---|
| FR-2.1 | **默认外置内核**：启动时检测全局 `dsh`（`dsh --version`），未安装则引导安装（`npm i -g @deepseek-ai/dsh`），以子进程方式运行，`stdio: 'inherit'`，输出转接到 OutputChannel | 未装内核时给出可执行引导；已装内核时启动成功 |
| FR-2.2 | **可选内置内核**：配置项可切换为内置 `@deepseek-ai/dsh-headless`（扩展依赖，进程内运行）；两种模式行为一致 | 切换配置后重启扩展，功能无差异 |
| FR-2.3 | **更新检查器**：启动时及每日一次查询 npm registry 最新版本，与本机/内置版本比对；有新版时状态栏提示，支持一键更新（外置：`npm i -g` 命令；内置：提示更新扩展） | 有新版本时提示可见；更新后版本号刷新 |
| FR-2.4 | **适配层隔离**：所有内核交互集中在 `src/dsh/adapter.ts`；禁止在其余模块直接引用 DSH API | 代码评审约束；文档化适配层接口清单 |
| FR-2.5 | **版本兼容矩阵 CI**：GitHub Actions 将插件包 × 最近 2~3 个 DSH rc 版本跑冒烟测试（内核启动 → 工具注册 → 调用 → 销毁） | CI 矩阵全绿才允许发布 |
| FR-2.6 | DSH 升级导致的 API 变更只允许修改 `adapter.ts`，且适配层变更需版本化（CHANGELOG） | 升级后所有功能回归通过 |

### FR-3 引擎桥接（EngineBridge）

| 编号 | 需求 | 验收标准 |
|---|---|---|
| FR-3.1 | 端口探测：遍历 `9877` 起的递增端口，确认编辑器实例可达（`GET /api/status`） | 单实例/多实例均能正确发现 |
| FR-3.2 | 自动拉起：编辑器未运行时，可配置自动启动（`npm run dev` 或打包产物），启动过程有进度提示 | 拉起后状态栏转为"运行中" |
| FR-3.3 | 封装引擎工具集：`start_game`、`stop_game`、`toggle_game`、`get_status`、`send_command`、`read_console_logs`（复用 MCP client 连接 `editor/mcp-server.mjs`） | 每个工具可独立调用并返回结构化结果 |
| FR-3.4 | 多实例支持：可配置连接指定端口实例（`--port` 语义对齐现有 `editor_mcp.bat`） | 多开编辑器时可指定目标 |
| FR-3.5 | 错误语义：引擎不可达时工具返回明确错误（"编辑器未运行" / "端口未找到"），agent 可据此采取行动；扩展侧不崩溃 | 断连场景工具失败信息可读 |
| FR-3.6 | 保持现有 `.vscode/mcp.json` 的 `demostudio-editor` 注册，并在扩展 `contributes.mcpServers` 中重复注册，使 VS Code 内置 agent 也可使用引擎工具 | 两处注册并存互不冲突 |

### FR-4 引擎特化 agent 功能（DSH 插件包）

以 `@demostudio/dsh-engine-tools`（npm 包，随本仓库发布）+ `dsh-profile/`（配置与技能数据）承载。

| 编号 | 需求 | 验收标准 |
|---|---|---|
| FR-4.1 | 注册 DSH 原生引擎工具（`ctx.tools.register`），初始清单：`inspect_scene`（场景结构）、`spawn_entity`（生成实体）、`run_scenario`（跑测试场景并读结果）、`get_game_state`、`set_game_speed`；每个工具带 schema、输出声明与中文描述 | 工具出现在 agent 可调用清单；调用结果正确 |
| FR-4.2 | 工具守卫：高危操作（启动游戏、重置场景、批量删除）默认 `ask` 审批，可通过配置改 `allow`/`deny` | 审批流生效；配置可覆盖 |
| FR-4.3 | 引擎事件联动：插件订阅引擎事件（崩溃、关卡加载完成、测试结束），按配置自动触发 agent 行动（如崩溃自动诊断） | 事件触发后 agent 会话自动启动并包含事件上下文 |
| FR-4.4 | 引擎知识技能：`dsh-profile/skills/` 提供 markdown 技能（项目约定、Three.js 规范、性能调优、引擎命令速查），通过 `ctx.skills.registerProvider` 注册 | agent 能检索并遵循技能内容 |
| FR-4.5 | 引擎专家 persona（`dsh-persona` / `cordis.patch.yml` 提示词补丁） | agent 初始系统提示包含引擎上下文 |
| FR-4.6 | UI 槽：工具结果渲染自定义卡片（场景缩略信息、游戏状态面板、console 摘要），通过 `ctx.slots.register` 注册 | 聊天界面中工具结果以卡片呈现 |
| FR-4.7 | 工具实现只依赖 EngineBridge 或编辑器 HTTP API，不依赖 DSH 内部 API | 代码评审约束 |
| FR-4.8 | 插件包通过 profile 的 `dsh.profile.bundles` 加载；官方 bundle 与自定义 bundle 顺序明确，`cordis.patch.yml` 承载全部自定义配置 | profile 可独立重建（`dsh plugin` 可重装） |

### FR-5 生命周期与可靠性

| 编号 | 需求 | 验收标准 |
|---|---|---|
| FR-5.1 | 面板关闭、工作区切换、VS Code 退出时清理内核子进程与 MCP 连接（`onDidDispose` + `context.subscriptions` + 进程退出钩子） | 无残留进程；端口可立即复用 |
| FR-5.2 | 工作区 ↔ 会话映射：切换文件夹时按需重启内核/复用会话 | 切换后状态正确 |
| FR-5.3 | 内核崩溃自动重启（有限次数，避免死循环），并保留崩溃日志 | 重启后聊天可继续；日志可查 |
| FR-5.4 | 引擎进程被外部关闭时，状态栏与桥接层状态同步降级 | 状态一致，无假阳性 |

### FR-6 配置项（`contributes.configuration` 草案）

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `dsh.kernelMode` | enum | `external` | `external`（外置 CLI）/ `embedded`（内置 headless） |
| `dsh.autoStartEngine` | boolean | `true` | 激活时自动拉起编辑器 |
| `dsh.enginePort` | number | `0` | `0` = 自动探测 |
| `dsh.engineCommand` | string | `npm run dev` | 拉起编辑器命令 |
| `dsh.guardPolicy` | object | 高危工具 `ask` | 工具守卫策略（allow/deny/ask） |
| `dsh.enableEngineEvents` | boolean | `true` | 引擎事件 → agent 联动开关 |
| `dsh.checkUpdates` | boolean | `true` | 更新检查开关 |

### FR-7 打包与发布

| 编号 | 需求 | 验收标准 |
|---|---|---|
| FR-7.1 | `vsce package` 产出 `.vsix`，`.vscodeignore` 排除源码/测试，保留编译产物与运行时依赖 | 打包产物可在无开发环境机器安装 |
| FR-7.2 | 本地/内部分发优先；发布 Marketplace 为可选项 | 安装/卸载无残留 |
| FR-7.3 | `@demostudio/dsh-engine-tools` 与 `dsh-profile/` 独立版本化（随本仓库 tag 发布） | 插件包可单独升级 |

---

## 6. 非功能需求（NFR）

| 类别 | 需求 |
|---|---|
| 性能 | 聊天消息端到端延迟可感知 < 1s（不含 LLM 推理）；工具调用开销 < 100ms（不含引擎自身） |
| 安全 | Webview 使用 CSP 与 `localResourceRoots` 限制；HTTP 端口仅绑定 `127.0.0.1`；密钥使用 `dsh-credentials-local` / VS Code SecretStorage，不落明文；工具守卫默认保守 |
| 兼容 | 优先 Windows（当前开发环境）；DSH rc 版本漂移由兼容矩阵兜底；编辑器多实例端口递增兼容 |
| 可维护 | 三层边界单一入口（`adapter.ts`、`engineBridge.ts`、插件包）；模块职责在 README 中声明 |
| 可观测 | OutputChannel 日志分级；关键事件（内核启动/工具调用失败/引擎断连）有日志 |
| 体验 | 状态栏信息零噪音；未就绪状态有引导而非报错 |

---

## 7. 里程碑

| 里程碑 | 内容 | 估时 | 退出标准 |
|---|---|---|---|
| M0 | 扩展骨架：命令、空聊天 WebviewView、OutputChannel、VSIX 打包 | 0.5 天 | `vsce package` 成功，命令可执行 |
| M1 | 引擎桥：端口探测、自动拉起、状态栏、命令面板手动调用 `start_game` 等 | 1 天 | 一键启动/停止引擎与游戏 |
| M2 | 内核接入（外置 CLI）：会话运行、事件流 → 聊天界面 | 1~2 天 | 聊天中可完成一次 agent 对话 |
| M3 | 闭环：EngineBridge 工具注入 agent，实现"改代码 → 启动游戏 → 读日志 → 迭代" | 1 天 | U1 场景演示通过 |
| M4 | 特化插件包：DSH 原生工具、守卫、事件联动、技能、UI 槽、更新检查器、兼容矩阵 CI | 3~5 天 | 全部 FR-4 与 FR-2 验收项通过 |

---

## 8. 验收标准（最终）

1. 全新环境：安装 VSIX → 打开 DemoStudio 仓库 → 自动引导安装 DSH 内核 → 自动拉起引擎 → 聊天中完成 U1 全流程。
2. 内核升级：DSH 发布新版 → 状态栏提示 → 一键更新 → 重启后所有功能回归（含引擎特化工具）。
3. 断连恢复：引擎被关闭 → 状态降级 → 重新启动引擎 → 工具恢复可用。
4. 原生体验：shell 命令在 VS Code 终端可见；文件改动在 Git 面板可见；聊天 UI 符合 VS Code 主题。
5. 打包：VSIX 可安装卸载，无残留进程。

---

## 9. 风险与对策

| 风险 | 等级 | 对策 |
|---|---|---|
| DSH 为 `0.1.0-rc`，内部 API 可能大改 | 高 | 单一适配层 `adapter.ts`；内置版本锁 + 更新检查；兼容矩阵 CI；外置 CLI 模式作为稳定兜底 |
| 内置 headless 使扩展体积增大（数十 MB） | 中 | 默认外置 CLI；内置做成可选 |
| 引擎未启动时工具调用失败 | 低 | 桥接层自动拉起 + 明确错误语义（FR-3.2/3.5） |
| 多实例端口漂移导致误连 | 低 | 端口探测 + 显式 `enginePort` 配置（FR-3.4） |
| Webview 安全策略误伤功能 | 中 | 自绘页面 + 严格 CSP；iframe 方案仅作兜底（非目标） |
| 内核与插件包版本失配 | 中 | peerDependencies 版本范围 + 兼容矩阵（FR-2.5） |
| 自动化拉起编辑器与用户手动启动冲突 | 低 | 探测已运行实例优先；`autoStartEngine` 可关 |

---

## 10. 开放问题（待评审确认）

1. 外置 CLI 与内置 headless 的默认取舍是否确认？（建议默认外置）
2. 引擎特化工具初始清单（FR-4.1）是否覆盖实际需求？需补充哪些？（场景序列化、材质/光照调整、回放录制？）
3. 引擎事件如何从编辑器侧发出？需在 `electron/main.ts` 增加事件推送（WebSocket/SSE），还是轮询 `console-logs` 足够？
4. 扩展与插件包是否发布到公开 Marketplace / npm？还是仅内部 VSIX + 私有 registry？
5. UI 槽（FR-4.6）首期做到什么程度：文本卡片 → 简单截图 → 实时 Three.js 预览？
6. 是否允许 agent 直接修改编辑器场景文件（`.json` 项目文件），还是只允许通过工具？

---

## 11. 附录

### 11.1 参考资产（本仓库已有）

- `editor/mcp-server.mjs`：MCP stdio 服务器（工具清单见文件头注释）
- `electron/main.ts`：HTTP API 服务（`9877+`，`/api/command`、`/api/status`、`/api/console-logs`）
- `.vscode/mcp.json`：VS Code MCP 注册示例
- `editor_mcp.bat`：MCP 服务器启动脚本（含多实例 `--port`）

### 11.2 参考资产（DSH 官方，本机路径）

- 内核安装：`%APPDATA%\npm\node_modules\@deepseek-ai\dsh`
- Profile 目录：`~/.dsh/profiles/<web|headless>/`（含 `cordis.yml`、`cordis.patch.yml`、`package.json`、bundles 清单）
- 各官方包文档：`~/.dsh/profiles/node_modules/@deepseek-ai/<包名>/README.zh.md`（重点：`dsh-tools`、`dsh-skill`、`dsh-agent-tool-presentation`、`dsh-cordis-client-runner`、`dsh-mcp-client`、`dsh-headless`）
- 工具 schema 总目录：GitHub `deepseek-ai/deepseek-harness` 仓库 `docs/tool-catalog.md`

### 11.3 建议工程结构

```
E:\DemoStudio\
├── vscode-extension/            # 扩展工程（新）
│   ├── package.json             # contributes: commands/views/configuration/mcpServers
│   ├── src/
│   │   ├── extension.ts         # activate/deactivate、生命周期
│   │   ├── dsh/adapter.ts       # ★ 唯一接触 DSH 内核
│   │   ├── dsh/kernel.ts        # 外置/内置内核启动（可切换）
│   │   ├── dsh/updater.ts       # npm 版本检查与更新
│   │   ├── bridge/engineBridge.ts  # ★ 唯一接触引擎
│   │   ├── ui/chatView.ts       # WebviewViewProvider
│   │   ├── ui/chat.tsx          # React 聊天界面
│   │   └── commands.ts
│   └── .vscodeignore
├── dsh-profile/                 # DSH profile 数据（新）
│   ├── package.json             # 声明 @demostudio/dsh-engine-tools 等
│   ├── dsh.profile              # bundles 清单（官方 + 自定义）
│   ├── cordis.patch.yml         # persona / 提示词补丁
│   └── skills/                  # 引擎知识技能（markdown）
└── packages/dsh-engine-tools/   # DSH 插件包（新，npm 发布）
    ├── src/index.ts             # name/inject/apply
    ├── src/tools/*.ts           # 引擎原生工具
    ├── src/guards.ts            # 工具守卫
    ├── src/events.ts            # 引擎事件联动
    └── src/slots.tsx            # UI 槽（场景预览卡片）
```
