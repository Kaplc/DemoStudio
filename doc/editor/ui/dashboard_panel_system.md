# 页面状态 Live Dashboard（DashboardPanel）

> **一句话定位**：状态栏常驻的浮动面板，把「编辑器页面状态 + 运行中游戏的 HUD/Scene 树」实时推给 AI 和开发者，替代"盲点控件→失败→再猜"的调试循环。
>
> **什么时候会用到你**：AI 通过 MCP 操作编辑器前想确认目标控件/节点存在；调试游戏时想看当前 HUD 树和场景 Actor 树；排查「页面卡死/控制台报错/游戏没起来」。
>
> 代码位置：`src/components/DashboardPanel.tsx`、`src/styles/editor.css`（dashboard-* / status-dashboard 类）

---

## 1. 先记住这几个文件

| 文件 | 一句话职责 | 你要改它的场景 |
|---|---|---|
| [DashboardPanel.tsx](../../../src/components/DashboardPanel.tsx) | 面板组件本体：入口按钮 + 四个信息区 + 2s 轮询 | 加/改信息区、调轮询频率、改树展示 |
| [SelectionManager.ts](../../../src/editor/SelectionManager.ts) | `getRunningWorld()` 的定义处——HUD/Scene 数据的唯一直通口 | 想从面板读更多运行中 World 数据 |
| [editor.css](../../../src/styles/editor.css) | `status-dashboard`（入口）与 `dashboard-*`（面板）全部样式 | 调样式、加新信息区的样式类 |
| [App.tsx](../../../src/App.tsx) / [StatusBar.tsx](../../../src/components/StatusBar.tsx) | 面板挂载点（App 尾部与 StatusBar 各挂一次，入口按钮同一时刻只有一份可见） | 改布局挂载结构 |

**关键心智模型**：面板**只读不写**。它每 2s 从页面 DOM 和运行中 World 拉快照，不向任何引擎对象写状态，也不与 MCP 命令通道交互——AI 要执行操作仍走 MCP 工具，面板只是"操作前的眼睛"。

---

## 2. 数据流：从引擎对象到面板渲染

### 2.1 挂载与轮询开关

面板入口挂在状态栏（[StatusBar.tsx:86](../../../src/components/StatusBar.tsx)），点击切换 `open` state：

```tsx
const [open, setOpen] = useState(false)
...
useEffect(() => {
  if (!open) {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    return
  }
  void collectStatus() // 展开时立即采集一次
  intervalRef.current = setInterval(() => void collectStatus(), POLL_INTERVAL_MS)
  return () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }
}, [open, collectStatus])
```

收起即停轮询——面板不展开时零开销，这是刻意设计：AI 会话中大部分时间面板是收起的，常驻轮询白白消耗。

### 2.2 采集：一次 collectStatus 读两界

`collectStatus`（[DashboardPanel.tsx:113](../../../src/components/DashboardPanel.tsx)）每次执行：

```ts
const consoleArr = ((window as any).__ai_console || []) as ConsoleLogEntry[]
let gameRunning = false
const hud: TreeNode[] = []
const scene: TreeNode[] = []
const world = getRunningWorld()
if (world) {
  gameRunning = true
  // HUD 树：只取无 parent 的顶层 UI Actor（与 MCP get_ui_outline 一致）
  const uiActors = world.ui.getAllUIActors() as any[]
  uiActors.filter((a) => !a.parent).forEach((a) => hud.push(buildTreeNode(a)))
  // Scene 树：全部根 Actor（与 MCP get_scene_outline 一致）
  ;(world.actorMgr.GetAllActors() as any[]).forEach((a) => scene.push(buildTreeNode(a)))
}
```

三个数据源，前一个是 DOM 层、后两个是引擎层：

| 信息区 | 数据源 | 采集方式 |
|---|---|---|
| Page | `location` / `document` / `window` | 直接读全局对象 |
| Console | `window.__ai_console` | 控制台收集器数组（取最近 10 条） |
| HUD | `world.ui.getAllUIActors()` | 运行中游戏 UI 树 |
| Scene | `world.actorMgr.GetAllActors()` | 运行中游戏 Actor 树 |

HUD/Scene 与 MCP 的 `get_ui_outline` / `get_scene_outline`（[EditorInitializer.ts:701](../../../src/editor/EditorInitializer.ts)）**同源同构**：同样的"只取无 parent 顶层 UI Actor"、同样的字段（name/type/active/text/children）。区别只在呈现——MCP 返回 JSON，面板渲染成可折叠树。所以 AI 在面板看到什么，`get_ui_outline` 就能拿到什么。

`getRunningWorld()`（[SelectionManager.ts:256](../../../src/editor/SelectionManager.ts)）返回 `_runningWorld`，游戏未运行时为 `null`——面板据此显示"（游戏未运行）"空态而不是报错。

### 2.3 树节点构建：鸭子类型读文本

```ts
function readActorText(actor: any): string | undefined {
  for (const comp of actor.getAllComponents() as any[]) {
    const t = (comp as any).text
    if (typeof t === 'string') return t
  }
  return undefined
}
```

刻意不 import `UITextComponent` 具体类，而是鸭子类型读组件的 `text` 字段——面板是纯展示组件，引组件类会把它拖进引擎类型依赖，且 `instanceof` 判定在 HMR 下会因双模块实例失效。文本展示在树行末尾（蓝色），AI 一眼能看到按钮/标签上的字。

---

## 3. 树渲染与防拖垮

兵潮场景 Actor 可能上百，全量展开会把 2s 轮询变成渲染灾难。两道保险：

1. **行数上限**：`MAX_TREE_LINES = 300`，超限截断并在树尾提示"（已截断，超过 300 行）"
2. **折叠状态跨轮询稳定**：折叠 key 用 `路径索引+名字`（如 `0:HUD/1:FishMainMenu`），而不是数组下标——轮询重建树对象后，React 按 key 对比，折叠状态不丢

```tsx
{node.children.forEach((c, i) => rows.push(...render(c, `${key}/${i}:${c.name}`, depth + 1)))}
```

每行展示：名称（失活节点划线置灰）+ 类型 + 文本内容，点击前箭头折叠/展开。

---

## 4. 关键方法速查

| 方法 | 位置 | 干什么 | 注意 |
|---|---|---|---|
| `DashboardPanel` | [DashboardPanel.tsx:88](../../../src/components/DashboardPanel.tsx) | 组件入口：入口按钮 + 浮动面板 | 挂载在 StatusBar 与 App 两处，入口视觉只有一份 |
| `collectStatus` | [DashboardPanel.tsx:113](../../../src/components/DashboardPanel.tsx) | 采集一次四区快照 | 只在 open 时被轮询调用 |
| `buildTreeNode` | [DashboardPanel.tsx:75](../../../src/components/DashboardPanel.tsx) | Actor → TreeNode 递归构建 | HUD/Scene 树通用 |
| `readActorText` | [DashboardPanel.tsx:66](../../../src/components/DashboardPanel.tsx) | 鸭子类型读组件 text | 不 import UITextComponent，防 HMR 双实例 |
| `TreeView` | [DashboardPanel.tsx:270](../../../src/components/DashboardPanel.tsx) | 树渲染（折叠/展开/截断） | key 含名字，跨轮询稳定 |
| `getRunningWorld` | [SelectionManager.ts:256](../../../src/editor/SelectionManager.ts) | 取运行中 World（面板数据直通口） | 未运行返回 null，不抛错 |

---

## 5. 流程影响：牵动哪些功能

### 上游：谁驱动它

| 上游 | 怎么驱动 | 相关文档 |
|---|---|---|
| 用户点击状态栏入口 | `setOpen` 切换轮询启停 | [ui_components_system.md](./ui_components_system.md) |
| 游戏启动（launchGame） | `World` 创建 → `_runningWorld` 有值 → HUD/Scene 有数据 | [../core/viewport_system.md](../core/viewport_system.md) |
| 控制台日志收集器 | 各处 `logger`/console 桥接写 `__ai_console` | [../integration/mcp_integration.md](../integration/mcp_integration.md) |

### 下游：它波及谁

| 下游功能 | 波及点 | 相关文档 |
|---|---|---|
| AI 测试流程（MCP） | 操作前先看面板确认控件/节点存在，降低盲操作失败率 | [../integration/mcp_integration.md](../integration/mcp_integration.md) |
| 编辑器样式体系 | `dashboard-*` 类与 `errpanel` / `codelint-panel` 同风格 | [ui_components_system.md](./ui_components_system.md) |

---

## 6. 踩坑清单（都是真踩过的）

**1. 面板浮层类名不是 `status-dashboard-overlay`** —— 面板本体的类是 `.dashboard-panel`，`.status-dashboard` 只是状态栏入口按钮。AI 用 CDP 查询时按后者的直觉猜类名会扑空。规则：查面板状态用 `.dashboard-panel` 的存在性，别猜。

**2. 点击入口返回成功但面板没开** —— 上一轮点击已把面板打开、HMR 或重渲染又把 state 重置，时序上"点了但没开"。规则：验证面板状态永远以 `document.querySelector('.dashboard-panel')` 的实时结果为准，不以单次点击的返回值为准。

**3. 不要把 DOM 选择器当"调试数据"** —— 初版 Monitors 区监控 CSS 选择器、Debug Bridge 区列 `__xxx` 全局变量，实测对游戏调试无用（AI 要的是 HUD 树和场景对象，不是 DOM）。规则：给 AI 的调试信息应该与引擎数据同源（`getRunningWorld`），而不是浏览器 DOM 层的间接信息。

**4. MCP 截图返回可能超长被落盘** —— `cdp_screenshot` 整页/大面板截图的 base64 超过工具结果上限会被写成 txt 缓存文件。规则：小元素用 `selector` 截元素级截图；结果落盘时用脚本提取 `"data"` 字段 base64 落成 png 再看。

---

## 7. 边界条件

| 条件 | 行为 | 怎么应对 |
|---|---|---|
| 游戏未运行 | HUD/Scene 区显示"（游戏未运行）"，Page/Console 正常 | 无需处理，属正常态 |
| 游戏运行中无 UI Actor | HUD 区显示"（无 UI Actor）" | 检查 GameMode.HUDClass 是否配置且 SpawnPlayer 出了 controller（无玩家即无 HUD，对齐 UE） |
| 树超 300 行 | 截断 + 尾部提示 | 先折叠再定位目标子树，或临时调大 `MAX_TREE_LINES` |
| `world.ui` 抛异常 | 整个 collectStatus 进 catch，面板显示错误行 | 看错误信息定位引擎侧问题 |
| 面板收起 | 轮询停止，数据冻结在收起时刻 | 重新展开会立即采集一次 |
| localStorage 不可用 | 早版本 Monitors 持久化已随功能删除，现无 localStorage 依赖 | 无 |
