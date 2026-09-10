# 世界锚定与脚本（World Anchor & Script）

> **一句话定位**：`UIWorldAnchorComponent`（3D 场景 UI 锚定——屏幕跟随/世界空间双模式）、`UIScriptComponent`（UI 节点挂载 BehaviourScript 的桥接层）、`TroikaFontPreload`（troika 字体预热）是引擎 UI 的三个"非视觉"组件——它们不渲染画面，而是把 UI 锚定到 3D 世界、把行为挂到 UI 节点、以及预热字体缓存。
>
> **什么时候会用到你**：血条/名牌不跟随角色移动；世界空间面板（全息投影）不显示或位置不对；UI 脚本不执行或抛错；第一个文字面板打开时文字延迟出现。
>
> 代码位置：`src/engine/ui/`

---

## 1. 先记住这几个文件

| 文件 | 一句话职责 | 你要改它的场景 |
|---|---|---|
| [UIWorldAnchorComponent.ts](../../src/engine/ui/UIWorldAnchorComponent.ts) | 3D 场景 UI 锚定：screen 模式（屏幕跟随投影）和 world 模式（世界空间面板） | 血条不跟角色、世界面板位置不对、billboard 不朝向相机、面板被 3D 物体遮挡 |
| [UIScriptComponent.ts](../../src/engine/ui/UIScriptComponent.ts) | UI 脚本挂载：widget 蓝图配置 script id，引擎实例化时自动创建 BehaviourScript | 脚本不执行、onStart 拿不到组件、预览世界脚本不该跑 |
| [TroikaFontPreload.ts](../../src/engine/ui/TroikaFontPreload.ts) | troika 字体预热：App 启动时预下载字体 + 预生成高频字形 SDF | 首个文字面板延迟出现、字体缓存不命中 |

**关键心智模型**：这三个组件都**不继承 CanvasUIComponent**——UIWorldAnchorComponent 继承 `ActorComponent`，UIScriptComponent 继承 `ActorComponent`，TroikaFontPreload 是纯工具函数。它们不渲染视觉，而是控制 UI 与 3D 世界的交互方式。

---

## 2. UIWorldAnchorComponent：双模式 3D 锚定

### 2.1 两种模式

```ts
// UIWorldAnchorComponent.ts: vent
export type UIWorldAnchorMode = 'screen' | 'world'
```

- **screen 模式**（默认）：血条/名牌/伤害数字/交互提示。widget 留在 `uiScene`（现状渲染链路零改动），每帧把"target 世界坐标 + localOffset"投影为 UI 设计像素写入根 `UITransform.position`。视觉上是屏幕 UI，位置跟着世界实体走。
- **world 模式**：全息面板/世界大屏（diegetic）。widget 由 UIManager 分流到主场景（`isUIActor` 第三分支），天然深度遮挡/近大远小。设计 px ÷ `pxPerMeter`（缺省 200）= 米。可选 `faceCamera`（billboard）正对相机。

### 2.2 生命周期

```ts
// UIWorldAnchorComponent.ts:150
override BeginPlay(): void {
  super.BeginPlay()
  if (this._mode === 'world') this.applyWorldMode()
  const tsf = this.owner.getComponent(UITransformComponent)
  if (tsf) this._basePx = tsf.getWorldSize()
}
```

> world 模式在 `BeginPlay` 时一次性应用单位换算和渲染适配。screen 模式在 `BeginPlay` 只捕获屏幕像素基准尺寸。

### 2.3 screen 模式：世界坐标 → UI px 投影

```ts
// UIWorldAnchorComponent.ts:170
private tickScreenAnchor(cam): void {
  const target = this.resolveTarget()
  if (!target) return
  // 锚点世界坐标 = target 世界位置 + localOffset
  _tmpVec.set(wp.x + this._localOffset[0], wp.y + this._localOffset[1], wp.z + this._localOffset[2])
  const ui = UICamera.projectToUi(cam, _tmpVec)
  if (!ui) {
    // 相机背面：整树隐藏
    const canvas = this.owner.getComponent(CanvasUIComponent)
    if (canvas && canvas.bActive) canvas.bActive = false
    return
  }
  // 出屏钳制
  if (this._clamping === 'clamp') { /* 钳制到 5% 安全区 */ }
  // 恢复可见
  const canvas = this.owner.getComponent(CanvasUIComponent)
  if (canvas && !canvas.bActive) canvas.bActive = true
  // 直接写根 position（根 anchor 必须为 null）
  tsf.setPosition(ui[0], ui[1], tsf.position.z)
  // 距离缩放
  this.applyScreenScale(cam, wp.y + this._localOffset[1])
}
```

> **每帧执行**：`Tick` 里调用，同帧相机解析之后、主场景渲染之前（`SceneRendererComponent` 帧循环），时序天然正确。
>
> **相机背面**：整树隐藏（`CanvasUIComponent.bActive=false`），回正后恢复。
>
> **根 anchor 必须为 null**：锚定系统接管定位，避开 `applyAnchor` 覆盖语义。assetLint 有对应 warn。

### 2.4 world 模式：单位换算与渲染适配

```ts
// UIWorldAnchorComponent.ts:210
private applyWorldMode(): void {
  // px→米：根 scale = 1 / pxPerMeter
  const s = 1 / this._pxPerMeter
  this.owner.setScale(s, s, s)
  // canvas 纹理密度（近景不糊）
  if (this._pixelDensity !== 1) { /* 放大 canvas 像素 */ }
  // 整树渲染适配：关深度写入、开 mipmap + 各向异性
  const walkRender = (a: Actor): void => {
    a.root.userData.__dsWorldUI = true
    for (const c of a.getComponents(CanvasUIComponent)) c.enableWorldRendering(maxAniso)
    for (const child of a.getChildren()) walkRender(child)
  }
  walkRender(this.owner)
  // 子树 clickable 全部切 world 层
  this.switchClickablesToWorld(this.owner)
}
```

> **根 scale**：整树渲染/命中（`matrixWorld` 逆变换）随缩，canvas 纹理分辨率不受影响（`pixelDensity` 独立控制）。`__dsWorldUI` 标记让后续 `BeginPlay` 的晚生成 canvas 组件自行补课。

### 2.5 billboard（faceCamera）

```ts
// UIWorldAnchorComponent.ts:165
override Tick(): void {
  if (this._mode === 'screen') {
    this.tickScreenAnchor(cam)
  } else if (this._faceCamera && cam) {
    // world 模式 billboard：仅根 quaternion 对齐相机
    this.owner.root.quaternion.copy(cam.quaternion)
  }
}
```

> 仅 world 模式生效。只旋转根 quaternion，子树局部布局不受影响。

### 2.6 alwaysOnTop

```ts
// UIWorldAnchorComponent.ts:250
private applyAlwaysOnTopTree(): void {
  const walk = (a: Actor): void => {
    a.root.userData.__dsWorldUIAlwaysTop = this._alwaysOnTop
    for (const c of a.getComponents(CanvasUIComponent)) {
      c.setAlwaysOnTop(this._alwaysOnTop, WORLD_UI_TOP_RENDER_ORDER)
    }
    for (const child of a.getChildren()) walk(child)
  }
  walk(this.owner)
}
```

> 整树关深度测试 + renderOrder 抬到全局基准（`WORLD_UI_TOP_RENDER_ORDER`），不被建筑等 3D 物体遮挡。运行时热切（Inspector/脚本开关 `alwaysOnTop` 属性）。

---

## 3. UIScriptComponent：UI 脚本挂载

### 3.1 数据驱动

UIScriptComponent 是 UI 节点挂载 BehaviourScript 的桥接层。widget 蓝图配置 `script` id，引擎实例化时自动创建脚本实例：

```ts
// UIScriptComponent.ts:34
override BeginPlay(): void {
  super.BeginPlay()
  // 预览世界禁脚本（置于 script 空校验之前：预览下连"未配置 script"的警告都不产生）
  if (this.owner.world && !this.owner.world.scriptsEnabled) return
  if (!this.script) {
    logger.warn(`[UIScriptComponent] "${this.owner.name}" 未配置 script，跳过`)
    return
  }
  const inst = ScriptRegistry.create(this.script)
  if (!inst) {
    logger.error(`[UIScriptComponent] 脚本 "${this.script}" 未注册（owner="${this.owner.name}"）...`)
    return
  }
  inst.actor = this.owner
  this.instance = inst
  try {
    inst.onStart(this.args)
  } catch (e) {
    logger.error(`[UIScriptComponent] 脚本 "${this.script}" onStart 抛错: ${(e as Error).message}`)
  }
}
```

> 脚本 id 是路径式字符串（如 `gameplay/base/BaseHud`），由项目 `import.meta.glob` 自动注册。`onStart` 包在 try 里——脚本抛错不会中断整个 UI 的 BeginPlay，只留一行 error。

### 3.2 生命周期接入

```ts
// UIScriptComponent.ts:60
override Tick(deltaTime: number): void {
  super.Tick(deltaTime)
  this.instance?.onUpdate(deltaTime)
}

override EndPlay(): void {
  if (this.instance) {
    this.instance.onDestroy()
    this.instance.EndPlay()
    this.instance = null
  }
}
```

> 脚本接入完整生命周期：`onStart`（BeginPlay）→ `onUpdate`（Tick）→ `onDestroy`（EndPlay）。预览世界禁脚本（`World.scriptsEnabled=false`）——BeginPlay 不实例化，`Tick` 里 `instance` 恒为 null 自然跳过（Tick 自身不查 `scriptsEnabled`）。

### 3.3 注意事项

- **`instance` 在 BeginPlay 之后才可用**：生成当帧取 `UIScriptComponent.instance` 会是 `null`
- **脚本抛错不中断 UI 构建**：`onStart` 包在 try 里，错误只留日志
- **预览世界禁脚本**：编辑器预览时 `World.scriptsEnabled=false`，UIScriptComponent 跳过创建

---

## 4. TroikaFontPreload：字体预热

### 4.1 为什么需要预热

首个含文本的 UI 面板打开时，troika 走完整冷启动链路：worker 首次创建 → 思源黑体 woff（~1.5MB/个）XHR 下载 → Typr 解析 → 逐字形 SDF 生成。表现为第一个面板的文字明显延迟出现。

### 4.2 预热机制

```ts
// TroikaFontPreload.ts:50
export function preloadTroikaFonts(): void {
  if (started) return
  started = true
  // unicode fallback 走本地缓存代理
  configureTextBuilder({ unicodeFontsURL: `${location.origin}/__unicode_fonts` })
  for (const font of [notoSansSC400Url, notoSansSC700Url]) {
    preloadFont({ font, characters: WARMUP_CHARS }, () => {
      console.debug(`[TroikaFontPreload] 思源黑体 ${weight} 预热完成（...ms）`)
    })
  }
}
```

> troika 在 worker 内按"字体绝对 URL"缓存解析结果（`parsedFonts`），字形 SDF 缓存在共享图集（`glyphsByFont`）。`preloadFont` API 走与 `Text.sync()` 同一条 `getTextRenderInfo` 链路，预热后首个面板的 `sync()` 直接命中缓存。

### 4.3 缓存键一致性

```ts
// TroikaFontPreload.ts:30
export function resolveTroikaFontURL(family: string | undefined, bold: boolean): string {
  if (family && /^(https?:|data:|blob:|\/)/.test(family)) return family
  return bold ? notoSansSC700Url : notoSansSC400Url
}
```

> **缓存键 = 字体绝对 URL**：预热与 `UITextComponent` 必须共用同一个 `resolveTroikaFontURL`，两处各写一份 URL 推导会让预热静默失效。`configureTextBuilder` 必须在首个字体请求前调用，之后调用会被 troika 忽略。

### 4.4 预热字符集

```ts
const WARMUP_CHARS =
  ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~' +
  '确认取消开始暂停设置返回保存删除关闭新建打开项目场景游戏运行停止输入完成是与否全部搜索' +
  // ... 常用汉字
```

> 字形 SDF 逐个生成进共享图集，冷启动时逐字形开销累积可观。预热把高频字形提前生成，与字体解析缓存一起让首个面板近乎即时渲染。字符集不求全覆盖（生僻字仍会按需生成）。

---

## 5. 关键方法速查

| 方法 | 位置 | 干什么 | 注意 |
|---|---|---|---|
| `UIWorldAnchorComponent.tickScreenAnchor(cam)` | [UIWorldAnchorComponent.ts:170](../../src/engine/ui/UIWorldAnchorComponent.ts) | 每帧投影 target 世界坐标到 UI px | 相机背面整树隐藏；根 anchor 必须为 null |
| `UIWorldAnchorComponent.applyWorldMode()` | [UIWorldAnchorComponent.ts:210](../../src/engine/ui/UIWorldAnchorComponent.ts) | world 模式一次性单位换算 + 渲染适配 | 根 scale = 1/pxPerMeter；打 `__dsWorldUI` 标记 |
| `UIWorldAnchorComponent.applyAlwaysOnTopTree()` | [UIWorldAnchorComponent.ts:250](../../src/engine/ui/UIWorldAnchorComponent.ts) | 整树关深度测试 + renderOrder 抬升 | 运行时热切；打 `__dsWorldUIAlwaysTop` 标记 |
| `UIWorldAnchorComponent.switchClickablesToWorld()` | [UIWorldAnchorComponent.ts:270](../../src/engine/ui/UIWorldAnchorComponent.ts) | 递归切换子树 ClickableComponent 到 world 层 | BeginPlay 后赋值自动迁移注册表 |
| `UIScriptComponent.BeginPlay()` | [UIScriptComponent.ts:34](../../src/engine/ui/UIScriptComponent.ts) | 创建 BehaviourScript 实例 + 调 onStart | 预览世界禁脚本；onStart 抛错不中断 |
| `UIScriptComponent.Tick(dt)` | [UIScriptComponent.ts:60](../../src/engine/ui/UIScriptComponent.ts) | 调脚本 onUpdate | 预览世界靠 BeginPlay 不实例化（`instance` 为 null），Tick 自身不判 `scriptsEnabled` |
| `UIScriptComponent.EndPlay()` | [UIScriptComponent.ts:70](../../src/engine/ui/UIScriptComponent.ts) | 调 onDestroy + 脚本 EndPlay | 清空 instance |
| `preloadTroikaFonts()` | [TroikaFontPreload.ts:50](../../src/engine/ui/TroikaFontPreload.ts) | 异步预热思源黑体 400/700 字体 | fire-and-forget，幂等；App 启动时调用一次 |
| `resolveTroikaFontURL(family, bold)` | [TroikaFontPreload.ts:30](../../src/engine/ui/TroikaFontPreload.ts) | 解析 troika 字体 URL | 预热与渲染必须共用此函数 |

---

## 6. 流程影响：牵动哪些功能

### 上游：谁驱动它

| 上游 | 怎么驱动 | 相关文档 |
|---|---|---|
| `UIManager.spawnAnchoredWidget` | 创建带 UIWorldAnchor 的 widget，持有 `AnchoredWidgetHandle` | [世界 UI 系统](./ui_system.md) |
| `App.tsx` 启动（`src/App.tsx:58`） | 调用 `preloadTroikaFonts()` 预热字体（唯一调用点，不在 `GameInstance.start()`） | [UI 控件组件](./ui_control_components.md) |
| 编译器 `emitDataScript` | `.widget.html` 的 `data-script` → `UIScriptComponent.script` | [UI 源格式与编译器](../editor/ui/ui_source_format_system.md) |
| `World.scriptsEnabled` | 预览世界禁脚本，UIScriptComponent 跳过创建 | [实体系统](./entity_system.md) |

### 下游：它波及谁

| 下游功能 | 波及点 | 相关文档 |
|---|---|---|
| Canvas 渲染 | world 模式调用 `enableWorldRendering` 切换深度写入/mipmap/renderOrder | [CanvasUIComponent](./ui_canvas_component.md) |
| 射线点击 | world 模式子树 clickable 切 world 层（主相机射线）；screen 模式保持 ui 层（正交相机） | [物理系统](./physics_system.md) |
| UITextComponent 渲染 | `resolveTroikaFontURL` 决定字体 URL；预热缓存影响首次渲染延迟 | [UI 控件组件](./ui_control_components.md) |
| 脚本系统 | UIScriptComponent 通过 `ScriptRegistry.create` 创建 BehaviourScript 实例 | [脚本系统](./script_system.md) |
| 资产检查器（assetLint） | 根 anchor 为 null 的 warn；world 模式 `__dsWorldUI` 标记检查 | [资产预览与检查](../editor/asset/asset_preview_lint_system.md) |

---

## 7. 踩坑清单（都是真踩过的）

**1. screen 模式血条不跟随角色 / 位置不动** —— `tickScreenAnchor` 每帧执行，但若 `targetActorId` 为空或 target 已销毁，`resolveTarget()` 返回 null 跳过投影。**规则**：确认 `targetActorId` 拼写正确且 target Actor 存活；target 销毁时 UIManager 按 target 销毁策略处理 widget。

**2. world 模式面板被 3D 物体遮挡** —— world 模式面板在主场景渲染，天然深度遮挡。**规则**：设 `alwaysOnTop=true` 整树关深度测试 + renderOrder 抬升；或调 `pxPerMeter` 让面板更大。

**3. world 模式面板点击穿透到 3D 物体** —— 子树 clickable 默认是 `layer='ui'`，用正交相机检测，world 模式面板在主场景中射线不命中。**规则**：`applyWorldMode` 已自动调用 `switchClickablesToWorld` 切换子树全部 clickable 到 world 层；若手动创建 clickable 需确认 `layer='world'`。

**4. 字体预热不生效（首个面板文字仍然延迟）** —— 预热与 `UITextComponent` 的字体 URL 推导不一致，缓存键不匹配。**规则**：两处必须共用 `resolveTroikaFontURL`，不要各写一份 URL 推导。

**5. `configureTextBuilder` 调用后不生效** —— 必须在首个字体请求前调用，之后调用会被 troika 忽略。**规则**：`preloadTroikaFonts` 在 App 启动时调用一次，幂等保护。

**6. UI 脚本 onStart 拿不到组件** —— `UIScriptComponent.BeginPlay` 在 UI Actor 的 BeginPlay 链中执行，此时同 Actor 的其他组件可能尚未 BeginPlay（组件 BeginPlay 倒序执行）。**规则**：依赖其他组件的逻辑放 `onStart` 里用 `getComponent` 取，不要假设构造时可用；若需等一帧用 `setTimeout`。

**7. 预览世界脚本仍然执行** —— 预览世界 `World.scriptsEnabled=false`，UIScriptComponent 在 `BeginPlay` 开头判断并跳过。**规则**：若脚本在预览世界执行，检查 `World.scriptsEnabled` 是否正确设置。

---

## 8. 边界条件

| 条件 | 行为 | 怎么应对 |
|---|---|---|
| screen 模式 target 为 null | 跳过投影，widget 保持上次位置 | 确认 targetActorId 存在 |
| screen 模式 target 在相机背面 | 整树隐藏（bActive=false） | 回正后自动恢复可见 |
| world 模式 `pxPerMeter=0` | `applyWorldMode` 跳过（除零保护） | 确保 pxPerMeter > 0 |
| world 模式 `pixelDensity=1` | 不放大 canvas 纹理 | 近景不糊时调大（2~4） |
| `alwaysOnTop` 运行时切换 | 整树热切深度测试 + renderOrder | 打 `__dsWorldUIAlwaysTop` 标记 |
| UIScriptComponent 无 `script` id | BeginPlay `logger.warn` 后返回（先过 `scriptsEnabled` 早退） | 查日志里的"未配置 script" |
| 脚本 `onStart` 抛错 | 只 error 日志，不中断 UI 构建 | 查日志定位脚本错误 |
| `preloadTroikaFonts` 重复调用 | 幂等保护（`started` 标志） | 多次调用无害 |
