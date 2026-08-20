---
name: skl-create-ui-widget-asset
description: 创建 DemoStudio UI widget 资产（.widget.json，UI 蓝图）。使用时机：用户要求新建/编辑 UI 面板资产，如"创建一个 HUD"、"写主菜单 UI"、"添加一个按钮/文本/图片控件"。规则与 UI 组件系统一致，创建的资产必须零 lint 错误。
---

# 创建 UI widget 资产（.widget.json）

## 何时使用
- 用户要求新建 UI 资产文件（`asset/blueprints/ui/**/*.json`）
- 修改现有 widget 的控件树

## 文件位置与命名
- 路径：`src/projects/<project>/asset/blueprints/ui/<描述>.widget.json`

## widget 根结构

```json
{
  "name": "FishMainMenu",
  "baseClass": "Actor",
  "components": [
    {
      "baseClass": "UITransformComponent",
      "properties": {
        "worldWidth": 9.6,
        "worldHeight": 5.4,
        "anchor": null
      }
    },
    {
      "baseClass": "CanvasUIComponent",
      "properties": {
        "width": 1920,
        "height": 1080,
        "name": "Canvas",
        "zOrder": 0,
        "active": true
      }
    }
  ],
  "children": []
}
```

根组件组合（标准三件套）：
1. **UITransformComponent** — 世界尺寸
2. **CanvasUIComponent** — 像素画布
3. **UIScriptComponent**（可选）— 挂载行为脚本

## UI Actor 约定

每个 UI 控件 = 一个子节点，标准组件组合：
```
Actor (name 唯一, id 唯一)
├── UITransformComponent   — 定位 + 尺寸
├── CanvasUIComponent      — markerOnly: true, name: "UIMarker"
└── 功能组件                — UITextComponent / UIImageComponent / UIButtonComponent
```

## ⚠️ 关键约定

1. **组件优先约定**：transform 写在 UITransformComponent properties
2. **id/name 唯一**：同文件内唯一
3. **按钮纯交互**：UIButtonComponent 只提供交互，视觉由 UIImageComponent 提供
4. **同一节点最多一个 UIImageComponent**

## 组件 properties 校验

### UITransformComponent
| 属性 | 类型 | 规则 |
|------|------|------|
| `worldWidth` / `worldHeight` | number | 必须 > 0 |
| `anchor` | string | 九宫格锚点 |
| `anchorOffset` | vec2 | 锚点偏移 |

### UITextComponent
`text`、`fontSize` > 0、`color`、`shadowColor`/`shadowBlur`

### UIImageComponent
`color`、`radius`、`opacity`、`width`/`height`

## 完成检查
- [ ] 根含 UITransformComponent（worldWidth/worldHeight > 0）+ CanvasUIComponent
- [ ] 每个控件节点含 CanvasUIComponent（markerOnly: true）
- [ ] 无顶层 transform
- [ ] 所有 `id`、`name` 唯一
