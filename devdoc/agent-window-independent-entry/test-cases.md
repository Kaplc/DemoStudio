# 测试用例：Agent 窗口独立入口（agent.html）

> 对应方案：同目录 `plan.md` ｜ 用例总数：18 ｜ 自动化优先级标注：P0 必须自动化 / P1 建议自动化 / P2 手工
>
> 涉及 URL 变更：旧 `/?agentWindow=1` → 新 `/agent.html`
> 涉及修复前置：HMR 历史重放重复渲染已修（`e2e/agent-session-resume.e2e.spec.ts`）

## A. 依赖图清理（Step 1）

### TC-A1 引擎 barrel 漏点移除 【P0】

- **前置**：`PluginControlCenter.tsx` 改为 `import { logger } from '../engine/Logger'`
- **步骤**：
  1. 全仓 grep `from '../engine'` / `from '../../engine'`（精确 barrel 路径），agent 图内组件应零命中
  2. `npx tsc --noEmit` 通过
- **预期**：agent 图内组件无 engine barrel 导入；插件控制中心打开、插件列表/启停功能正常

### TC-A2 editorStore 的 registry 副作用解耦 【P0】

- **前置**：`editorStore.ts` 不再顶层 `import { registerProjectAssets } from '../projects/registry'`（惰性动态 import 或拆瘦 store）
- **步骤**：
  1. 主编辑器：选择项目 → 启动游戏 → 停止游戏，反复两次
  2. 控制台确认 `registerProjectAssets` 在项目启动时仍被调用（资产加载日志）
  3. agent 窗口功能正常（面板读写的 editorStore 字段不受影响）
- **预期**：游戏资产注册时机不回归；agent 图中不再含 `projects/registry` 及其连带 gameplay 模块

### TC-A3 agent 入口模块图审计 【P0】

- **步骤**（自动化脚本，落 `e2e/agent-entry-graph.e2e.spec.ts`）：
  1. dev 模式请求 `agent.html`，收集 Vite 模块图（`import.meta.glob` 不可用时用页面 `performance.getEntriesByType('resource')` 或构建产物分析）
  2. 断言：模块列表不含 `/src/engine/index`、`/src/projects/registry`、编辑器重组件（Editor、视口等）
  3. 断言：包含 AgentPanel、AgentService、agent/* 组件
- **预期**：agent 图 = 面板闭包，无引擎/项目/编辑器重模块
- **备注**：构建产物分析法更严格——比较 `dist/agent.html` 关联 chunk 总体积 < 主入口体积的 1/3（阈值可调）

### TC-A4 主编辑器功能回归（store 解耦后）【P1】

- **步骤**：项目选择/启动/停止、控制台输出、资产浏览器打开
- **预期**：全部正常，`tsc` 与现有 e2e 全绿

## B. 入口与路由（Step 2）

### TC-B1 agent.html 直开渲染 【P0，自动化】

- **步骤**（Playwright）：
  1. `page.goto('/agent.html')`
  2. 断言 `.agent-panel` 存在且全屏（`.agent-window-root` 布局）
  3. 断言编辑器未初始化：页面无编辑器 DOM（`.editor-*` 根节点不存在）、引擎未启动（`GameInstance.current` 为空）
- **预期**：纯面板窗口，引擎零加载

### TC-B2 旧 URL 兼容 【P1，自动化】

- **步骤**：`page.goto('/?agentWindow=1')`
- **预期**：按方案选型——参数判定兜底则仍渲染面板；重定向选型则 302/客户端跳转到 `agent.html` 后渲染面板。两者之一成立且行为与文档一致

### TC-B3 主入口移除 agentWindow 分支 【P2】

- **步骤**：`page.goto('/')`（无参数）+ 代码检查 `App.tsx`
- **预期**：主编辑器正常启动；`App.tsx` 无 agentWindow 早期返回分支；全仓无残留的旧参数导航（除 Logger 兼容判定）

## C. HMR 分窗隔离（核心验收）

### TC-C1 引擎文件改动 → agent 窗口不刷新 【P0，自动化】

- **步骤**（Playwright 双页面 + 文件 touch）：
  1. 打开 `/agent.html`（窗口 A）与 `/`（窗口 B）
  2. A 页面挂 `window.__hmrMarker = 1`；监听 A 的 `page.reload`/`framenavigated`
  3. 修改一个引擎模块（如向 `src/engine/Logger.ts` 追加注释后保存）
  4. 等待 3s，检查 A：`__hmrMarker` 仍在（未整页刷新）、无 `framenavigated`；B：正常热更
- **预期**：agent 窗口零刷新，主编辑器正常热更
- **备注**：这是本需求的验收锚点；依赖 TC-A1/A2/A3 全部通过

### TC-C2 项目/游戏文件改动 → agent 窗口不刷新 【P0，自动化】

- **步骤**：同 TC-C1，改为修改 `src/projects/fish/` 下某脚本
- **预期**：同 TC-C1

### TC-C3 agent 面板自身文件改动 → HMR 生效且会话无重复 【P0，自动化】

- **步骤**：
  1. agent 窗口连接 DSH 并有历史消息
  2. 修改 `src/components/AgentPanel.tsx`（追加注释）保存
  3. 等待热更完成后断言：面板重新渲染；消息列表无相邻同内容 assistant 对（重复渲染回归哨兵，对照 `agent-session-resume.e2e.spec.ts` 的判定逻辑）
- **预期**：面板热替换、会话恢复正确、无重复消息

### TC-C4 反向隔离：改面板不闪主编辑器 【P1】

- **步骤**：同 TC-C1 方向互换（改 `AgentPanel.tsx`，观察 `/` 页面）
- **预期**：主编辑器窗口不整页刷新（agent 图与主图已分窗）

### TC-C5 运行中回合的 HMR 续写无损 【P1】

- **步骤**：agent 回合流式输出中触发一次面板文件 HMR
- **预期**：恢复后已流出文本完整显示（pendingPartial 回放），后续增量接在同一段上，flush 后单条完整消息（seedPendingTurn 语义）

## D. Electron 集成

### TC-D1 dev 模式 agent 独立窗口 【P0】

- **步骤**：`npm run dev` + Electron 启动，触发打开 agent 独立窗口（主进程 `_dshWebuiWindow`）
- **预期**：窗口加载 `http://localhost:5173/agent.html`，面板正常，DSH 自动连接成功

### TC-D2 生产构建 agent 窗口 【P0】

- **步骤**：`vite build` → Electron 加载 `dist/agent.html`
- **预期**：面板正常、样式完整、IPC（`dshRpc`/`dshRespond`/`onDshMuxFrame`）工作；发消息收流式回复全链路通

### TC-D3 preload IPC 不回归 【P0】

- **步骤**：agent 窗口内验证 `window.electronAPI.dshRpc('session.list')` 有返回；mux 帧到达（发一条消息观察流式）
- **预期**：preload 按窗口挂载，与入口无关，全功能可用

## E. 样式与主题

### TC-E1 agent 入口全局样式挂载 【P0，自动化】

- **步骤**：`/agent.html` 打开后 `getComputedStyle` 断言：
  1. 面板背景/文字色引用的 `--dsw-*` 变量有值（非空、非 initial）
  2. `editor.css` 中面板类（如 `.agent-panel__messages`）生效（有非零布局尺寸）
- **预期**：无裸奔样式

### TC-E2 共享样式改动双入口同步 【P2】

- **步骤**：修改共享 css 中面板样式（临时），观察两个窗口
- **预期**：agent 窗口热更生效；还原。此用例约束双入口漂移

## F. 回归与体积

### TC-F1 会话恢复 e2e 迁移后全过 【P0】

- **步骤**：`e2e/agent-session-resume.e2e.spec.ts` 的 URL 改为 `/agent.html` 后全量运行
- **预期**：9/9 通过

### TC-F2 ClashMaster / 主编辑器 e2e 回归 【P0】

- **步骤**：`e2e/clashmaster.e2e.spec.ts` 全量运行（注意其中 1 个既有失败与本病无关，见 2026-09-01 验证记录）
- **预期**：与基线一致，无新增失败

### TC-F3 构建体积对比 【P1】

- **步骤**：`vite build` 后统计 agent.html 关联 chunk 总体积 vs 主入口总体积
- **预期**：agent 入口 < 主入口 1/3（经验阈值；记录进本文件作为基线）

### TC-F4 双窗口并发长会话冒烟 【P2】

- **步骤**：主编辑器 + agent 窗口同时开着，agent 执行一轮含文件修改的真实任务（≥5 次文件编辑触发 HMR）
- **预期**：全程 agent 窗口零刷新、消息流无重复、无丢失；主编辑器正常热更

## 执行顺序建议

1. Step 1 完成 → 跑 TC-A1~A4
2. Step 2 完成 → 跑 TC-B1~B3、TC-E1
3. 核心验收 → TC-C1~C5（C1 是锚点）
4. 集成 → TC-D1~D3、TC-E2、TC-F1~F4
