# UI 布局与容器（UI Layout & Container）

> **一句话定位**：`UILayoutComponent`（水平/垂直/网格自动排列）、`UIMaskComponent`（矩形/圆角/文本裁剪）、`UIScrollContainerComponent`（拖拽滚动 + 回弹 + 滚动条）是引擎 UI 的三个布局/容器组件——它们不渲染视觉，而是控制子节点的排列、裁剪和滚动行为。
>
> **什么时候会用到你**：子节点没有按预期排列（兵营格子错位/菜单按钮堆叠）；UI 内容溢出父容器（列表/面板裁切不对）；需要可滚动的长列表/信息面板。
>
> 代码位置：`src/engine/ui/`

---

## 1. 先记住这几个文件

| 文件 | 一句话职责 | 你要改它的场景 |
|---|---|---|
| [UILayoutComponent.ts](../../src/engine/ui/UILayoutComponent.ts) | 布局组件：horizontal/vertical/grid 三种模式 + justify/align + wrap 换行 + autoHeight | 子项排列不对、间距不对、换行不生效、容器高度不跟随内容 |
| [UIMaskComponent.ts](../../src/engine/ui/UIMaskComponent.ts) | 遮罩裁剪：GL scissor 矩形裁剪 + 圆角 SDF discard + troika clipRect | 子节点溢出父容器、圆角遮罩不生效、文本被遮罩错误裁剪 |
| [UIScrollContainerComponent.ts](../../src/engine/ui/UIScrollContainerComponent.ts) | 滚动容器：拖拽滚动 + 越界回弹 + 程序化滚动条 | 内容不能滚动、滚动条不显示、回弹太慢/太快 |

**关键心智模型**：这三个组件都挂在**容器 Actor** 上，控制其**子 Actor** 的行为。它们自身不渲染任何视觉（UIMask 通过 shader/scissor 裁剪子树渲染结果）。布局和滚动是互斥的——滚动容器内部通常有一个布局组件来排列内容。

---

## 2. UILayoutComponent：自动排列子节点

### 2.1 三种模式

UILayoutComponent 挂在容器 Actor 上，自动按模式排列所有子 UI 节点：

```ts
// UILayoutComponent.ts:30
export type UILayoutMode = 'horizontal' | 'vertical' | 'grid'
```

- **horizontal**：子项沿 X 轴单行排列（CSS flex-direction: row）
- **vertical**：子项沿 Y 轴单列排列（CSS flex-direction: column）
- **grid**：按 `columns` 列数分多行排列（首行在上）

### 2.2 布局核心：写入 anchorOffset

布局不直接设 `position`，而是写入子项的 `UITransformComponent.anchorOffset`：

```ts
// UILayoutComponent.ts:380
for (let i = 0; i < children.length; i++) {
  const tf = children[i].getComponent(UITransformComponent)!
  const [ox, oy] = offsets[i]
  if (tf.anchor === 'center' || !tf.anchor) {
    if (tf.anchor) {
      tf.anchorOffset = [ox, oy]
      tf.applyAnchor()
    } else {
      tf.setPosition(ox, oy, 0)
    }
  } else {
    // 其他预设锚点（编译器角锚点等）：归一化为 center 再写
    tf.anchor = 'center'
    tf.anchorOffset = [ox, oy]
  }
}
```

> 步长 = 子项尺寸 + 对应方向 spacing。子项的世界尺寸（`worldWidth/worldHeight`）决定格子步长。非 center 锚点的子项会被归一化为 center——布局容器接管子项定位。

### 2.3 justify/align 语义

horizontal/vertical 模式支持 CSS justify-content 和 align-items 语义：

```ts
// UILayoutComponent.ts:300
// 主轴偏移计算
switch (justify) {
  case 'start':    // 首项贴起始边
  case 'end':      // 末项贴终止边
  case 'center':   // 整组居中（缺省，与旧版公式一致）
  case 'space-between': // 首尾贴边，剩余均分间隔
  case 'space-around':  // 每项两侧等距
  case 'space-evenly':  // 间隔完全相等
}
```

> **stretch 对齐**：把未显式设置该轴尺寸的子项拉伸至容器内尺寸。`_baseSizes` 快照保证 stretch 写回不漂移——改回 center 等对齐时恢复基准尺寸。

### 2.4 wrap 换行

```ts
// UILayoutComponent.ts:240
if (this._wrap) {
  // 列数按容器宽自动推导
  const container = ownTf?.worldSizeExplicit ? ownTf.getWorldSize() : null
  if (container) {
    effCols = Math.max(1, Math.floor((container[0] + this._spacingX) / (itemW + this._spacingX)))
  }
}
```

> grid 模式 `wrap=true` 时忽略固定 `columns`，列数按容器宽自动推导。horizontal+wrap 同理。vertical+wrap 行数按容器高推导，列内先填满再开新列（CSS multi-column 语义）。容器无显式尺寸时退化为不换行。

### 2.5 Tick 自动检测

```ts
// UILayoutComponent.ts:170
override Tick(_dt: number): void {
  if (!this._autoLayout) return
  const sig = this.owner.getChildren()
    .map((c) => `${c.root.name}${c.bActive ? '' : '~'}`)
    .join('|')
  if (sig !== this._lastSignature) {
    this._lastSignature = sig
    this.layout()
  }
}
```

> 签名检测（数量 + 名字 + 激活态），避免每帧无谓重排。失活子项（`bActive=false`）不参与布局（CSS `display:none` 出流语义），隐藏/恢复后自动按 justify 重排。

### 2.6 autoHeight

```ts
// UILayoutComponent.ts:420
if (this._autoHeight) {
  const ownTf = this.owner.getComponent(UITransformComponent)
  if (ownTf) {
    const [cw, ch] = ownTf.getWorldSize()
    if (this._contentSize[1] > 0.001 && Math.abs(ch - this._contentSize[1]) > 0.001) {
      ownTf.setWorldSize(cw, this._contentSize[1], true)
    }
  }
}
```

> 布局后容器 `worldHeight` 写回为内容包围盒高。动态子项数量变化时容器跟着变高，配合 UIMask/滚动使用。宽度不变。

---

## 3. UIMaskComponent：裁剪子树渲染

### 3.1 三机制并存

UIMaskComponent 不创建自己的 mesh，而是通过三种机制裁剪子节点的渲染：

```ts
// 1. GL scissor rect（所有对象兜底）
// 2. 圆角 SDF discard（MeshBasicMaterial onBeforeCompile 注入）
// 3. troika clipRect（文本矩形裁剪）
```

**GL scissor**：最底层裁剪，对所有渲染对象生效。设置 `gl.scissorTest = true` + `gl.scissor(x, y, w, h)`，限制像素写入区域。

**圆角 SDF**：通过 `onBeforeCompile` 注入 fragment shader，用 SDF 距离场 discard 圆角外的像素：

```ts
// UIMaskComponent.ts 关键逻辑
const injectRoundClip = (material: THREE.Material, ...) => {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      'gl_FragColor = vec4( ... )',
      `float dist = sdf_rounded_box(vUv, ...);
       if (dist > 0.0) discard;
       gl_FragColor = vec4( ... )`,
    )
  }
}
```

**troika clipRect**：对 `UITextComponent` 的 troika mesh 设 `clipRect` 属性，troika 原生支持矩形裁剪。

### 3.2 嵌套遮罩

```ts
// 嵌套 mask = 链上矩形求交
const collectMaskChain = (actor: Actor): UIMaskComponent[] => {
  const masks: UIMaskComponent[] = []
  let current: Actor | null = actor
  while (current) {
    const mask = current.getComponent(UIMaskComponent)
    if (mask) masks.push(mask)
    current = current.parent
  }
  return masks
}
```

> 从当前节点向上遍历父链，收集所有 `UIMaskComponent`，取各 mask 世界矩形的交集作为最终裁剪区域。

### 3.3 已知限制

- **仅轴对齐**：mask 矩形必须与坐标轴对齐（不支持旋转）
- **命中测试不裁剪**：`ClickableComponent` 的 hitTest 不受 mask 影响——点击可能穿透 mask 边缘
- **troika 圆角退化矩形**：troika 不支持圆角裁剪，圆角 mask 对文本退化为矩形裁剪

---

## 4. UIScrollContainerComponent：拖拽滚动

### 4.1 架构

滚动容器有一个单一内容子 Actor（`_ScrollContent` 层），滚动 = 平移 content 的本地位置：

```ts
// UIScrollContainerComponent.ts 关键结构
// owner (ScrollContainer)
//   └── _ScrollContent (内容容器，平移此节点实现滚动)
//         ├── 子项 1
//         ├── 子项 2
//         └── ...
//   └── 滚动条（轨道 + 滑块，程序化生成）
```

### 4.2 拖拽滚动

```ts
// 通过 ClickableComponent onDrag 实现
clickable.onDragStart = (hit) => { /* 记录拖拽起点 */ }
clickable.onDragMove = (hit) => {
  const delta = startPos - currentPos
  this.scrollBy(delta)
}
clickable.onDragEnd = () => { /* 越界回弹 */ }
```

> 滚动容器自动创建 `ClickableComponent` 和透明命中层（`ensureClickable` → `ensureHitLayer`）。拖拽位移映射为内容平移。

### 4.3 越界回弹

```ts
// 越界回弹：TweenSystem quadOut 0.25s
if (offset > 0) {
  // 超出顶部：回弹到 0
  TweenSystem.instance.to(this._scrollContent.position, { y: 0 }, 0.25, 'quadOut')
} else if (offset < maxScroll) {
  // 超出底部：回弹到 maxScroll
  TweenSystem.instance.to(this._scrollContent.position, { y: maxScroll }, 0.25, 'quadOut')
}
```

> 拖拽超出内容边界时，松手自动回弹到合法范围。回弹动画用 `quadOut` 缓动，0.25 秒。

### 4.4 程序化滚动条

```ts
// UIScrollContainerComponent.ts 关键逻辑
createScrollbar(): void {
  // 轨道（track）：背景条
  // 滑块（thumb）：可拖拽的指示器
  // 滑块尺寸 = 轨道尺寸 × (容器高 / 内容高)
  // 滑块位置 = 轨道尺寸 × (scrollOffset / maxScroll)
}
```

> 滚动条与 `UIScrollListComponent` 同款实现。滑块尺寸反映可见比例，位置反映滚动进度。滚动条本身也是 `ClickableComponent`，可拖拽滑块快速定位。

### 4.5 refresh 与 scrollBy

```ts
refresh(): void {
  // 重新计算内容尺寸（子项变化后调用）
  // 更新 maxScroll
  // 更新滚动条
}

scrollBy(delta: number): void {
  // 平移 _ScrollContent.position.y
  // 钳制到 [maxScroll, 0]
  // 更新滚动条位置
}
```

> 子项动态变化（增删/尺寸变化）后调用 `refresh()` 更新滚动范围。`scrollBy` 自动钳制不越界。

---

## 5. 关键方法速查

| 方法 | 位置 | 干什么 | 注意 |
|---|---|---|---|
| `UILayoutComponent.layout()` | [UILayoutComponent.ts:190](../../src/engine/ui/UILayoutComponent.ts) | 重新布局所有子 UI 节点 | 动态生成子节点后手动调用；BeginPlay 自动调用一次 |
| `UILayoutComponent.Tick()` | [UILayoutComponent.ts:170](../../src/engine/ui/UILayoutComponent.ts) | 签名检测子项变化自动重排 | `autoLayout=true` 时生效；签名 = 数量+名字+激活态 |
| `UILayoutComponent.contentSize` | [UILayoutComponent.ts:430](../../src/engine/ui/UILayoutComponent.ts) | 最近一次布局的内容包围盒 [w,h] | 未布局过为 [0,0] |
| `UIMaskComponent.collectMaskChain()` | [UIMaskComponent.ts:200](../../src/engine/ui/UIMaskComponent.ts) | 收集父链上所有 mask 求交 | 嵌套 mask = 链上矩形求交 |
| `UIMaskComponent.applyScissor()` | [UIMaskComponent.ts:150](../../src/engine/ui/UIMaskComponent.ts) | 设置 GL scissor 矩形裁剪 | 所有对象兜底裁剪 |
| `UIMaskComponent.injectRoundClip()` | [UIMaskComponent.ts:180](../../src/engine/ui/UIMaskComponent.ts) | 注入 fragment shader 圆角 discard | 仅对 MeshBasicMaterial 生效 |
| `UIScrollContainerComponent.refresh()` | [UIScrollContainerComponent.ts:100](../../src/engine/ui/UIScrollContainerComponent.ts) | 重新计算内容尺寸 + 更新滚动范围 | 子项变化后调用 |
| `UIScrollContainerComponent.scrollBy(delta)` | [UIScrollContainerComponent.ts:130](../../src/engine/ui/UIScrollContainerComponent.ts) | 平移内容 + 钳制边界 + 更新滚动条 | 自动回弹越界 |
| `UIScrollContainerComponent.createScrollbar()` | [UIScrollContainerComponent.ts:200](../../src/engine/ui/UIScrollContainerComponent.ts) | 程序化生成轨道+滑块 | 与 UIScrollList 同款 |

---

## 6. 流程影响：牵动哪些功能

### 上游：谁驱动它

| 上游 | 怎么驱动 | 相关文档 |
|---|---|---|
| `UIManager.spawnUIActor` | 蓝图解析 → 组件构造 → BeginPlay 触发首次 layout/mask/scroll 初始化 | [世界 UI 系统](./ui_system.md) |
| `UITransformComponent` 尺寸变化 | 布局依赖容器尺寸（`worldSizeExplicit`）；mask 依赖世界矩形 | [世界 UI 系统](./ui_system.md) |
| 子节点增删/激活态变化 | Tick 签名检测触发 layout；子项变化触发 scroll refresh | [实体系统](./entity_system.md) |
| `ClickableComponent` 拖拽 | 滚动容器通过 onDragStart/Move/End 驱动 scrollBy | [物理系统](./physics_system.md) |

### 下游：它波及谁

| 下游功能 | 波及点 | 相关文档 |
|---|---|---|
| Canvas 渲染 | UIMask 通过 GL scissor / shader inject 裁剪子树渲染结果 | [CanvasUIComponent](./ui_canvas_component.md) |
| troika 文本渲染 | UIMask 对 UIText 用 `clipRect` 裁剪；圆角 mask 对文本退化为矩形 | [UI 控件组件](./ui_control_components.md) |
| 滚动列表（UIScrollList） | 滚动条实现与 UIScrollContainer 同款；UIScrollList 内部也使用滚动容器 | [UI 增强系统](../editor/ui/ui_enhancement_system.md) |
| 蓝图编辑 | 布局/遮罩/滚动组件的属性通过 Inspector 编辑，持久化到蓝图 | [蓝图编辑](../editor/blueprint/blueprint_edit_system.md) |
| 锚点系统 | 布局写入子项 `anchorOffset`，与锚点系统共用同一套定位机制 | [UI 锚点系统](../editor/ui/ui_anchor_system.md) |

---

## 7. 踩坑清单（都是真踩过的）

**1. 布局后子项位置不对（偏移/错位）** —— 子项锚点不是 `center` 时，`anchorOffset` 语义不同（角锚点的 offset 是相对锚定边的）。**规则**：`layout()` 会把非 center 锚点的子项归一化为 `center` 再写 offset，布局容器接管子项定位。

**2. 容器无显式尺寸时 justify/align 退回 center** —— `justify`/`align` 非 center 时依赖容器尺寸计算偏移。**规则**：容器必须设 `worldWidth/worldHeight`（`worldSizeExplicit=true`），否则只告警一次并退回 center 行为。

**3. stretch 写回后改 align 尺寸不恢复** —— stretch 用 `setWorldSize(..., false)`（不置 `explicit` 标志），但 `_baseSizes` 快照在首次布局时记录。**规则**：stretch 写回不污染基准，改回 center 等对齐时从 `_baseSizes` 恢复。

**4. 失活子项隐藏后布局不重排** —— 签名检测包含激活态（`~` 后缀），失活子项变化会触发重排。**规则**：隐藏/恢复子项自动按 justify 重排，剩余子项重新分布。

**5. mask 圆角不生效 / 文本被 mask 错误裁剪** —— 圆角 mask 通过 shader inject 实现，仅对 `MeshBasicMaterial` 生效；troika 文本用 `clipRect` 矩形裁剪，圆角退化为矩形。**规则**：圆角 mask 对 UIText 不生效；嵌套 mask 链上矩形求交。

**6. 滚动内容超出容器不滚动** —— 滚动容器需要单一内容子 Actor（`_ScrollContent`），且内容高度 > 容器高度才可滚动。**规则**：子项必须挂在 `_ScrollContent` 下（由 `refresh()` 自动创建），内容尺寸不足时不滚动。

**7. 滚动回弹不生效 / 回弹动画不执行** —— 越界回弹依赖 `TweenSystem`，需 `TweenSystem.instance` 已初始化。**规则**：确认 TweenSystem 在游戏启动时已初始化；回弹 `quadOut` 0.25s 是硬编码。

---

## 8. 边界条件

| 条件 | 行为 | 怎么应对 |
|---|---|---|
| 布局容器无子项 | `layout()` 直接返回 | 不报错 |
| 子项无 `UITransformComponent` | 被过滤，不参与布局 | 确保子项有 uitransform |
| grid 模式 `columns=0` | 钳制为 1 | 最小 1 列 |
| wrap 容器无显式尺寸 | 退化为不换行（固定列数） | 给容器设显式尺寸 |
| mask 矩形 w/h ≤ 0 | scissor 不生效 | 确保 mask 容器有正尺寸 |
| 嵌套 mask 无交集 | 裁剪区域为空（全黑） | 避免 mask 完全错位 |
| 滚动内容小于容器 | 不滚动，滚动条隐藏 | 正常行为 |
| 拖拽位移 ≤ 8px | 判为点击而非拖拽 | 滚动组件绑 `onDragMove` 走拖拽语义 |
