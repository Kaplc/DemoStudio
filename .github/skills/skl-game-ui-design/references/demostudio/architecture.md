# DemoStudio UI 架构速览（适配参考）

> 本文件是 `game-ui-design` skill 在 DemoStudio 项目内工作的**架构地图**：组件体系、资产格式、渲染排序与生命周期。
> 设计建议必须落回到本文件描述的机制上，否则无法实现。

## 1. 组件体系（src/engine/ui/ + src/engine/rendering/）

| 组件 | 职责 | 关键 properties |
|---|---|---|
| `UITransformComponent` | 布局变换（**尺寸权威**） | `position` / `rotation` / `scale`、`worldWidth` / `worldHeight`、`anchor` / `anchorOffset` |
| `CanvasUIComponent` | 像素画布/面板渲染（CanvasTexture） | `width` / `height`、`markerOnly`、`zOrder`、`active`（节点显隐）、`doubleSided` |
| `UITextComponent` | 矢量文本（troika-three-text） | `text`、`fontSize`、`color`、`bold` / `italic`、`align`、`lineHeight`、`letterSpacing`、`shadowColor` / `shadowBlur`、`width` / `height`、`zOrder` |
| `UIImageComponent` | 图片/圆角矩形 | `color`、`radius`、`opacity`、`src`、`width` / `height`、`zOrder` |
| `UIButtonComponent` | **纯交互**（不渲染背景） | `colors.normal` / `hover` / `pressed` |
| `UIScriptComponent` | 挂行为脚本 | `script`（id 如 `gameplay/base/BaseHud`）、`args` |
| `UILayoutComponent` | 布局组件 | — |

**关键规则**：
- `UITransformComponent` 是尺寸/位置唯一权威；控件世界尺寸写 `worldWidth`/`worldHeight`
- 按钮背景由同 Actor 的 `UIImageComponent` 渲染（Unity Button.targetGraphic 模式），文字由**独立子 Actor** 挂 `UITextComponent`
- 节点显隐统一由 `CanvasUIComponent.active` 控制（级联子树），UIText/UIImage 不消费 active

## 2. 资产格式（.widget.json）

### 根结构（标准三件套）
```json
{
  "name": "XxxWidget",
  "baseClass": "Actor",
  "components": [
    { "baseClass": "UITransformComponent", "properties": { "worldWidth": 9.6, "worldHeight": 5.4, "anchor": null } },
    { "baseClass": "CanvasUIComponent", "properties": { "width": 1920, "height": 1080, "name": "Canvas", "zOrder": 0, "active": true } },
    { "baseClass": "UIScriptComponent", "properties": { "script": "gameplay/base/XxxHud" } }
  ],
  "children": []
}
```
- 根画布：像素 1920×1080 ↔ 世界 9.6×5.4（比例一致）
- `UIScriptComponent` 可选，`script` id 必须对应 `src/projects/<project>/gameplay/**/*.script.ts`

### 控件节点（标准四件套）
```json
{
  "name": "StartBtn", "baseClass": "Actor", "id": 10004,
  "components": [
    { "baseClass": "UITransformComponent", "properties": { "anchor": "center", "anchorOffset": [0, 0], "worldWidth": 2.45, "worldHeight": 0.4 } },
    { "baseClass": "CanvasUIComponent", "properties": { "markerOnly": true, "name": "UIMarker", "zOrder": 0 } },
    { "baseClass": "UIImageComponent", "properties": { "zOrder": 3, "color": "#ff6f00", "radius": 24, "width": 512, "height": 128 } },
    { "baseClass": "UIButtonComponent", "properties": { "colors": { "normal": "#ff6f00", "hover": "#ffab00", "pressed": "#c44000" } } }
  ],
  "children": [ /* 文字子 Actor：UITransform + CanvasUI(markerOnly) + UITextComponent */ ]
}
```
- 每个控件节点必须含 `CanvasUIComponent`（`markerOnly: true`，`name: "UIMarker"`）
- `id` 全文件唯一（10000 起步）、`name` 全文件唯一（AI 定位控件靠 name）

### 资产注册
- 路径 `src/projects/<project>/asset/blueprints/ui/*.widget.json` 由 `import.meta.glob` 自动注册，**无需写 path 字段**
- 运行时动态 UI：`world.ui.spawnUIActor('asset/blueprints/ui/xxx.widget.json')`

## 3. 锚点系统（九宫格）

| 类别 | 取值 | 语义 |
|---|---|---|
| 单点锚（9 个） | `top-left` / `top-center` / `top-right` / `middle-left` / `middle-center` / `center` / `middle-right` / `bottom-left` / `bottom-center` / `bottom-right` | 元素中心对齐父容器九宫格参考点，**边缘不溢出容器** |
| 全锚 | `stretch` | 填满父容器（背景/面板铺满） |
| 无锚点 | `null` | 沿用 `position`（普通 3D 语义，根画布用） |

- 锚点元素偏移写 `anchorOffset`（写 position 会被 applyAnchor 覆盖）
- 父容器尺寸变化 → 子元素自动跟随（视口比例切换自适应）
- **响应式设计**：屏幕角落 UI 用 `top-left`/`top-right`/`bottom-left`/`bottom-right` + `anchorOffset` 内缩实现安全区

## 4. 渲染排序与层级（zOrder）

three.js 透明物体按 `groupOrder → renderOrder → material.id → z → id` 排序：

- **`zOrder` = renderOrder**：数值越大越靠前（绘制越晚）
- `CanvasUIComponent.zOrder` → `panel.renderOrder` + `panel.position.z = v*0.001`
- `UITextComponent.zOrder` → `mesh.renderOrder` + `mesh.position.z = v*0.001+0.0002`（+0.0002 防 z-fighting，**文字永远盖同层图片**）
- **跨层穿透防护**：运行中动态生成的浮动面板（暂停菜单/地图面板等）由 `UIManager` 自动整树 `zOrder += 100`（`FLOAT_LAYER_BIAS`），保证盖住静态 HUD（0~4 区间）

**项目内 zOrder 惯例**：
| zOrder | 用途 |
|---|---|
| 0 | 面板/背景容器、UIMarker |
| 1 | 次级元素（图标底、装饰） |
| 2 | 文本（按钮文字等） |
| 3 | 按钮背景图片（UIImage 高 zOrder 盖在面板上） |
| 4 | 高优先级文本 |
| +100（浮动层） | 动态生成的面板（暂停/地图/建筑菜单） |

## 5. 生命周期与运行机制

- `GameMode.HUDClass` → 切场景时 `ui.destroyAll()` 后 `ui.createHUD(hudClass)` 重建
- `UIScriptComponent.BeginPlay` 时按 `script` id 实例化 BehaviourScript；脚本内按控件 name 取引用（如 `actor.findChildByName('Btn_map')`）
- UI 点击：`ClickableComponent.layer === 'ui'` → UI 相机平行射线，命中即消费，不下发 Controller
- UI Actor 生命周期独立于 `World.allActors`，由 `UIManager` 管理（勿直接 DestroyAllActors 清 UI）
- 编辑器预览：`UIPreviewManager` 2D 正面预览 + assetLint 校验（**新资产必须零 lint 错误**）

## 6. 与游戏 UI 设计原则的映射要点

| 通用原则 | DemoStudio 落点 |
|---|---|
| 安全区（TV 裁切） | `anchor` 用边角锚 + `anchorOffset` 内缩 5%；根画布 1920×1080 四周留边 |
| 响应式缩放 | 锚点系统天然自适应；避免绝对 `position` 摆死坐标 |
| HUD 层级 | zOrder 惯例表（0 底 → 4 顶，浮动面板 +100） |
| 文字可读性 | `UITextComponent.shadowColor` + `shadowBlur`（引擎无 outline，用阴影做对比）；`bold: true` 加粗 |
| 按钮状态 | `UIButtonComponent.colors.normal/hover/pressed`（引擎无 focus/disabled，用 `active` 控制显隐） |
| 动态面板不穿透 | 交给 `FLOAT_LAYER_BIAS` 机制，无需手改 zOrder |
| 节点显隐 | `CanvasUIComponent.active`（级联子树） |
