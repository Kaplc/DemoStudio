# Playwright 命令速查 + 踩坑（VS Code 内置浏览器）

> DemoStudio 编辑器浏览器端调试的**纯命令速查 + 踩坑**。本文件是 **① VS Code 内置浏览器**路径（`open_browser_page` / `run_playwright_code` 系列）。
> 只记录编辑器通用操作，不涉及具体项目/资产。详细方法论见 [`playwright_testing.md`](./playwright_testing.md)。
>
> **先选路径**：
> - **① 本文件** —— VS Code 集成浏览器，开箱即用，产物落在工作区内（AI 可读）
> - **② [`playwright_mcp_commands.md`](./playwright_mcp_commands.md)** —— Playwright MCP（`browser_*` 系列），操作**本地 Chrome**，需先挂 CDP `:9222`
>
> 两者打开的是同一个 Vite 页面，页面内调试桥（§3）、通用流程（§4）、踩坑速查（§5）**完全通用**，不必重复阅读。差异只在：浏览器怎么起、元素怎么点、产物落在哪（对照表见 MCP 文档 §4.4）。

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
>
> ⚠️ React 按钮（Launch/Stop/⚙ GM 等内联 onClick）：首选 `locator.dispatchEvent('click', { bubbles: true })`（React 合成事件监听在 root，能收到）；`page.mouse.click` 真实坐标点击在页面 not visible 时可能无效。GM 控制台也可用 G+M 组合键（需先 `document.querySelector('[tabindex="0"]').focus()` 聚焦视口，否则 keydown 不路由）。

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

### 2.6 模拟真实键盘事件（测试输入框/快捷键链路）

引擎键名由 `_formatKey` 生成：需要 `key`（可打印字符/方向键名）与 `code`（控制键如 Backspace/Enter），二者缺一组合键解析失败：

```js
// 可打印字符
window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'h', code: 'KeyH' }))
// Shift+方向键（shiftKey 标记 → 引擎收到 'Shift+ArrowLeft'）
window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft', code: 'ArrowLeft', shiftKey: true }))
// Ctrl+A
window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a', code: 'KeyA', ctrlKey: true }))
// Backspace/Enter/Escape
window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Backspace', code: 'Backspace' }))
```

> ⚠️ 不带 `code` 时：可打印字符仍可用（key.length===1 分支），但 **Shift+ArrowLeft 等组合键会丢失修饰键语义**（引擎读到 'ArrowLeft' 而非 'Shift+ArrowLeft'）。

### 2.7 读引擎内部状态（带 ?t= 同实例动态 import）

```js
// ① fetch 目标文件拿转换后 import URL（含 ?t= 时间戳）
const resp = await fetch('/src/engine/gm/GMModule.ts')
const url = (await resp.text()).match(/from\s+"(\/src\/[^\"]+GameInstance[^"]+)"/)[1]
// ② 用完全相同 URL import → 与页面内同模块实例 → 可读静态属性 GameInstance.current
const mod = await import(url)
const input = mod.GameInstance.current.gm._console._input   // GM 输入框实例
```

> ⚠️ 裸 `import('/src/engine/...ts')`（无 ?t=）是**独立模块实例**，静态属性读不到页面状态；reload 后 ?t= 变化需重新 fetch。
> ⚠️ `window.__ai.emit()` 返回 `{event, handled, results: [...]}`，断言数据在 `results[0]`，不是返回值本身。`ai.getState` 等 UI 树数据在 `results[0].actors`。

### 2.8 hidden 页面 rAF 停 → troika sync 回调不触发

页面 `visibilityState === 'hidden'` 时 rAF 暂停，**troika 的 `sync(callback)` 回调永不执行**（挂 rAF 后通知）——`await` 它会永久卡死 evaluate（返回 deferredResultId 后续轮询也拿不到）。

但 worker 的重排本身照常完成：`mesh.textRenderInfo`（含 caretPositions/blockBounds）已更新。验证布局相关逻辑时：

```js
// ❌ 卡死：等 sync 回调
mesh.sync(() => { done = true })
while (!done) await sleep(50)
// ✅ 直接读 textRenderInfo（重排完成后即新鲜）
const info = mesh.textRenderInfo   // caretPositions.length/4 === 文本字符数 表示已就绪
```

生产代码（如选中高亮）需同时兼容两种时机：立即应用一次 + sync 回调重试（见 UITextInputComponent.updateSelectionMesh 双保险）。

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
| HMR 后静态状态"幽灵分裂" | 模块热更新后新组件图 import 到 `?t=` 版本、旧代码持裸版本，**类内 static 字段双份互不可见**（症状：push 明明执行但 depth 不变）。解法：静态状态挂 `globalThis`（参照 UndoManager `__demostudioUndoStacks`），或改代码后必 reload |
| 诊断"push 是否真被调用" | 在 static 方法开头塞 `console.info` 带 `new Error().stack`，配合本表 console hook 捕获 → 日志里的模块 URL（含 `?t=` 与否）直接暴露调用方属于哪个模块图 |
| 拖不动 gizmo | 先 `ai.selectActor` 选中（gizmo 才 attach）；点轴 cone 不是空白处；gizmo 位置 = 节点包围盒中心投影，盲猜坐标易落空 → 优先 `ai.dragActor` 驱动 |
| hidden 页面拖不动 gizmo（即使坐标精确） | **根因：hidden 页面 rAF 停摆 → THREE `matrixWorld` 陈旧 → `gizmo.hitTest` 射线命中失败**。解法：先 `mgr.scene.updateMatrixWorld(true)` + `mgr.gizmo.syncTransform()` 再投影坐标（fiber 桥拿真实 mgr 实例，见下） |
| 模拟 gizmo 拖拽 | **fiber 桥拿真实实例**：canvas 的 `parentElement` 上有 `__reactFiber$` 键 → 沿 `return` 找 `ScenePreviewEditor` fiber → 遍历 `memoizedState` 找含 `current.renderer` 的 ref → 得 mgr。然后 `updateMatrixWorld(true)` + 投影 cone 坐标（`group.children[0].children[1]` = X 轴 cone）→ `canvas.dispatchEvent(new PointerEvent('pointerdown/move/up', {...}))` 完整模拟拖拽（page.mouse 在 hidden 页不可靠）；`setPointerCapture` 报错可忽略（startDrag 已执行） |
| 模拟 Inspector 直改属性（React 受控输入） | **native setter + 同步 blur 无效**（React state 未更新，commit 用旧值）→ 用 `page.locator('input').nth(i).fill('5')` 触发 onChange，**等 ~300ms 后再 blur**（或 Enter），commit 才会拿到新值；blur 后撤销按钮应启用 |
| 保存/加载没生效 | 浏览器 electronAPI 是 Mock（内存缓存）→ 回 Electron 验证真实磁盘 |
| Playwright MCP（`browser_*`）直连 Electron 窗口时 electronAPI 是**真 IPC** | 与内置浏览器的 Mock 不同：`writeJsonFile` 等直接落盘 → 测试产生的文件必须当场清理，勿当 Mock 对待 |
| 多步长 `browser_evaluate` 超时（默认 10s） | 拆成多个短 evaluate 分步执行；超时后页面可能被导航刷新，工程打开状态/组件上下文全部丢失，需重走打开工程流程 |
| 测试中途改代码 | HMR 重置模块静态状态（UndoManager 栈/workingCopies/`window.blueprintEditor`）→ 断言突然失效，重新 reload |
| 打开工程卡片/资产行单击无效 | 需 **dblclick** |
| 捕获不到 console 日志 | console hook 挂在旧实例闭包上，HMR 后新模块输出绕过 hook——捕获不到不代表没打 |
| `__fishBattle.debugHit(sx,sy)` 只测 UI 层 | 只查 `_uiClickables`（UI 相机射线）；世界层点击（建筑/房子）不在其 targets 内，勿用它断言 3D 命中 |
| 世界层射线点击验证 | `await import('/src/engine/physics/PhySys.ts')` 拿**真实单例**（`ready===true` 即真；GameInstance.ts 裸 import 会拿到 fork 实例 `current===null`，用状态探针区分）→ `sys._camera.updateMatrixWorld()` → 手算投影：`clip = P(projectionMatrix.elements) × inv(matrixWorld.elements) × [x,y,z,1]` → `sys.raycastClick(sx,sy)` → 断言 `sys._pressedClickable?.owner.name`；测完 `sys.raycastRelease()` 清理 |
| 点击结果无日志可观察 | `logger.debug`（如"房子被点击"）可能不进控制台/Recent events → 断言点击用 `PhySys._pressedClickable`（命中者引用）而非日志 |
| 不可见碰撞体射线打不中 | `ClickableComponent.hitTest` **沿父链过滤 `visible=false` 目标**（隐藏物体不响应射线）→ 不可见点击区必须 mesh 保持 visible、用 `colorWrite:false` 材质（不写颜色）+ 可选 `depthWrite:false`，禁用 `setVisible(false)` |
| 基地构建崩溃排查 | `FishBaseGameMode.BeginPlay → ClashBaseBuilder.build` 抛异常 → 基地半成品（无建筑）；AIModule 已带堆栈输出（`logger.error` 含 `err.stack`） |
| 选错浏览器调试路径 | 内置工具（`open_browser_page`）与 Playwright MCP（`browser_*`）是两套并行方案 | 本机是 VS Code 集成浏览器用[本文件](./playwright_commands.md)；用本地 Chrome 走 MCP 见[`playwright_mcp_commands.md`](./playwright_mcp_commands.md)（需先挂 CDP `:9222`） |
| 需要 AI 自己读截图/快照 | MCP 沙箱目录在工作区外，AI 读不到 | 用本路径（内置工具），产物落在工作区内可读 |
| PowerShell 写 JSON 带 BOM | `Set-Content -Encoding UTF8` 会写 BOM 导致 JSON.parse 失败；用 `[IO.File]::WriteAllText(path, text, (New-Object Text.UTF8Encoding($false)))` |
| `executeGM('xxx')` 无效果不报错 | GM 命令未注册时静默返 `{ok:false}`（已注册命令见 `src/projects/fish/gameplay/gm/*.gm.ts`，无 returnBase）；回城等流程直接调 GameInstance 公共方法 `returnToBase()` |
| 阶段敏感 UI 用例时灵时不灵 | `getAllUIActors` 是累计集合，场景切换后旧 HUD 树残留且同名 → `findActorByName` 可能命中旧树按钮；显隐断言改走 GameMode 广播通道（如 `onTasksPanelChange` 回执），用例开头防御性 `returnToBase()` + 断言 `_phase==='base'` |
| CDP `:9222` 有 LISTENING 但 HTTP 探测超时（假监听） | 残留进程占着端口不放（`Invoke-RestMethod /json/version` 超时即中招）→ Playwright MCP 连不上；不要硬试，切内置浏览器路径（本文件），或先 kill 占用进程再重启 Chrome |
| Vite dev `fetch('/xxx.html?raw')` 返回的不是纯文本 | dev server 对 `.html` 请求注入 react-refresh 前导码返回模块包装（编译端报"行1 非法标签起始"的真凶）→ Mock readTextFile 对 `.html` 必须走 `import.meta.glob('...*.html', { query: '?raw' })` 的 loader（运行时返回真实文件内容），fetch fallback 仅限非 html |
| evaluate 里调页面对象方法崩 `instanceof is not an object` | 测试函数经 `new Function` 序列化执行，页面内对象的方法（如 `getComponents()`）内部 instanceof 测试 realm 的类必崩；改读私有字段（`_components`）+ try/catch |
| `ai.emit` 回执当真值恒真 | emit 失败也返回对象（error 在 `results[0].error`）；必须断言 `res?.results?.[0]?.ok === true` |
| 运行时 CodeLint 无法从日志确认归零 | E2E 页面停首页时 CodeLint 只打"无工程"；探针：`import('/src/stores/useCodeLintStore.ts')` + `import('/src/editor/codeLint/CodeLintEngine.ts')` → `codeLintEngine.scan('fish')` → 读 `getState().issues`（0 = 归零） |
| PowerShell 无 tail/head | Windows 管道用 `Select-Object -Last N` / `-First N` 替代 |
| `browser_evaluate` 等页面内执行工具缺失 / CDP 连不上 | 走 `__computer_use__` 屏幕级方案：`list_windows` 找 Chrome 窗口 pid（标题"DemoStudio Editor - Google Chrome"）→ `focus_window` 前台化 → 按最近整屏截图的像素坐标 `click` 直接命中游戏按钮 |
| Game 视口 canvas 内的游戏 UI 按钮，browser_click 点 tab/容器 ref 无效 | snapshot 的 ref 是 DOM 容器而非 canvas 内部元素，点它命中不了游戏按钮；必须真实屏幕坐标点击（见上条）或引擎侧 `ai.clickActor` |
| 浏览器实例（browser_use/内置浏览器）收不到 MCP ai_event | MCP :9877 的 ai_event 经主进程只转发给 **Electron mainWindow** 渲染进程；浏览器多开实例与 Electron 实例是两个世界，点击/事件验证须在对应实例自己的通道内做 |
