---
name: skl-create-scene-asset
description: 创建 DemoStudio 场景资产（.scene.json）。使用时机：用户要求新建/编辑场景资产文件，如"创建一个新场景"、"写 fish 的场景资产"、"添加场景 objects 节点"。规则与资产检查器一致，创建的资产必须零 lint 错误。
---

# 创建场景资产（.scene.json）

## 何时使用
- 用户要求新建场景资产文件（`asset/*.scene.json`）
- 修改现有场景的 `objects` 数组

## 文件位置与命名
- 路径：`src/projects/<project>/asset/*.scene.json`
- 命名：`<描述>.scene.json`

## 场景根结构

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
| `mode` | string | 可选 | 游戏阶段标识（menu/base/game） |
| `objects` | array | ✅ | 节点列表 |

## objects 节点类型

### type: "actor" — 内联 Actor

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

### type: "ref" — 引用蓝图

```json
{
  "type": "ref",
  "name": "MainHouse",
  "ref": "asset/blueprints/beach_house.blueprint.json"
}
```

## ⚠️ 关键约定

1. **组件优先约定**：位置/旋转/缩放必须写在 TransformComponent 的 properties 里
2. **name 唯一**：同一父节点下所有节点 name 必须唯一
3. **旧格式几何节点已移除**：type: box/plane/sphere/sprite 等全部废弃
4. **颜色格式**：CSS hex 或 rgba()

## 完成检查
- [ ] 根含 `name` 与 `objects`
- [ ] 所有节点 `type` 为 `actor` 或 `ref`
- [ ] 无任何顶层 transform
- [ ] 所有 `name` 唯一
- [ ] `ref` 路径格式正确
