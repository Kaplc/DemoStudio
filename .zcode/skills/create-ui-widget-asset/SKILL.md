---
name: create-ui-widget-asset
description: '创建 DemoStudio UI widget 资产（.widget.json，UI 蓝图）。使用时机：用户要求新建/编辑 UI 面板资产，如 "创建一个 HUD"、"写主菜单 UI"、"添加一个按钮/文本/图片控件"、"widget 里挂脚本"。规则与资产检查器（assetLint）+ UI 组件系统（UITransform/CanvasUI/UIText/UIImage/UIButton/UIScript）一致，创建的资产必须零 lint 错误且能在 UIPreviewManager 中正确预览。'
argument-hint: 'widget 名称或 UI 面板用途描述'
---

# 创建 UI widget 资产（.widget.json）

## 何时使用
- 用户要求新建 UI 资产文件（`asset/blueprints/ui/**/*.json`，命名 `<描述>.widget.json`）
- 修改现有 widget 的控件树（面板、按钮、文本、图片）
- widget 是 **UI 专用蓝图**：与普通蓝图同结构（也是 `name` + `baseClass`），但使用 UI 组件体系，由 UIPreviewManager 做 2D 正面预览

## 文件位置与命名
- 路径：`src/projects/<project>/asset/blueprints/ui/<描述>.widget.json`
- 命名：`<描述>.widget.json`（如 `main_menu.widget.json`、`base_hud.widget.json`、`barracks_ui.widget.json`）
- 由 `asset/index.ts` 的 `import.meta.glob(['./blueprints/**/*.blueprint.json', './blueprints/ui/**/*.json'])` **自动注册**（ui 目录下 .json 也收录），注册 key 从路径推导，**无需写 path 字段**

## widget 根结构
```json
{
  "name": "FishMainMenu",
  "baseClass": "Actor",
  "components": [
    {
      "baseClass": "UITransformComponent",
      "properties": {
        "position": [0, 0, 0],
        "rotation": [0, 0, 0],
        "scale": [1, 1, 1],
        "worldWidth": 9.6,
        "worldHeight": 5.4,
        "anchor": null,
        "anchorOffset": [0, 0]
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
    },
    {
      "baseClass": "UIScriptComponent",
      "properties": {
        "script": "gameplay/base/MainMenu"
      }
    }
  ],
  "children": []
}
```

根组件组合（标准三件套）：
1. **`UITransformComponent`** — 根画布世界尺寸 `worldWidth`/`worldHeight`（如 9.6×5.4），`anchor: null`
2. **`CanvasUIComponent`** — 像素画布 `width`/`height`（如 1920×1080），`name: "Canvas"`，`active: true`，`zOrder: 0`
3. **`UIScriptComponent`**（可选）— 挂载行为脚本 `script`（id 由 `gameplay/**/*.script.ts` 自动扫描注册，如 `gameplay/base/BaseHud`），`args` 可选启动参数

## ⚠️ UI Actor 约定（每个控件节点必须遵守）

每个 UI 控件 = 一个 `baseClass: "Actor"` 的子节点，标准组件组合：

```
Actor (name 唯一, id 唯一)
├── UITransformComponent   — 定位 + 尺寸（anchor/anchorOffset/worldWidth/worldHeight）
├── CanvasUIComponent      — markerOnly: true, name: "UIMarker"（标记画布，不实际渲染）
└── 功能组件                — UITextComponent / UIImageComponent / UIButtonComponent（三选一或组合）
```

### 控件节点示例（带按钮的文本）
```json
{
  "name": "StartBtn",
  "baseClass": "Actor",
  "id": 10004,
  "components": [
    {
      "baseClass": "UITransformComponent",
      "properties": {
        "position": [0, 0, 0],
        "rotation": [0, 0, 0],
        "scale": [1, 1, 1],
        "anchor": "center",
        "anchorOffset": [0, 0],
        "worldWidth": 2.45,
        "worldHeight": 0.4
      }
    },
    {
      "baseClass": "CanvasUIComponent",
      "properties": {
        "markerOnly": true,
        "name": "UIMarker",
        "zOrder": 0
      }
    },
    {
      "baseClass": "UIImageComponent",
      "properties": {
        "zOrder": 3,
        "color": "#ff6f00",
        "radius": 24,
        "width": 512,
        "height": 128,
        "name": "StartBtn"
      }
    },
    {
      "baseClass": "UIButtonComponent",
      "properties": {
        "name": "StartButton"
      }
    }
  ],
  "children": [
    {
      "name": "StartBtnText",
      "baseClass": "Actor",
      "id": 10005,
      "components": [
        {
          "baseClass": "UITransformComponent",
          "properties": {
            "position": [0, 0, 0],
            "rotation": [0, 0, 0],
            "scale": [1, 1, 1],
            "anchor": "center",
            "anchorOffset": [0, 0],
            "worldWidth": 3.06,
            "worldHeight": 0.89
          }
        },
        {
          "baseClass": "CanvasUIComponent",
          "properties": {
            "markerOnly": true,
            "name": "UIMarker",
            "zOrder": 0
          }
        },
        {
          "baseClass": "UITextComponent",
          "properties": {
            "text": "开始游戏",
            "fontSize": 32,
            "color": "#ffffff",
            "bold": true,
            "align": "center",
            "shadowColor": "rgba(0,0,0,0.4)",
            "shadowBlur": 4,
            "width": 512,
            "height": 128,
            "zOrder": 3,
            "name": "StartBtnText"
          }
        }
      ],
      "children": []
    }
  ]
}
```

## ⚠️ 关键约定（违反即 error）

1. **组件优先约定**：位置/旋转/缩放**必须**写在 `UITransformComponent`（或 TransformComponent）properties；顶层 `position`/`rotation`/`scale` 废弃 → error
2. **id 唯一**：同文件内所有节点 `id` 唯一（10000 起步递增）
3. **name 唯一**：同资产内所有节点 `name` 唯一（AI 按 name 定位控件：`ai.clickActor` / `ai.dragActor` / `ai.selectActor`；UIScriptComponent 也按 name 查找控件）
4. **position 只允许在变换组件**：其他组件 properties 出现 `position`/`rotation`/`scale` → error
5. **显隐控制**：UI 节点显隐由 `CanvasUIComponent.active` 统一控制（节点级级联到子树），UIText/UIImage 不消费 active
6. **按钮纯交互**：`UIButtonComponent` 只提供交互（状态机 + 点击回调 + 按下缩放），**无任何视觉属性**——BeginPlay 自动生成透明点击层（命中区域 = uitransform 世界尺寸，与子节点无关）；视觉背景由**子节点 Frame** 挂 `UIImageComponent` 提供（**编辑器「创建按钮」模板即此结构：Button 节点只挂 UIButton，子节点 Frame 挂 UIImage**），颜色变化由脚本/Inspector 直接改 image；按钮文字由**独立子 Actor** 挂 UITextComponent 提供
7. **同一节点最多一个 `UIImageComponent`**：UIButton 的透明点击层由**运行时自动生成**（`isClickOnly`，编辑器保存/预览不会把它写进资产），资产显式声明第二份 image 即冗余 → `duplicate-image-component` error
8. **颜色格式**：CSS hex 或 rgba()

## 组件 properties 校验规则（comp:* 检查器）

### UITransformComponent
| 属性 | 类型 | 规则 |
|------|------|------|
| `position` / `rotation` / `scale` | vec3 | 变换 |
| `worldWidth` / `worldHeight` | number | 世界尺寸，必须 > 0 |
| `anchor` | string | 枚举：`top-left`/`top-center`/`top-right`/`middle-left`/`middle-center`/`center`/`middle-right`/`bottom-left`/`bottom-center`/`bottom-right`/`stretch`（根画布用 `null`） |
| `anchorOffset` | vec2 | 锚点偏移（有 anchor 的节点，位置偏移写这里而非 position） |
| `name` | string | 可选 |

> 锚点语义：锚点节点拖动时偏移持久化到 `anchorOffset`（applyAnchor 重建会覆盖 position），无锚点节点才改 `position`。

### CanvasUIComponent
| 属性 | 类型 | 规则 |
|------|------|------|
| `width` / `height` | number | 像素尺寸，≥ 1（根画布如 1920×1080） |
| `markerOnly` | boolean | 控件节点为 `true`（仅标记，不渲染） |
| `doubleSided` | boolean | 可选 |
| `zOrder` | number | UI 层级（越大越靠前） |
| `active` | boolean | 节点级显隐开关 |
| `name` | string | 可选 |

### UITextComponent
| 属性 | 类型 | 规则 |
|------|------|------|
| `text` | string | 文本内容 |
| `fontSize` | number | ≥ 1 |
| `fontFamily` | string | 可选 |
| `color` | color | 可选 |
| `bold` / `italic` | boolean | 可选 |
| `align` | string | `left` / `center` / `right` |
| `lineHeight` | number | 行高系数（fontSize 的倍数，如 `1.4` = 字号 × 1.4；> 0；内部 ×100 存储） |
| `letterSpacing` | number | ≥ 0 |
| `shadowColor` / `shadowOffsetX` / `shadowOffsetY` | color/number | 阴影（`shadowBlur` ≥ 0） |
| `width` / `height` | number | Canvas 像素尺寸，≥ 1 |
| `zOrder` | number | UI 层级 |
| `name` | string | 可选 |

### UIImageComponent
| 属性 | 类型 | 规则 |
|------|------|------|
| `color` | color | 填充色 |
| `radius` | number | 圆角，≥ 0 |
| `opacity` | number | [0,1] |
| `src` | string | 图片源（可选） |
| `width` / `height` | number | ≥ 1 |
| `zOrder` | number | 层级 |
| `name` | string | 可选 |

### UIButtonComponent
`pressScale`（number，可选，默认 0.92）：按下缩放比例（≥1 或 ≤0 关闭）；`name`（string，可选）。纯交互组件：不驱动任何颜色，视觉归同 Actor/子节点的 UIImageComponent

### UIScriptComponent
| 属性 | 类型 | 规则 |
|------|------|------|
| `script` | string | 脚本 id（`gameplay/...`，如 `gameplay/base/BaseHud`），必须存在对应 `.script.ts` |
| `args` | object | 脚本启动参数（可选） |
| `name` | string | 可选 |

## 创建步骤
1. 确认 widget 名（name 唯一）与像素画布尺寸（常见 1920×1080，世界 9.6×5.4）
2. 写根三件套：UITransformComponent（世界尺寸）+ CanvasUIComponent（像素尺寸 + active: true）+ 可选 UIScriptComponent
3. 设计控件树（每节点 = 4 件套：UITransform + CanvasUI(markerOnly) + 功能组件 [+ 子控件]）
4. 分配唯一 id（10000 起步）与唯一 name
5. 有锚点的控件写 `anchor` + `anchorOffset`，无锚点才用 `position`
6. 按钮：挂 UIButton（纯交互），背景用同节点/子节点 UIImage，文字用子 Actor 挂 UIText
7. 需要交互逻辑时在根挂 UIScriptComponent（script id 必须真实存在）

## 完成检查（对照资产检查器）
- [ ] 根含 `UITransformComponent`（worldWidth/worldHeight > 0）+ `CanvasUIComponent`（width/height ≥ 1, active: true）
- [ ] 每个控件节点含 `CanvasUIComponent`（markerOnly: true, name: "UIMarker"）
- [ ] 无顶层 `position`/`rotation`/`scale`
- [ ] 所有 `id`、`name` 唯一
- [ ] `anchor` 值在枚举内；有 anchor 的节点偏移写在 `anchorOffset`
- [ ] 组件 properties 无 position/rotation/scale（仅变换组件允许）
- [ ] `script` 引用的脚本 id 存在（`src/projects/<project>/gameplay/**/*.script.ts`）
- [ ] 数值/枚举/颜色符合组件 schema

## 参考
- 组件实现：`src/engine/ui/UITransformComponent.ts`、`src/engine/ui/UITextComponent.ts`、`src/engine/ui/UIImageComponent.ts`、`src/engine/ui/UIButtonComponent.ts`、`src/engine/ui/UIScriptComponent.ts`、`src/engine/rendering/CanvasUIComponent.ts`
- 检查器：`src/editor/asset/assetLint/checkers/componentChecker.ts`
- 预览：`src/editor/asset/UIPreviewManager.ts`（widget 2D 预览 + 保存回写）
- 现有示例：`src/projects/fish/asset/blueprints/ui/main_menu.widget.json`、`base_hud.widget.json`、`barracks_ui.widget.json`
