---
name: skl-create-blueprint-asset
description: 创建 DemoStudio 蓝图资产（.blueprint.json）。使用时机：用户要求新建/编辑蓝图资产文件，如"创建一个房屋蓝图"、"写 beach house 的 blueprint"、"蓝图里加子 Actor/组件"、"引用另一个蓝图"。规则与资产检查器一致，创建的资产必须零 lint 错误。
---

# 创建蓝图资产（.blueprint.json）

## 何时使用
- 用户要求新建蓝图资产文件（`asset/blueprints/**/*.blueprint.json`）
- 修改现有蓝图的 `components` / `children`（子 Actor、组件、引用）
- 蓝图由 `asset/index.ts` 的 `import.meta.glob` **自动注册**，注册 key 从文件路径推导

## 文件位置与命名
- 路径：`src/projects/<project>/asset/blueprints/**/*.blueprint.json`
- 命名：`<描述>.blueprint.json`（snake_case）

## 蓝图根结构

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
| `baseClass` | string | ✅ | ActorRegistry key |
| `components` | array | ✅ | 根级组件列表 |
| `children` | array | ✅ | 子 Actor 列表 |

> 蓝图根**禁止**顶层 `position`/`rotation`/`scale`（组件优先约定）。

## 组件优先约定

位置/旋转/缩放**必须**写在 `TransformComponent`/`UITransformComponent` 组件的 `properties` 里：
- 根或子节点带顶层 transform → `top-transform-forbidden` error
- 无变换组件却声明顶层 transform → `missing-transform-component` error

## children 子节点结构

| 字段 | 类型 | 规则 |
|------|------|------|
| `name` | string | 可选，同资产内必须唯一 |
| `baseClass` | string | 与 `ref` **二选一** |
| `ref` | string | 引用蓝图路径 `asset/.../*.blueprint.json` |
| `id` | number | **必填**，本文件内唯一 |
| `components` | array | 子节点组件列表 |
| `children` | array | 递归嵌套子 Actor |

## 组件 properties 校验规则

### TransformComponent
`position` / `rotation` / `scale`（vec3）+ `name`（可选）

### MeshComponent
| 属性 | 类型 | 规则 |
|------|------|------|
| `geometry` | string | 枚举 `box` / `sphere` / `plane` |
| `size` | array | 1~3 元素 |
| `color` | color | 可选 |
| `opacity` | number | [0,1] |

### SpriteComponent
`width`/`height` **必填 > 0**；`opacity` [0,1]；`color`

## 完成检查清单
- [ ] 根含 `name`、`baseClass`、`components`、`children`
- [ ] 无任何顶层 `position`/`rotation`/`scale`
- [ ] 所有子节点有 `id` 且唯一；`name` 唯一
- [ ] 每个子节点恰好有 `ref` 或 `baseClass` 之一
- [ ] `ref` 路径以 `asset/` 开头、以 `.blueprint.json` 结尾
