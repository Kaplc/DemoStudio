# DemoStudio UI 架构速览（适配参考）

> 本文件是 `game-ui-design` skill 在 DemoStudio 项目内工作的**架构地图**

## 1. 组件体系

| 组件 | 职责 | 关键 properties |
|---|---|---|
| `UITransformComponent` | 布局变换（**尺寸权威**） | `worldWidth`/`worldHeight`、`anchor`/`anchorOffset` |
| `CanvasUIComponent` | 像素画布/面板渲染 | `width`/`height`、`markerOnly`、`zOrder`、`active` |
| `UITextComponent` | 矢量文本 | `text`、`fontSize`、`color`、`shadowColor`/`shadowBlur` |
| `UIImageComponent` | 图片/圆角矩形 | `color`、`radius`、`opacity`、`width`/`height` |
| `UIButtonComponent` | **纯交互** | `pressScale`（按下缩放，默认 0.92） |
| `UIScriptComponent` | 挂行为脚本 | `script`（id）、`args` |

**关键规则**：
- `UITransformComponent` 是尺寸/位置唯一权威
- 按钮是纯交互：视觉背景由 UIImageComponent 提供
- 节点显隐统一由 `CanvasUIComponent.active` 控制

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

### 控件节点（标准四件套）
```json
{
  "name": "StartBtn", "baseClass": "Actor", "id": 10004,
  "components": [
    { "baseClass": "UITransformComponent", "properties": { "anchor": "center", "worldWidth": 2.45, "worldHeight": 0.4 } },
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
| 单点锚 | `top-left`/`center`/`bottom-right` 等 | 元素中心对齐父容器九宫格参考点 |
| 全锚 | `stretch` | 填满父容器 |
| 无锚点 | `null` | 沿用 position |

## 4. zOrder 惯例

| zOrder | 用途 |
|---|---|
| 0 | 面板/背景容器、UIMarker |
| 1 | 次级元素 |
| 2 | 文本 |
| 3 | 按钮背景图片 |
| 4 | 高优先级文本 |
| +100 | 动态面板（浮动层） |
