# Playwright 命令速查 + 踩坑（编辑器通用）

> DemoStudio 编辑器浏览器端调试（VS Code 集成浏览器操作 `http://localhost:5173/`）的**纯命令速查 + 踩坑**。
> 只记录编辑器通用操作，不涉及具体项目/资产。详细方法论见 [`playwright_testing.md`](./playwright_testing.md)。

## 1. 内置浏览器工具

| 工具 | 用途 | 参数 |
|---|---|---|
| `open_browser_page` | 打开页面 | `url`、`forceNew` |
| `click_element` | 点击 | `pageId` + `ref`/`selector` + `element`；`dblClick: true`；`button: 'right'` |
| `read_page` | 页面快照 | `pageId`（大快照写临时文件，用 read_file 读） |
| `screenshot_page` | 截图 | `pageId`、`selector` |
| `type_in_page` | 输入 | `text` 或 `key: 'Enter'` |
| `hover_element` | 悬停 | `ref`/`selector` |
| `drag_element` | 拖拽 A→B | `fromRef` + `toRef` |
| `navigate_page` | 导航/刷新 | `type: 'reload'/'url'/...` |
| `run_playwright_code` | 任意 Playwright 代码 | `pageId` + `code`；长任务返回 `deferredResultId` 需二次调用（无 code）取结果 |

> ⚠️ 页面 `visibilityState` 为 `hidden` 时（集成浏览器常见），`click_element` 等元素稳定**必超时** → 全部改用 `run_playwright_code` + `dispatchEvent`（见 §2.3）。

## 2. run_playwright_code 常用片段

### 2.1 查询元素

```js
page.getByText('工程名/节点名').first()          // 按文本
page.getByRole('button', { name: 'Launch' })     // 按角色（按钮/页签等）
page.locator('canvas').nth(1)                    // 按 CSS（第 N 个 canvas）
page.locator('button').filter({ hasText: '保存' })
```

### 2.2 读取 DOM / 断言

```js
await page.evaluate(() => document.body.innerText)   // 整页文本（最常用断言）
await page.evaluate(() => Array.from(document.querySelectorAll('canvas'))
  .map(c => { const r = c.getBoundingClientRect(); return { w: r.width, h: r.height, x: r.x, y: r.y } }))
```

### 2.3 交互（hidden 页面必须 dispatchEvent）

```js
await el.dispatchEvent('click', { bubbles: true })       // 单击
await el.dispatchEvent('dblclick', { bubbles: true })    // 双击（打开工程卡片/资产行）
await el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: x, clientY: y }))
```

### 2.4 鼠标序列（真实坐标拖拽）

```js
const box = await page.locator('canvas').nth(1).boundingBox()   // 注意是视口坐标
await page.mouse.move(box.x + 80, box.y + box.height / 2)
await page.mouse.down()
await page.mouse.move(box.x + 150, box.y + box.height / 2, { steps: 10 })
await page.mouse.up()
await page.waitForTimeout(300)
```

### 2.5 等待 / 导航

```js
await page.waitForTimeout(ms)                 // 固定等待
await page.reload()                           // 改代码后必须刷新（HMR 不重建已挂载实例）
```

## 3. 编辑器调试桥

### 3.1 window.__ai（AI 事件桥）

```js
await page.evaluate(() => window.__ai.listEvents())   // 所有事件名（实时为准）
// 编辑器选中/拖动 Actor（预览或场景树，按名字免坐标，等价 gizmo 操作）
await page.evaluate(() => window.__ai.emit('ai.selectActor', { name: '节点名' }))
await page.evaluate(() => window.__ai.emit('ai.dragActor', { name: '节点名', axis: 'x', delta: 2 }))
await page.evaluate(() => window.__ai.emit('ai.dragActor', { name: '节点名', position: [x, y, z] }))
// 游戏运行时：点击/查询（按 root.name 递归查找）
await page.evaluate(async () => await window.__ai.emit('ai.clickActor', { name: '按钮名' }))
await page.evaluate(async () => await window.__ai.emit('ai.getActor', { name: '节点名' }))
```

### 3.2 window.blueprintEditor（蓝图编辑服务）

```js
await page.evaluate(() => window.blueprintEditor.listTypes())      // 已注册 Actor/Component/Blueprint 类型
await page.evaluate(() => window.blueprintEditor.read(path))       // 读资产（有工作副本时返回内存最新）
await page.evaluate(() => window.blueprintEditor.apply(path, 'setComponentProps',
  { type: 'UITransformComponent', props: { position: [1, 2, 0] } }))  // 编辑（apply = 读盘→op→写盘→刷新）
await page.evaluate(() => window.blueprintEditor.dispatch('undo', { assetPath: path }))  // undo/redo/close 也走这
```

### 3.3 electronAPI（浏览器为 Mock）

```js
// Mock 只写内存缓存，不落盘；保存/加载到真实磁盘必须回 Electron 验证
await page.evaluate(async () => await window.electronAPI.readJsonFile(path))
await page.evaluate(async () => await window.electronAPI.writeJsonFile(path, data))
```

## 4. 编辑器通用流程速查

### 4.1 打开工程

```js
await page.getByText('工程名').first().dispatchEvent('dblclick', { bubbles: true })
// 或两步：选中卡片 click + 点"打开工程"按钮 click
```

### 4.2 启动 / 停止游戏

```js
await page.getByRole('button', { name: 'Launch' }).dispatchEvent('click', { bubbles: true })
await page.waitForTimeout(5000)   // 等世界初始化
await page.getByRole('button', { name: 'Stop' }).dispatchEvent('click', { bubbles: true })
```

### 4.3 打开资产预览（蓝图/widget/场景）

```js
// 资产浏览器行双击（onDoubleClick 触发打开预览页签）
await page.getByText('xxx.blueprint.json').dispatchEvent('dblclick', { bubbles: true })
// 预览页签出现后，大纲单击选中节点 → gizmo attach
await page.getByText('节点名').first().dispatchEvent('click', { bubbles: true })
// 双击大纲节点 = 聚焦摄像机到节点
```

### 4.4 切页签

```js
// 大纲 / 资产 / UI 大纲 三个页签
await page.getByRole('button', { name: 'UI 大纲' }).dispatchEvent('click', { bubbles: true })
```

## 5. 踩坑速查

| 现象 | 处理 |
|---|---|
| 任何 `click()`/`dblclick()` 超时 | 页面 hidden → 一律 `dispatchEvent('click'/'dblclick', { bubbles: true })` |
| FPS: 0 / 渲染不动 | 页面 hidden，rAF 暂停——环境限制不是 bug；断言用 DOM/ai 事件而非像素 |
| 改代码后行为还是旧的 | 必须 `page.reload()` 重走流程（HMR 不重建已挂载 manager） |
| evaluate 返回 `deferredResultId` | 长任务异步化 → 同 pageId、无 code 再调一次取结果 |
| 动态 `import('/src/...')` 拿不到页面实例 | 带 `?t=` 的模块裸 import 是独立实例（`instanceof` 失败）；编辑器服务层（UndoManager 等）裸 import 同实例 |
| 拖不动 gizmo | 先 `ai.selectActor` 选中（gizmo 才 attach）；点轴 cone 不是空白处；gizmo 位置 = 节点包围盒中心投影，盲猜坐标易落空 → 优先 `ai.dragActor` 驱动 |
| hidden 页面拖不动 gizmo（即使坐标精确） | **根因：hidden 页面 rAF 停摆 → THREE `matrixWorld` 陈旧 → `gizmo.hitTest` 射线命中失败**。解法：先 `mgr.scene.updateMatrixWorld(true)` + `mgr.gizmo.syncTransform()` 再投影坐标（fiber 桥拿真实 mgr 实例，见下） |
| 模拟 gizmo 拖拽 | **fiber 桥拿真实实例**：canvas 的 `parentElement` 上有 `__reactFiber$` 键 → 沿 `return` 找 `ScenePreviewEditor` fiber → 遍历 `memoizedState` 找含 `current.renderer` 的 ref → 得 mgr。然后 `updateMatrixWorld(true)` + 投影 cone 坐标（`group.children[0].children[1]` = X 轴 cone）→ `canvas.dispatchEvent(new PointerEvent('pointerdown/move/up', {...}))` 完整模拟拖拽（page.mouse 在 hidden 页不可靠）；`setPointerCapture` 报错可忽略（startDrag 已执行） |
| 模拟 Inspector 直改属性（React 受控输入） | **native setter + 同步 blur 无效**（React state 未更新，commit 用旧值）→ 用 `page.locator('input').nth(i).fill('5')` 触发 onChange，**等 ~300ms 后再 blur**（或 Enter），commit 才会拿到新值；blur 后撤销按钮应启用 |
| 保存/加载没生效 | 浏览器 electronAPI 是 Mock（内存缓存）→ 回 Electron 验证真实磁盘 |
| 测试中途改代码 | HMR 重置模块静态状态（UndoManager 栈/workingCopies/`window.blueprintEditor`）→ 断言突然失效，重新 reload |
| 打开工程卡片/资产行单击无效 | 需 **dblclick** |
| 捕获不到 console 日志 | console hook 挂在旧实例闭包上，HMR 后新模块输出绕过 hook——捕获不到不代表没打 |
| PowerShell 写 JSON 带 BOM | `Set-Content -Encoding UTF8` 会写 BOM 导致 JSON.parse 失败；用 `[IO.File]::WriteAllText(path, text, (New-Object Text.UTF8Encoding($false)))` |
