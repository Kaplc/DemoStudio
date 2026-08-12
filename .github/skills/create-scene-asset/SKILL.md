---
name: create-scene-asset
description: '创建 DemoStudio 场景资产（.scene.json）。使用时机：用户要求新建/编辑场景资产文件，如 "创建一个新场景"、"写 fish 的场景资产"、"添加场景 objects 节点"、"场景里放一个 actor/ref"。规则与资产检查器（assetLint doc:scene / node:actor / node:ref）一致，创建的资产必须零 lint 错误。'
argument-hint: '场景名称或场景用途描述'
---

# 创建场景资产（.scene.json）

## 何时使用
- 用户要求新建场景资产文件（`asset/*.scene.json`，可含子目录）
- 修改现有场景的 `objects` 数组（加/删/改 Actor、引用蓝图）
- 场景资产由 `asset/index.ts` 的 `import.meta.glob('./**/*.scene.json')` **自动注册**，按 `name` 字段注册到 AssetRegistry，**无需手动注册**

## 文件位置与命名
- 路径：`src/projects/<project>/asset/*.scene.json`（子目录也可，如 `asset/blueprints/beach_house_parts.scene.json`）
- 命名：`<描述>.scene.json`（如 `fish.scene.json`、`fish_menu.scene.json`）
- 按 `name` 字段（非文件名）注册，可通过 `World.SwitchToScene('FishMenu')` 按场景名切换

## 场景根结构（doc:scene 检查器规则）
```json
{
  "name": "MyScene",
  "mode": "game",
  "skybox": {
    "backgroundColor": "#0a2a4a"
  },
  "objects": []
}
```

| 字段 | 类型 | 必填 | 规则 |
|------|------|------|------|
| `name` | string | ✅ | 场景名，注册 key |
| `mode` | string | 可选 | 游戏阶段标识（如 `menu` / `base` / `game`），GameInstance 据此启动对应 GameMode |
| `objects` | array | ✅ 必填非空 | 节点列表，元素为对象 |
| `skybox` | object | 可选 | `backgroundColor`（CSS 颜色）；`skyboxPath`/`skyboxExt`（立方体贴图） |

## objects 节点类型

### 1. `type: "actor"` — 内联 Actor（node:actor）
```json
{
  "type": "actor",
  "name": "plane_1",
  "baseClass": "Actor",
  "components": [
    {
      "baseClass": "TransformComponent",
      "properties": {
        "position": [0, 0, -3],
        "rotation": [0, 0, 0],
        "scale": [1, 1, 1]
      }
    },
    {
      "baseClass": "MeshComponent",
      "properties": {
        "geometry": "box",
        "size": [2, 1, 2],
        "color": "#a67c52"
      }
    }
  ],
  "children": []
}
```

### 2. `type: "ref"` — 引用蓝图资产（node:ref）
```json
{
  "type": "ref",
  "name": "MainHouse",
  "ref": "asset/blueprints/beach_house.blueprint.json"
}
```
- `ref` **必填**，路径格式必须匹配 `^(?:[^/]+\/)?asset\/.+\.blueprint\.json$`（即 `asset/.../*.blueprint.json`，可带 project 前缀）
- 可选：`position`/`rotation`/`scale`（vec3）

## ⚠️ 关键约定（违反即 error）

1. **组件优先约定**：位置/旋转/缩放**必须**写在 `TransformComponent` 组件的 `properties` 里。
   - 顶层 `position`/`rotation`/`scale` 字段已**废弃**——如果节点带 TransformComponent 组件却仍有顶层 transform → `top-transform-forbidden` error；如果无变换组件却声明了顶层 transform → `missing-transform-component` error
   - `position`/`rotation`/`scale` 只允许出现在 TransformComponent/UITransformComponent 组件，出现在其他组件 properties 里 → `comp-forbidden-transform` error
2. **name 唯一**：同一场景内所有节点 `name` 必须唯一（AI 按 name 定位：`ai.clickActor` / `ai.dragActor` / `ai.selectActor`），重复 → `duplicate-name` error
3. **旧格式几何节点已移除**：`type: box/plane/sphere/sprite/checkerFloor/gridLines/pillar/wallRing` 全部废弃，会触发"未注册的检查器" warn——一律用 `type: actor` + MeshComponent/SpriteComponent 替代
4. **颜色格式**：CSS hex（`#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`）或 `rgba(r,g,b,a)`

## 组件 properties 校验规则（comp:* 检查器）

### TransformComponent
| 属性 | 类型 | 规则 |
|------|------|------|
| `position` / `rotation` / `scale` | vec3 | 位置/旋转/缩放（**唯一允许 transform 的组件**） |
| `name` | string | 可选 |

### MeshComponent
| 属性 | 类型 | 规则 |
|------|------|------|
| `geometry` | string | 枚举 `box` / `sphere` / `plane` |
| `size` | array | 1~3 个元素（box→[w,h,d]，sphere→[radius]，plane→[w,h]） |
| `color` | color | 可选 |
| `opacity` | number | [0,1] |

### SpriteComponent
| 属性 | 类型 | 规则 |
|------|------|------|
| `width` / `height` | number | **必填**，必须 > 0 |
| `opacity` | number | [0,1] |
| `color` | color | 可选 |
| `texture` | string | 可选 |
| `name` | string | 可选 |

### CameraComponent
| 属性 | 类型 | 规则 |
|------|------|------|
| `mode` | string | 枚举 `perspective` / `orthographic` |
| `fov` | number | [1,170] |
| `orthoSize` | number | > 0 |
| `near` / `far` | number | > 0 |
| `priority` | integer | 可选 |

### 其他可用组件
- `ClickableComponent`：`clickCooldown` ≥ 0
- `TroikaTextComponent`：`text` string、`fontSize` > 0、`color`、`maxWidth` > 0、`textAlign`（left/center/right）、`outlineWidth` ≥ 0、`outlineColor`
- `LightComponent`：`type`、`color`、`intensity`、`castShadow`、`position` 等（非 schema 强校验）
- `InputComponent` / `SpawnComponent` / `LineComponent`：构造即用，不进 props（schema 未覆盖 → 引擎记 warn）

> 组件属性支持 `kind: "basic"`（MeshBasicMaterial）等引擎扩展属性，但检查器未声明的属性会产生 unknown-property warn，尽量只写上表字段。

## 创建步骤
1. 确认目标项目与场景名（name 唯一，不与现有场景重复）
2. 确定 `mode`（menu/base/game）与 `skybox.backgroundColor`
3. 按需填充 `objects`：
   - 静态 3D 物体（地面、墙、装饰）→ `type: actor` + `TransformComponent` + `MeshComponent`/`SpriteComponent`
   - 复用蓝图（房屋、塔、树等预制体）→ `type: ref` + `ref` 路径
4. 检查所有节点：顶层 transform 已删除、name 唯一、组件属性合规

## 完成检查（对照资产检查器）
- [ ] 根含 `name`（string）与 `objects`（非空数组）
- [ ] 所有节点 `type` 为 `actor` 或 `ref`（无旧格式几何节点）
- [ ] 无任何顶层 `position`/`rotation`/`scale`（全部写入 TransformComponent）
- [ ] 所有 `name` 唯一
- [ ] `ref` 路径以 `asset/` 开头、以 `.blueprint.json` 结尾
- [ ] 颜色为 hex 或 rgba() 格式
- [ ] 数值在检查器范围内（size/opacity/fov 等）

## 参考
- 类型定义：`src/engine/asset/SceneAsset.ts`
- 检查器：`src/editor/asset/assetLint/checkers/docCheckers.ts`、`nodeCheckers.ts`、`componentChecker.ts`
- 现有示例：`src/projects/fish/asset/fish.scene.json`、`src/projects/fish/asset/blueprints/beach_house_parts.scene.json`
