---
name: create-blueprint-asset
description: '创建 DemoStudio 蓝图资产（.blueprint.json）。使用时机：用户要求新建/编辑蓝图资产文件，如 "创建一个房屋蓝图"、"写 beach house 的 blueprint"、"蓝图里加子 Actor/组件"、"引用另一个蓝图"。规则与资产检查器（assetLint doc:blueprint / node / comp）一致，创建的资产必须零 lint 错误。'
argument-hint: '蓝图名称或蓝图用途描述'
---

# 创建蓝图资产（.blueprint.json）

## 何时使用
- 用户要求新建蓝图资产文件（`asset/blueprints/**/*.blueprint.json`）
- 修改现有蓝图的 `components` / `children`（子 Actor、组件、引用）
- 蓝图由 `asset/index.ts` 的 `import.meta.glob('./blueprints/**/*.blueprint.json')` **自动注册**，注册 key 从文件路径推导（`asset/...`），**JSON 内无需写 path 字段**

## 文件位置与命名
- 路径：`src/projects/<project>/asset/blueprints/**/*.blueprint.json`（如 `asset/blueprints/beach_house.blueprint.json`、`asset/blueprints/buildings/townhall.blueprint.json`）
- 命名：`<描述>.blueprint.json`（snake_case）
- 一个 Blueprint = "这个 Actor 子类默认长什么样"（对应 Unity Prefab / UE Blueprint Class 的类定义 + CDO 默认值），可被场景 `ref` 节点或其他蓝图 `ref` 引用

## 蓝图根结构（doc:blueprint 检查器规则）
```json
{
  "name": "BeachHouse",
  "baseClass": "Actor",
  "components": [
    {
      "baseClass": "TransformComponent",
      "properties": {
        "position": [0, 0, 0],
        "rotation": [0, 0, 0],
        "scale": [1, 1, 1]
      }
    }
  ],
  "children": []
}
```

| 字段 | 类型 | 必填 | 规则 |
|------|------|------|------|
| `name` | string | ✅ | 蓝图显示名 |
| `baseClass` | string | ✅ | ActorRegistry key，如 `Actor`、`FishHouse`（TS Actor 子类） |
| `components` | array | ✅ | 根级组件列表 |
| `children` | array | ✅ | 子 Actor 列表（可为空数组） |

> 蓝图根**禁止**顶层 `position`/`rotation`/`scale`（组件优先约定，旧格式已废弃 → error）。

## children 子节点结构
每个子节点（BlueprintChildDef）：

| 字段 | 类型 | 规则 |
|------|------|------|
| `name` | string | 可选，具名子节点用于继承链合并定位；**同资产内必须唯一** |
| `baseClass` | string | 与 `ref` **二选一**（互斥，都写/都不写 → error） |
| `ref` | string | 引用蓝图路径，格式 `asset/.../*.blueprint.json`；与 baseClass 互斥 |
| `id` | number | **必填**（检查器要求），本文件内唯一（重复 → `duplicate-child-id` error） |
| `components` | array | 子节点组件列表 |
| `children` | array | 递归嵌套子 Actor |
| `overrides` | object | 实例级属性覆盖（仅 ref 引用时有效） |
| `_remove` | boolean | 变体继承时：true = 从父级移除该具名子节点 |
| `position`/`rotation`/`scale` | vec3 | ⚠️ **已废弃**，见下方约定 |

### 引用子蓝图示例（ref）
```json
{
  "name": "MainHouse",
  "id": 20001,
  "components": [
    {
      "baseClass": "TransformComponent",
      "properties": {
        "position": [0, 0, 0.57],
        "rotation": [0, 0, 0],
        "scale": [1, 1, 1]
      }
    }
  ],
  "children": [],
  "ref": "asset/blueprints/beach_house.blueprint.json"
}
```

### 内联子 Actor 示例（baseClass）
```json
{
  "name": "Foundation",
  "baseClass": "Actor",
  "id": 10001,
  "components": [
    {
      "baseClass": "TransformComponent",
      "properties": {
        "position": [0, 0.3, 0],
        "rotation": [0, 0, 0],
        "scale": [1, 1, 1]
      }
    },
    {
      "baseClass": "MeshComponent",
      "properties": {
        "geometry": "box",
        "size": [2.4, 0.15, 2.4],
        "color": "#a67c52",
        "name": "FoundationMesh"
      }
    }
  ],
  "children": []
}
```

## ⚠️ 关键约定（违反即 error）

1. **组件优先约定**：位置/旋转/缩放**必须**写在 `TransformComponent`/`UITransformComponent` 组件的 `properties` 里。
   - 根或子节点带顶层 `position`/`rotation`/`scale` → `top-transform-forbidden` error（"位置必须写在变换组件，请删除顶层字段"）
   - 无变换组件却声明顶层 transform → `missing-transform-component` error
   - `position`/`rotation`/`scale` 出现在非变换组件 properties → `comp-forbidden-transform` error
2. **id 唯一**：根 id（若有）+ 所有子节点 id 在**同一文件内**唯一
3. **name 唯一**：同资产内所有节点 `name` 唯一（AI 按 name 定位，重复 → `duplicate-name` error）
4. **ref/baseClass 互斥**：子节点必须且只能指定其一（`child-missing-type` / `child-bp-ref-conflict` error）
5. **ref 路径格式**：`asset/.../*.blueprint.json`（`ref-invalid-path` error）
6. **颜色格式**：CSS hex 或 rgba()

## 组件 properties 校验规则（comp:* 检查器）

### TransformComponent
`position` / `rotation` / `scale`（vec3）+ `name`（可选）

### MeshComponent
| 属性 | 类型 | 规则 |
|------|------|------|
| `geometry` | string | 枚举 `box` / `sphere` / `plane` |
| `size` | array | 1~3 元素（box→[w,h,d]，sphere→[radius]，plane→[w,h]） |
| `color` | color | 可选 |
| `opacity` | number | [0,1] |
| `name` | string | 可选 |

### SpriteComponent
`width`/`height` **必填 > 0**；`opacity` [0,1]；`color`；`name`

### CameraComponent
`mode`（perspective/orthographic）；`fov` [1,170]；`orthoSize` > 0；`near`/`far` > 0；`priority`（integer）

### ClickableComponent
`clickCooldown` ≥ 0

### TroikaTextComponent
`text`；`fontSize` > 0；`color`；`maxWidth` > 0；`textAlign`（left/center/right）；`outlineWidth` ≥ 0；`outlineColor`

### 其他组件（无强 schema 校验）
- `LightComponent`：`type`/`color`/`intensity`/`castShadow`/`position` 等
- `InputComponent` / `SpawnComponent` / `LineComponent`：构造即用，不进 props
- UI 组件（UITransform/CanvasUI/UIText/UIImage/UIButton/UIScript）——请用 `create-ui-widget-asset` skill（UI 资产专用规则）

## 创建步骤
1. 确认蓝图名（name 唯一）与 `baseClass`（ActorRegistry 已注册的类型）
2. 设计组件组合（根级 TransformComponent 必带；渲染组件按需）
3. 设计 children 树：内联子 Actor 用 `baseClass`，复用其他蓝图用 `ref`
4. 分配唯一 `id`（建议按 10000 起步递增，或按蓝图分组如 10001/20001/30001）
5. 检查：顶层 transform 已删、id/name 唯一、ref 路径正确

## 完成检查（对照资产检查器）
- [ ] 根含 `name`、`baseClass`、`components`、`children`
- [ ] 无任何顶层 `position`/`rotation`/`scale`
- [ ] 所有子节点有 `id` 且唯一；`name` 唯一
- [ ] 每个子节点恰好有 `ref` 或 `baseClass` 之一
- [ ] `ref` 路径以 `asset/` 开头、以 `.blueprint.json` 结尾
- [ ] 组件 properties 无 `position`/`rotation`/`scale`（仅限变换组件）
- [ ] 数值/枚举/颜色符合组件 schema

## 参考
- 类型定义：`src/engine/asset/BlueprintAsset.ts`（含继承链 resolve 逻辑）
- 检查器：`src/editor/asset/assetLint/checkers/docCheckers.ts`、`componentChecker.ts`
- 现有示例：`src/projects/fish/asset/blueprints/foundation.blueprint.json`（内联）、`beach_house_luxury.blueprint.json`（ref 引用）、`buildings/townhall.blueprint.json`
