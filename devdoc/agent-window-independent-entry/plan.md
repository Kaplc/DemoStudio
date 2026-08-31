# 需求方案：Agent 窗口独立入口（agent.html）

> 状态：待排期 ｜ 提出日期：2026-09-01 ｜ 类型：架构优化（体验/性能，非正确性修复）
>
> 前置关联：本方案落地前，HMR 触发历史重放的重复渲染 bug 已修复
> （fold 的 finish 边界误提交 + seq 基线原子推进 + seedPendingTurn 续写，
> 见 `e2e/agent-session-resume.e2e.spec.ts`）。本方案解决的是刷新本身。

## 1. 背景

Agent 编辑游戏文件后，agent 独立窗口（`?agentWindow=1`）会整页刷新：
对话视图重建、live 状态闪断。曾由此暴露历史重放重复渲染 bug（已修），
但刷新本身仍然存在，属于体验/性能问题。

## 2. 根因（已核实）

### 2.1 单入口 + 静态 import → 模块图不分家

`App.tsx` 在根部静态 import 编辑器与引擎，`?agentWindow=1` 分支只是**运行时**
早期返回，模块图层面 agent 窗口仍然加载并执行整张图。HMR 的失效单位是
HTML 入口——Vite 无法区分"哪个窗口"加载了它，引擎文件一改，两个窗口一起
整页刷新。

### 2.2 agent 面板依赖图的三处"漏点"

| 位置 | 问题 | 影响 |
|---|---|---|
| `src/components/PluginControlCenter.tsx:8` | `import { logger } from '../engine'` barrel 导入 | 整个引擎 index 进入 agent 图 |
| `src/stores/editorStore.ts:2` | 顶层 `import { registerProjectAssets } from '../projects/registry'` | 项目注册表连带全部游戏资产/gameplay 脚本；`AgentPanel.tsx:215` 使用该 store |
| `src/engine/Logger.ts:91` | `isAgentWindow` 靠 `?agentWindow=1` 判定 | 拆入口后判定方式需兼容（建议保留 search 参数） |

对照：`InputBox.tsx` / `SkillManager.tsx` 已是正确的直连姿势
（`from '../../engine/Logger'`）。

### 2.3 Electron 侧挂载点

- `electron/main.ts:2095`：dev → `loadURL(\`${VITE_URL}?agentWindow=1\`)`
- `electron/main.ts:2097`：prod → `loadFile('dist/index.html', { search: 'agentWindow=1' })`

## 3. 目标

1. agent 编辑引擎/项目文件时，agent 窗口**不再刷新**（HMR 分窗隔离）；
   反向同理，改 AgentPanel 不再波及主编辑器窗口。
2. agent 窗口不再下载/执行整引擎 bundle（dev 冷载 + 生产首屏体积显著下降）。
3. AgentPanel 自身文件的 HMR 行为保持不变（热替换 + 会话恢复，已有正确性保障）。

## 4. 方案设计（两步，缺一不可）

### Step 1：依赖图清理（独立入口的前提）

若只拆 html 而不清图，`agent.html` 的图里仍含引擎，引擎改动照样传播，
等于白拆。

- [ ] `PluginControlCenter.tsx`：barrel 改直连 `import { logger } from '../engine/Logger'`
- [ ] `editorStore.ts`：registry 顶层副作用惰性化（action 内动态 `import()`）
      或拆出 agent 窗口用的瘦 store（唯一需要设计决策的点，倾向惰性化）
- [ ] 全图审计：以 `agent.html` 入口跑 Vite 模块列表，确认无 `engine/index`、
      `projects/registry`、编辑器重组件；对照主入口图确认无回归

### Step 2：独立入口 `agent.html`

- [ ] 根目录新增 `agent.html` + `src/agent-main.ts`（只挂载 AgentPanel）
- [ ] 复用共享 setup 模块（全局样式 / `--dsw-*` 主题变量 / 错误兜底），
      防双入口漂移
- [ ] `vite.config.ts`：`build.rollupOptions.input` 增加 `agent.html`
- [ ] `electron/main.ts`：dev `loadURL('…/agent.html')`、prod
      `loadFile('dist/agent.html')`；preload 不动（按窗口挂载，与入口无关）
- [ ] `App.tsx` 移除 `?agentWindow=1` 分支；`Logger.isAgentWindow` 保留
      search 参数判定做向后兼容，新增路径判定
- [ ] 兼容旧 URL：`/?agentWindow=1` 保留可用（参数判定兜底）或重定向到
      `agent.html`

## 5. 收益

| 维度 | 说明 |
|---|---|
| 开发体验 | agent 改引擎/项目文件不再闪断 agent 窗口；反向（改面板不闪主编辑器）同样成立 |
| 加载性能 | agent 窗口不再下载执行整引擎 bundle；生产单 bundle → 分入口，agent 首屏体积小一个量级 |
| dev 开销 | Vite 按需转换集合变小，agent 窗口打开更快更稳 |
| 架构 | agent UI 与引擎的边界显式化，防未来反向污染（barrel 复发可在 CI 卡口拦） |

## 6. 成本与风险

| 项 | 说明 | 等级 |
|---|---|---|
| editorStore 解耦 | registry 惰性化的触发时机变化需验证项目启动链路 | 中（唯一设计点） |
| 双入口漂移 | 全局 provider/样式只加主入口的遗忘风险 | 低（共享 setup 模块 + 测试用例约束） |
| 构建产物变化 | dist 目录多出 agent.html，Electron 打包路径检查 | 低 |
| URL 变更 | e2e / 脚本 / 文档中 `/?agentWindow=1` 需同步 | 低 |

工作量估计：半天。风险整体低，除 editorStore 解耦外均为机械改动。

## 7. 落地顺序与验收

1. **Step 1 图清理**（独立可验证：引擎文件改动，agent 窗口在单入口下仍会
   刷新——此项不解决分窗，只减小图；验收以模块列表审计为准）
2. **Step 2 独立入口**（验收：HMR 分窗隔离 + 双窗口功能回归 + 体积对比）
3. e2e URL、Electron 路径、样式挂载收尾

详细验收标准见同目录 `test-cases.md`。
