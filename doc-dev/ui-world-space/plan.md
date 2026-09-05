# 方案：游戏内 3D 场景 UI（World-Space UI，双模式：屏幕跟随 + 世界空间面板）

> 状态：方案草案 v1（2026-09-03）｜ 验收用例：[test-cases.md](./test-cases.md)
> 关联：`doc-dev/ui-unit-unification/plan.md`（**硬前置**，v2 单位一元化收尾前本方案不动工）、`doc/engine/ui_system.md`、`doc/engine/ui_canvas_component.md`

---

## 一、目标与非目标

**目标**：让 widget 能锚定到 3D 世界——覆盖两类真实需求：

1. **屏幕跟随层**（量大、高频）：单位头顶血条/名牌、伤害数字、采集点/交互提示（"按 E"）、任务目标标记（含出屏指示）。视觉上是屏幕 UI，位置跟着世界实体走。
2. **世界空间面板**（量小、沉浸）：世界内的全息面板/大屏/建筑核心界面（diegetic）。视觉上属于 3D 世界：透视正确、会被建筑遮挡、近大远小、可绕到背后。

**核心判断（调研结论）**：DemoStudio 的 UI **本来就是 3D mesh**——每个画布节点是离屏 canvas → CanvasTexture → PlaneGeometry mesh（`CanvasUIComponent.ts:112-153`），文字是 troika SDF mesh。所谓"屏幕 UI"只是"这些 mesh 被放进独立 uiScene、由正交 UICamera 叠加渲染"（`SceneRendererComponent.ts:440`，`clearDepth` 后画所以永不被世界遮挡）。因此 3D 场景 UI **不需要 render-to-texture、不需要新渲染管线**，只需要解决三件事：**场景归属**（进 uiScene 还是主场景）、**逐帧锚定**（世界坐标 → UI px 投影 / 世界位姿）、**输入分流**（UI 平行射线 vs 世界射线）。

**非目标**：
- 不做"面板内显示 3D 画面"（全息小地图）——那才需要 WebGLRenderTarget / 第二视口（`CameraOverlayRenderer` 的 pip 是现成参考），另立专项；
- 不改 widget 编译器的布局求解与标签体系（复用 `data-comp` 既有逃逸通道，零新标签）；
- 不在本方案内做 UI 数据绑定（沿用命令式脚本刷新惯例）。

## 二、现状链路（可复用挂点，2026-09-03 实测）

### 2.1 渲染与场景归属
- 帧循环：`SceneRendererComponent.ts:389-448`——解析相机（:403）→ `updateCallbacks`（:427，GameInstance.tick / `tickUI` 在此驱动）→ 主场景渲染（:433）→ `UICamera.render`（:440，`autoClear=false + clearDepth`，`UICamera.ts:69-76`）。**tickUI 发生在同帧相机解析之后、渲染之前——锚定投影的时序天然正确。**
- UICamera：1920×1080 设计画布 + contain 视锥（`UICamera.ts:22-23, 57-66`，v2 已翻转未提交）。
- 场景分流点已存在：`UIManager.isUIActor`（`UIManager.ts:100-110`）在 `commitSpawn` 决定 Actor 挂 uiScene 还是主场景——**世界空间模式 = 在此加一个分支**。UI Actor 的生命周期（`commitSpawn/commitDestroy`、`tickUI`）由 UIManager 统一管理（:359-393, :471-482），与挂哪个场景解耦。
- 遮挡：uiScene 主动 `clearDepth` 免遮挡；**canvas mesh 放进主场景则天然参与深度测试**（`CanvasUIComponent.ts:8` 注释即此设计意图）——世界空间面板的遮挡是免费能力。

### 2.2 输入
- `PhySys.raycastClick`（`PhySys.ts:151-206`）两层：UI 层优先（UICamera 平行射线 + zOrder 竞争，block 画布消费点击），未中才走世界层主相机射线。**留在 uiScene 的跟随 widget：输入零改动全兼容。**
- 世界层 picking 已分层可用：`ClickableComponent(layer='world')`（`ClickableComponent.ts:24-28`）自动收集 root 下所有 Mesh；UIButton 的自动点击层就是透明 UIImage mesh（`UIButtonComponent.ts:165-198`）——世界面板的按钮只需把 clickable 切到 world 层即可被主相机射线命中。

### 2.3 既有世界锚定雏形（都是项目级、非常数化）
- `DamageNumberFx.ts:43-73`：参数已是 **UI 画布坐标**，要求调用方自己投影；TweenSystem 上浮淡出已成型。
- `LootFlyFx.ts:129-139 worldToUi`：唯一现成 3D→UI 投影（NDC × 半画布），但 `UI_HALF_W=4.8/H=2.7` 是 **v2 未清的米制残留**（:27-28）。
- 引擎无 billboard 组件（`SpriteComponent` 是固定 -Z 朝向）、无任何 `WebGLRenderTarget` 使用、无常数化投影 API——这三块是净新增。

### 2.4 编辑器
- `UIPreviewManager`：widget 设计态预览（独立 World + 正交相机，2D 正面）；`ScenePreviewManager` 场景视口（PerspectiveCamera 45° + TransformGizmo，`ScenePreviewManager.ts:39,143`）；`SelectionBoundsGizmo` 可直接用于选中世界空间 widget。

## 三、核心架构决策

### D1：一个组件承载两种模式 —— `UIWorldAnchorComponent`

挂在 **widget 根 Actor** 上，`mode` 二选一：

| | `mode: 'screen'`（P1） | `mode: 'world'`（P2） |
|---|---|---|
| 场景归属 | uiScene（现状，零改动） | 主场景（`isUIActor` 分流加一分支） |
| 相机 | UICamera 正交（现状） | 主透视相机 |
| 逐帧逻辑 | 世界坐标 → `projectToUi` → 写根 UITransform position | 仅 billboard（可选）+ 恒定屏占缩放（可选）；位姿静态 |
| 遮挡 | 永不被挡（可选 raycast 淡化） | 天然深度遮挡 |
| 输入 | UI 层平行射线，现状全兼容 | clickable 切 `layer='world'`，距离最近者胜 |
| 尺寸语义 | 设计 px 恒定屏占（`constantScreenSize` 可关） | 设计 px ÷ `pxPerMeter`（缺省 200）= 米 |
| 典型用途 | 血条/名牌/伤害数字/交互提示/目标标记 | 全息面板/世界大屏/建筑核心界面 |

组件 properties：`mode`、`targetActorId`、`localOffset [x,y,z]`（米，如 `[0, 2.2, 0]` 头顶）、`faceCamera`（world 模式 billboard）、`constantScreenSize`、`clamping: 'none'|'clamp'|'indicator'`、`occlusion: 'none'|'fade'`、`pxPerMeter`、`pixelDensity: 1|2`、`maxDistance`（LOD 隐藏）。

### D2：screen 模式 = 投影工具 + 锚定 tick，其余全套复用

1. **新引擎工具 `UICamera.projectToUi(camera, worldPos)`**：NDC 投影 → UI px（`x*960+960, y*540+540`），相机背面（z>1）返回 null。同时收编 `LootFlyFx.worldToUi`（顺手清掉 4.8/2.7 残留）。
2. **锚定 tick 挂 `tickUI`**：`worldPos = target.transform + localOffset` → 投影 → 写根 `UITransform`（**anchor 必须为 null，直接写 position**——避开 `applyAnchor` 覆盖语义，`UITransformComponent.ts:141-177`；DamageNumberFx 现在写 anchorOffset 能工作依赖根无锚的巧合，迁移时一并规整）。
3. **输入/zOrder/浮动层零改动**：widget 在 uiScene 里就是普通 UI，`FLOAT_LAYER_BIAS`、树序 zOrder、block 语义照旧。
4. **池化与上限**：`UIManager.spawnAnchoredWidget(path, target, opts) → { release() }` 句柄式 API；伤害数字类高频对象走池，同屏锚定 widget 设上限（性能与"HUD 杂乱"双重约束，见 D6）。
5. `constantScreenSize=false` 时按距离缩放（近大远小）；`clamping='clamp'` 出屏时钳制到安全区内缩边距（5%）；`occlusion='fade'` 相机→锚点 raycast 节流 ~150ms 错峰，被挡 opacity→0.35（P3）。

### D3：world 模式 = 场景分流 + 单位换算 + 输入切层

1. **分流**：`isUIActor` 增加第三支——根含 `UIWorldAnchorComponent(mode='world')` 的 Actor 仍归 UIManager 生命周期管理，但挂**主场景**。子树随根 Object3D 走，逐节点无需感知。（注意：此类 widget 不能作为 HUD 子节点 spawn，统一走 `spawnAnchoredWidget`。）
2. **单位**：设计 px 仍是唯一事实源，`worldWidth(米) = px / pxPerMeter`，**pxPerMeter 缺省 200**——延续既有 200px/m 设计直觉：一张 1920×1080 全屏面板 = 9.6m×5.4m 的全息墙，数值上与 v2 之前的旧语义无缝衔接。`pixelDensity: 2` 时 canvas 实际像素 ×2（近景不糊），设计 px 不变。
3. **billboard**：`faceCamera=true` 时每帧根 quaternion = 相机 quaternion（仅根，子树局部布局/UILayout 不受影响）。
4. **输入**：BeginPlay 遍历子树把 `ClickableComponent.layer` 切 `'world'`，UIButton 自动点击层（透明 mesh）即被主相机射线命中。~~⚠️ 语义差异要文档化：screen 层的 `block`"消费点击"在 world 层不存在~~ **【2026-09-05 已实现】**：PhySys 世界层改为"收集全部命中取射线最近者"（`pickFrontmostHit`，注册顺序不再参与归属——本条原假设"mesh 最近命中天然形成遮挡"与当时的注册序实现不符，现已被修正），且 `hit-test: block` 经编译器落到带背景节点的 `UIImageComponent` 视觉块后，world 模式画布参与世界层拦截（`__dsWorldUI` 分流 + 主相机射线检测）。面板要挡身后点击：给带背景节点写 `hit-test: block`（先例 building_info `.Card`；详见 doc/engine/physics_system.md 踩坑 8）。
5. **排序**：树内 zOrder → renderOrder 照旧；跨面板/粒子按 three 透明排序（距离）——world 面板量小可接受，约定面板 `zOrder` 保持低位避免压过粒子。

### D4：拒绝 render-to-texture 路线（明确否决）

UI 本来就是 mesh + CanvasTexture，"世界空间"只需换场景换相机；RT 路线徒增离屏 pass、mip 采样模糊、ray→UV 逆映射三重成本，收益为零。**唯一需要 RT/第二视口的场景**（面板里渲染 3D 画面，如全息小地图）明确出非目标，另立专项。

### D5：资产与编译器——零新标签，走 data-comp 通道

- 声明式：`.widget.html` 根节点 `data-comp="UIWorldAnchorComponent" data-props='{"mode":"screen","localOffset":[0,2.2,0]}'`（既有 `data-comp` 逃逸通道，编译器只加白名单登记）；动态创建走 `spawnAnchoredWidget` API。
- assetLint 新增 warn：world 模式根禁用 `anchor`（位姿由锚定系统接管）；screen 模式根同样应 `anchor: null`。
- 作者心智不变：仍按 1920×1080 画设计稿；world 模式只是多一个"200px = 1m"的换算口诀。

### D6：设计准则（与引擎机制一一对应）

- **上下文可见性**：血条满血隐藏、受击浮现、5s 后淡出（TweenSystem 现成）；屏幕层锚定 UI 同屏设上限（≤10 量级起步），超限按距离/优先级淘汰——反模式"永远显示一切"在性能与可读性上双输。
- **可读性**：名牌/血条 `constantScreenSize=true` 保证最远可辨；文字对比用 `UIText.shadowColor/shadowBlur`（引擎无 outline）；敌我用"颜色+形状+文字"冗余编码，不裸靠颜色。
- **伤害数字**：池化、同屏 5-6 个上限、快速连击聚合；`DamageNumberFx` 升级 `showAtWorld(world, worldPos, value)`（内部改走锚定组件），旧 UI 坐标 API 保留兼容。
- **diegetic 克制**：世界面板同屏 1-2 个；高频查阅数据（资源/任务）仍留 HUD——世界面板服务沉浸，不承担数据面板职责。
- **安全区**：clamp/indicator 的边距取 5% 内缩。

## 四、落地顺序

| 阶段 | 内容 | 交付判据 |
|---|---|---|
| **P0 前置清理**（可与 v2 收尾合并） | 清 v2 米制残留：`LootFlyFx.ts:27-28` 半画布常数、`UITransformComponent.ts:57-58` 缺省 5/2.5、UIScrollList 滚动条米值；新增 `UICamera.projectToUi` | v2 单位一元化全绿 + 投影工具有单测 |
| **P1 screen 跟随 MVP** | `UIWorldAnchorComponent(mode=screen)` + 锚定 tick + 池 + `spawnAnchoredWidget`；fish 首个用例：建筑/单位头顶血条或采集点交互提示；`DamageNumberFx.showAtWorld` | e2e：移动相机断言投影 px 命中、背面剔除、出屏钳制 |
| **P2 world 面板** | `isUIActor` 第三分支 + clickable 切 world + billboard + pxPerMeter/pixelDensity；fish 用例：基地核心全息面板（barracks_ui 的 3D 版对照） | e2e：遮挡命中、面板按钮 world 射线点击、billboard 朝向 |
| **P3 打磨** | occlusion fade、off-screen indicator（箭头）、距离 LOD、同屏上限、编辑器（场景大纲选中 + SelectionBoundsGizmo 对世界 widget 生效、lint 规则） | test-cases 全绿 |

## 五、风险与对策

- **v2 双轨期叠加**：单位一元化未收尾前本方案不动工（`projectToUi` 的半画布常数、pxPerMeter 基准都依赖 px 语义落地）——P0 即闸门。
- **每帧成本结构**：投影 O(n) 便宜，真正贵的是 canvas 纹理数量（每个锚定 widget = 数个 draw call）→ 池 + 同屏上限 + `maxDistance` LOD 三板斧；伤害数字禁用独立画布背景（纯 troika 文字最省）。
- **背面投影镜像**：相机背后的点投影会镜像翻转到屏内，`projectToUi` 必须以 NDC z/w 判定剔除——单测覆盖。
- **透明排序**：world 面板 vs 粒子/特效的 renderOrder 冲突，约定面板 zOrder 低位 + 验收用例覆盖；确需精细控制再引入 `depthWrite` 策略，本期不做。
- **编辑器心智**：`UIPreviewManager` 保持 2D 正面设计视图（设计态本就该看版式）；world 模式的真实观感（透视/遮挡/尺度）只能在场景视口确认——文档明示，避免"预览不像"被当 bug 报。
