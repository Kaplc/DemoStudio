# DSH 与引擎集成架构

> 状态：M1 已实现代码（基础架构就位）；端到端实测在 headless bundle 服务对齐阶段（详见 §3.4 待办）。
>
> **最近更新**：把 `editor/dsh-agent-service.js` 改为 CJS 版（`.cjs`），加入 `globalThis.__dshEngineCtx` 注入机制，新增 profile 自举与 SDK JSON-RPC server patch。

---

## 1. 使用方法（开发者视角）

### 启动编辑器（自动拉起 DSH）

```bash
npm run dev
```

启动顺序（`electron/main.ts` 的 `startApp()`）：

1. `showLoadingWindow()` —— 显示无边框加载窗口
2. `startMCPServer()` —— 引擎 HTTP API，端口从 `9877` 开始自动递增（多实例支持）
3. `startDSHService()` —— 拉起 DSH Agent 服务（见 §2.1）
4. `waitForDevServer()` —— 等 Vite 起来
5. `createMainWindow()` —— 主窗口加载
6. `app-ready` IPC 触发后关闭加载窗口

### AgentPanel 连接 DSH

打开编辑器主窗口 → 侧边栏 / 视图 → **Agent 面板** → 自动调用 `electronAPI.dshStatus()` → 拿到 DSH 端口 → HTTP `GET /health` 二次确认 → 状态切到 `connected`。

### 用户发消息

```
AgentPanel.inputBox.onSend(text)
  └─> agentService.send(text)            // src/editor/AgentService.ts
        └─> POST http://127.0.0.1:DSH_PORT/chat   // SSE 流
              ├─ event: delta → message.delta  → AgentPanel 流式追加
              ├─ event: done  → message       → AgentPanel 完整消息入列
              └─ event: error → error         → AgentPanel 错误显示
```

### DSH 反向调引擎

DSH runtime (Cordis + dsh-plugin) 调工具时：

```
Cordis.toolRegistry.get('inspect_scene').execute(args, ctx)
  └─> getEngineContext(ctx) → ctx.engineBridge / globalThis.__dshEngineCtx.engineBridge
        └─> POST http://127.0.0.1:ENGINE_PORT/api/command     // 引擎 MCP API
              └─> 路由到 renderer → AIModule.emit / 资产读取等
```

DSH 子进程在 spawn 时通过 `globalThis.__dshEngineCtx` 拿到 bridge（由 dsh-agent-service.cjs 在 spawn 前注入）。

---

## 2. 工作流程（启动 → 聊天 → 调工具）

### 2.1 DSH 启动时序

```
┌──────────────────────────────────────────────────────────────┐
│  Electron main process                                        │
│  startMCPServer() → MCP_API_PORT = 9877                       │
│  startDSHService()                                            │
│    └─ spawn(process.execPath, ['editor/dsh-agent-service.cjs'])│
│         env.ELECTRON_RUN_AS_NODE=1                            │
│         env.DSH_ENGINE_PORT=MCP_API_PORT                      │
│         env.DSH_WORKSPACE_ROOT=<workspace>                    │
│         env.DEEPSEEK_API_KEY=...                              │
│       stdout: "[dsh-agent] DSH Agent 服务已启动，端口: N"     │
│    └─ main 解析端口 → _dshPort=N                              │
│    └─ 探测 loop: 等 _dshPort != 0 (15s timeout)               │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  dsh-agent-service.cjs (子进程，require.main === module 自启)  │
│  start()                                                      │
│    1. createEngineBridge(enginePort)                         │
│       → { callTool, getStatus, getConsoleLogs, ... }        │
│    2. createFileBridge(workspaceRoot)                        │
│       → { readJsonFile, writeJsonFile, listDir }             │
│    3. globalThis.__dshEngineCtx = { engineBridge, fileBridge }│
│    4. ensureProfile(workspaceRoot)                           │
│       → harness/profile/profiles/demostudio/                │
│         ├─ package.json (dsh.profile.bundles=[...])         │
│         ├─ node_modules/@demostudio/dsh-engine-tools →       │
│         │   软链接到 harness/dsh-plugin/                     │
│         └─ node_modules/@deepseek-ai/dsh-sdk-jsonrpc-server  │
│             → 软链接到 harness/dsh-source/packages/sdk/server│
│    5. startDSHRuntime()                                      │
│       → DeepSeekHarness({ launch: {                          │
│           command: process.execPath,                         │
│           args: [dshBin, '--profile', 'demostudio'],         │
│           env: { DSH_HOME: harness/profile, ... }            │
│       } })                                                    │
│    6. startHTTPServer()                                       │
│       → /health  /chat (SSE)  /chat-sync (JSON)              │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  DSH runtime (Cordis via harness/dsh-source/apps/cli/bin.js) │
│  --profile demostudio 加载顺序：                              │
│    bundles (e.g. @demostudio/dsh-engine-tools)                │
│    user-level patches (harness/profile/cordis.patch.yml)     │
│    --patch overlays (如有)                                    │
│  关键 patch：                                                 │
│    - id: system-prompt / config.persona = '<DemoStudio 提示>'│
│    - id: logger / disabled = true（stdout 预留给 JSON-RPC）   │
│    - insert: sdk-jsonrpc-server（@deepseek-ai/dsh-sdk-jsonrpc-server）│
│    - insert: dsh-engine-tools（@demostudio/dsh-engine-tools）  │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  SDK JSON-RPC server（@deepseek-ai/dsh-sdk-jsonrpc-server）   │
│  监听 stdin/stdout JSON-RPC 帧                                 │
│  接受 initialize / session.prompt / shutdown                   │
│  推 session.event / session.status / subagent.* notifications│
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  dsh-sdk-client（HarnessClient，stdin/stdout JSON-RPC）        │
│  → SDK events 转成 notifications                              │
│  → dsh-agent-service.consumeSubscription 路由到 SSE           │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 聊天 → 调工具 时序

```
User (AgentPanel) → send(text)
   ↓
AgentService.send(text)                     [src/editor/AgentService.ts]
   ├─ emit('message', { role: 'user', content: text })
   └─ fetch POST /chat (SSE) → 读流
        ↓
DSHAgentService HTTP server                 [editor/dsh-agent-service.cjs]
   ├─ 创建 SessionRecord（writeDelta/writeDone/writeError）
   ├─ harness.session().run(text, history, { onNotification })
   └─ 等待 DSH SDK notification
        ↓
SDK → JSON-RPC session.prompt               [dsh-sdk-client ↔ dh-sdk-jsonrpc-server]
   ↓
DSH runtime (Cordis)                        [harness/dsh-source]
   ├─ LLM 推理（DeepSeek API）
   ├─ 决定调 inspect_scene
   ├─ 触发 tool_use notification → routeEvent → writeDelta
   ├─ Cordis tool registry → dsh-plugin 工具
   │     └─ getEngineContext({}) → globalThis.__dshEngineCtx
   │           └─ engineBridge.callTool('inspect_scene', { scenePath })
   │                 └─ fetch http://127.0.0.1:ENGINE_PORT/api/command
   │                       └─ 引擎返回 { status: 'ok', data: ... }
   ├─ tool_result notification → writeDelta
   └─ LLM 收尾生成最终回复
        ↓
   routeEvent('message') → writeDone
        ↓
SSE event: done → AgentService 推 message 事件
        ↓
AgentPanel 渲染完整回复
```

### 2.3 端口分配

| 端口 | 服务 | 启动方 | 备注 |
|---|---|---|---|
| `5173+` | Vite dev server | Vite | 多实例递增 |
| `9877+` | 引擎 MCP API | Electron main.ts | `findFreePort(9877)` |
| 随机 | DSH Agent HTTP | dsh-agent-service.cjs | `findFreePort(0)` |
| 无（stdio） | DSH runtime ↔ dsh-sdk-client | SDK client spawn | JSON-RPC over stdio |

---

## 3. 边界条件

### 3.1 失败模式

| 场景 | 行为 | 恢复 |
|---|---|---|
| `harness/dsh-source/` 不存在 | `dsh-agent-service.cjs` 启动失败 → `_dshPort=0` | 编辑器继续启动，AgentPanel 显示"DSH 未就绪" |
| `@deepseek-ai/dsh-sdk-client` 未安装 | 同上 | 装包后重启 |
| `DEEPSEEK_API_KEY` 未设置 | DSH runtime 启动后首次请求时报 `MISSING_CREDENTIAL` 或 `AUTH` 401 | 配 `userData/.env` 或 env var |
| DSH runtime 启动后立即崩溃 | `subscribe` 抛 `TransportClosedError` | 目前 DSHAgentService 不会自动重启（M2 计划） |
| 引擎 9877 端口被占用 | MCP 自动找下一个空闲端口（`findFreePort`） | 无需人工介入 |
| 引擎 HTTP 调用超时 | DSH tool 返回错误，DSH runtime 推 `agent.error` | AgentPanel 显示错误信息 |
| AgentPanel 已开但 DSH 未就绪 | `connect()` 抛错，状态 `error` | `RECONNECT_INTERVAL=5000` 后重试 |
| `editor/dsh-agent-service.cjs` 用 ESM `import`（旧版本） | require 阶段直接抛 SyntaxError | 已改为 CJS `.cjs`（本次改动） |
| `harness/profile/profiles/demostudio/` 不存在 | `ensureProfile()` 自动创建（含 package.json + 软链接） | 首次启动时自动建好 |

### 3.2 安全约束

| 约束 | 实现 |
|---|---|
| 路径逃逸（dsh-plugin fileBridge） | `editor/dsh-agent-service.cjs:createFileBridge` 中 `path.resolve + path.startsWith(workspaceRoot)` 检查 |
| 路径逃逸（编辑器写 JSON） | `electron/main.ts` `write-json-file` IPC + `path.resolve` + `path.relative` 双重检查 |
| 工具 guard 策略 | `harness/dsh-plugin/src/guards.ts` 暴露 `guardPolicy: Record<string, 'allow'\|'deny'\|'ask'>` |
| DSH 子进程权限 | 子进程是 `process.execPath` + `ELECTRON_RUN_AS_NODE=1`，仍受 Electron 沙箱影响（M2 计划加 `--no-sandbox`） |
| SSE 客户端限制 | 引擎 SSE 仅绑 `127.0.0.1` |
| API Key 传递 | 通过 env var `DEEPSEEK_API_KEY`，不入资产文件 |

### 3.3 关键不变量

1. **DSH 端口永远由 main.ts 单点管理** —— 不允许 renderer 直接连任意端口
2. **DSH 反向调引擎必须用 `DSH_ENGINE_BASE_URL`**，不用 `localhost:9877`（多实例）
3. **`session.run()` 是阻塞式的**：同一时刻只允许一个活跃 session（多 session 并发未实现）
4. **DSH runtime 子进程由 SDK 持有** —— 业务层不直接 spawn / kill
5. **`editor/dsh-agent-service.cjs` 是 SDK 客户端**，不是 DSH runtime 本身
6. **`globalThis.__dshEngineCtx` 由 dsh-agent-service.cjs 单点写入** —— dsh-plugin 只读
7. **dsh-plugin 入口不直接 `ctx.<任意字段>`** —— Cordis Proxy 对未声明字段抛 `cannot get property X without inject`

### 3.4 已知 TODO（按优先级）

#### P0（不阻断但阻塞端到端）

- [ ] **headless bundle 服务对齐**：当前 dsh-plugin 的 `inject: [tools, effect, session, on]` 中 `tools` 在 base bundle 已注册为 `@deepseek-ai/dsh-tools`，但 `effect`/`session`/`on` 不是 Cordis 服务的标准导出。需要：
  - 选项 A：把 dsh-plugin 改为不声明 `inject`，依赖 `ctx.tools`/`ctx.effect` 这些「Cordis 内置字段」（但 Cordis 内置字段也是 Proxy 拦截的）
  - 选项 B：把 dsh-plugin 改为 ESM（`@deepseek-ai/cordis-plugin-loader` 通过 `await import()` 加载 ESM），并让 `apply` 不接收 ctx（而是通过 `effect()` 回调拿 ctx）
  - 选项 C：把 dsh-plugin 改造为 `@deepseek-ai/dsh-tools` 的扩展（继承其 `tools` 服务的实现），注册为同一 id 的 plugin override
- [ ] **`sdk-jsonrpc-server` 等待 `agents` 服务**：base bundle 已 mount `@deepseek-ai/dsh-agent`，但 `agents` 是 `ctx.agents`（不是普通 service id）。需要确认 loader 对 `inject: [agents]` 的解析规则
- [ ] **CJS → ESM interop**：`dsh-plugin/dist/index.js` 是 CJS（`Object.defineProperty(exports, "__esModule", ...)`），`@deepseek-ai/cordis-plugin-loader` 通过 `await import()` 加载时需要正确的 named exports。建议把 dsh-plugin 编译目标改为 `module: ES2022`

#### P1（已实现但需要验证）

- [ ] DSH runtime 崩溃自动重启（目前一旦崩就退出，需手动重启编辑器）
- [ ] 多 session 并发（当前 sessionId 序列仅用于日志追踪）
- [ ] `message.delta` 与 `toolCall` 事件关联（同一推理流）
- [ ] DSH 更新检查走 npm registry（之前 `updater.ts` 在 vscode-ext 实现，主进程需要镜像）
- [ ] 把 `engineBridge` 实现从 `engineBridge.ts`（vscode-ext）抽到共享包给 dsh-plugin 和 electron-main 都用

#### P2（架构优化）

- [ ] 移除对 `globalThis.__dshEngineCtx` 的依赖，改用 Cordis `intercept` 配置注入（更类型安全）
- [ ] 把 `dsh-agent-service.cjs` 的 profile 自举逻辑抽到独立模块 `editor/dsh-profile-bootstrap.cjs`
- [ ] DSH 子进程 stdout 复用：当前 SDK 独占 stdout，DSH runtime 日志走 stderr（Loader warn 等仍可见）

---

## 4. 文件清单

| 文件 | 角色 |
|---|---|
| `electron/main.ts` | 拉起 DSH 子进程 + 提供 `/api/dsh-status` + 转发 `/api/chat` |
| `electron/preload.ts` | 暴露 `electronAPI.dshStatus()` |
| `editor/dsh-agent-service.cjs` | DSH runtime SDK 客户端 + HTTP 代理（SSE 流式），含 EngineBridge/FileBridge/profile 自举 |
| `harness/dsh-plugin/` | DSH 工具包（已编译到 dist/） |
| `harness/dsh-plugin/cordis.patch.yml` | dsh-plugin 作为 bundle 的 loader patch（system.persona override） |
| `harness/dsh-plugin/src/engineContext.ts` | 双源 engineContext（ctx 注入 + globalThis fallback） |
| `harness/dsh-plugin/src/index.ts` | 插件入口（不读 ctx 任意字段） |
| `harness/profile/cordis.patch.yml` | profile 用户层 patch（system-prompt + 关闭 logger + 插入 sdk-jsonrpc-server + 插入 dsh-engine-tools） |
| `harness/profile/profiles/demostudio/package.json` | 自动生成的 profile manifest（`dsh.profile.bundles`） |
| `harness/profile/profiles/demostudio/node_modules/@demostudio/dsh-engine-tools` | 软链接到 `harness/dsh-plugin/` |
| `harness/profile/profiles/demostudio/node_modules/@deepseek-ai/dsh-sdk-jsonrpc-server` | 软链接到 `harness/dsh-source/packages/sdk/server/` |
| `src/editor/AgentService.ts` | Renderer 侧 DSH 客户端，SSE 消费 |
| `src/types/electron.d.ts` | 类型补充 `dshStatus` API |
| `harness/dsh-source/` | DSH runtime 源码（已克隆） |

---

## 5. 关键变更日志（本次任务）

### 5.1 `editor/dsh-agent-service.js` → `editor/dsh-agent-service.cjs`

- **问题**：原 `.js` 文件用 ESM `import` 语法，但被 Electron 主进程以 `require()` 方式加载，运行时抛 `SyntaxError: Cannot use import statement outside a module`
- **解决**：改后缀为 `.cjs`，所有 `import` 改 `require`，所有 `interface` 改 JSDoc 注释
- **新增**：
  - `createEngineBridge(enginePort)`：HTTP fetch 转发到编辑器 `/api/command`
  - `createFileBridge(workspaceRoot)`：直接读写 JSON 文件（带路径安全检查）
  - `ensureProfile(workspaceRoot)`：自动创建 `harness/profile/profiles/demostudio/`，含 package.json + node_modules 软链接
  - 入口自启：`require.main === module` 时自动 `service.start()`（spawn 模式下被 Electron 拉起后立即启动）
- **新增 env**：
  - `DSH_WORKSPACE_ROOT`：workspace 根（由 main.ts 传入）
  - `DSH_ENGINE_PORT`：编辑器 HTTP 端口
  - `DSH_HOME=harness/profile`：让 DSH CLI 找到我们的 profile

### 5.2 `electron/main.ts`

- **修复**：`show-message-box` IPC 后有一坨孤立代码（`const win = BrowserWindow.getFocusedWindow()` 没有归属函数），阻塞 vite/esbuild 构建。已重构为新的 `toggle-dev-tools` IPC handler
- **改动**：`DSH_AGENT_SERVICE_PATH` 从 `dsh-agent-service.js` → `dsh-agent-service.cjs`
- **新增**：`spawn` env 增加 `DSH_WORKSPACE_ROOT = path.join(__dirname, '..')`

### 5.3 `harness/dsh-plugin/`

- `package.json`：新增 `dsh.bundle.patch = "./cordis.patch.yml"`（让 DSH CLI 把它识别为合法 bundle）
- `src/engineContext.ts`：新增 `globalThis.__dshEngineCtx` fallback（DSH Agent 注入的全局对象）
- `src/index.ts`：重写为不直接读 `ctx.engineBridge`/`ctx.fileBridge`（避免触发 Cordis Proxy 抛 `cannot get property X without inject`）；改为把 ctx 通过 `wrapTool` 透传到 tool.execute 调用
- `cordis.patch.yml`：新增（声明 bundle 是 loader patch layer，覆盖 `system.persona`）

### 5.4 `harness/profile/cordis.patch.yml`

- **格式修正**：原内容是 `inject:` mapping 格式，DSH loader 要求 top-level YAML array；已改为 loader patch entries 格式
- **新增 entries**：
  - `- id: logger / disabled: true`（stdout 预留给 JSON-RPC 协议帧）
  - `- insert: sdk-jsonrpc-server`
  - `- insert: dsh-engine-tools / inject: [tools, effect, session, on]`

### 5.5 阻塞项：headless bundle 服务对齐

经多轮排查，发现当前实现还有以下架构层缺口（详见 §3.4 P0）：

1. **dsh-plugin 的 `inject` 字段值不是 Cordis 标准服务 id**：`tools` 是 `@deepseek-ai/dsh-tools` 提供的服务但只在 web/headless 通过 `id: tools` 暴露；`effect`/`session`/`on` 不是独立服务
2. **dsh-plugin 是 CJS**：`@deepseek-ai/cordis-plugin-loader` 通过 `await import()` 加载，理论上支持 CJS 但 named export 推断不稳定；建议改为 ESM
3. **sdk-jsonrpc-server 等待 `agents`**：base bundle mount 了 `@deepseek-ai/dsh-agent`，但 `agents` 是 ctx 上的 method-like service（`ctx.agents.create()`）而不是顶层 service id

要达成"端到端 chat → inspect_scene"流程，需要先解决上述三项。本次的代码改动已为这些修复铺平道路（profile 自举 / ctx 安全访问 / bundle 注册）。