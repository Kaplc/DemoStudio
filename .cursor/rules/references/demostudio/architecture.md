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
| `UIButtonComponent` | **纯交互**（不渲染背景、不驱动颜色） | `pressScale`（按下缩放，默认 0.92） |
| `UIScriptComponent` | 挂行为脚本 | `script`（id 如 `gameplay/base/BaseHud`）、`args` |
| `UILayoutComponent` | 布局组件 | — |

**关键规则**：
- `UITransformComponent` 是尺寸/位置唯一权威；控件世界尺寸写 `worldWidth`/`worldHeight`
- 按钮是纯交互：BeginPlay 自动生成透明点击层（命中 = uitransform 尺寸矩形，与子节点无关）；视觉背景由同 Actor 的 `UIImageComponent` 或子节点提供
- 节点显隐统一由 `CanvasUIComponent.active` 控制（级联子树）

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
    { "baseClass": "UIButtonComponent", "properties": { "name": "StartButton" } }
  ],
  "children": []
}
```

## 3. 锚点系统（九宫格）

| 类别 | 取值 | 语义 |
|---|---|---|
| 单点锚（9 个） | `top-left` / `top-center` / `top-right` / `middle-left` / `center` / `middle-right` / `bottom-left` / `bottom-center` / `bottom-right` | 元素中心对齐父容器九宫格参考点 |
| 全锚 | `stretch` | 填满父容器 |
| 无锚点 | `null` | 沿用 `position`（根画布用） |

- 锚点元素偏移写 `anchorOffset`（写 position 会被 applyAnchor 覆盖）
- 父容器尺寸变化 → 子元素自动跟随

## 4. 渲染排序与层级（zOrder）

| zOrder | 用途 |
|---|---|
| 0 | 面板/背景容器、UIMarker |
| 1 | 次级元素（图标底、装饰） |
| 2 | 文本（按钮文字等） |
| 3 | 按钮背景图片 |
| 4 | 高优先级文本 |
| +100 | 动态生成的面板（浮动层） |

## 5. 生命周期与运行机制

- `GameMode.HUDClass` → 切场景时 `ui.destroyAll()` 后 `ui.createHUD(hudClass)` 重建
- UI Actor 生命周期由 `UIManager` 管理（勿直接 DestroyAllActors 清 UI）
- 编辑器预览：`UIPreviewManager` 2D 预览 + assetLint 校验
