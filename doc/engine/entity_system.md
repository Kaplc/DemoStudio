# 实体体系系统（Engine Entity）

> 引擎对象层级与组件系统：`OObject → AObject → BObject → Actor` + 组件组合。
> 代码位置：`src/engine/entity/`
> 相关文档：[系统总览](../system_overview.md)

## 1. 概述

模仿 UE 的对象层级设计，四级对象基类逐级扩展能力：

| 层级 | 类 | 能力 |
|---|---|---|
| L0 | `OObject` | 对象根基：uid、命名、生命周期（BeginPlay/EndPlay/Tick） |
| L1 | `AObject` | 原子对象：组件挂载/查询（`getComponent` / `addComponent`） |
| L2 | `BObject` | 蓝图对象：承接蓝图资产数据（组件列表来自 BlueprintAsset） |
| L3 | `Actor` | 场景实体：拥有 THREE.Group（root）、可见性树、子节点层级、world 引用 |

凡是要出现在 3D 场景里的实体（Pawn / 建筑 / UI / 摄像机 / 装饰）都继承 `Actor`。

## 2. 核心类

| 类 | 说明 |
|---|---|
| `OObject` | 根基类：唯一 uid、名称、BeginPlay/EndPlay/Tick 生命周期 |
| `AObject` | 组件容器：组件注册/查询/遍历 |
| `BObject` | 蓝图数据载体：按蓝图声明实例化组件 |
| `Actor` | 场景对象：`root: THREE.Group`、子 Actor 树、`world`、`blueprintRef`（蓝图实例元数据 + overrides）、`isRefInstance`（ref 子节点标记） |
| `Pawn` | 可操控实体，挂接 `PlayerController` |
| `GenericActor` | 通用 Actor：按注册表/资产数据实例化 |
| `Component` | 组件基类，含 `EditableProperty` 声明式属性元数据（Inspector 据此渲染） |
| `AObjectComponent` | 挂载于 AObject 的组件基类 |
| `BObjectComponent` | 挂载于 BObject 的组件基类 |
| `ActorComponent` | 挂载于 Actor 的组件基类 |
| `SpawnComponent` | 生成逻辑组件 |
| `TransformComponent` | 变换组件（position/rotation/scale，顶层字段已废弃，统一由组件 properties 承载） |

## 3. 设计要点

### 3.1 生命周期传播

```
构造 → BeginPlay（组件就绪后，递归子 Actor） → Tick（每帧） → EndPlay（销毁前）
```

- `Actor.BeginPlay` 递归传播到子 Actor；`bHasBegunPlay` 防止 ref 子节点重复调用
- 内联子节点经 `attachTo` 挂载，不在 `World.allActors` 中，由父链传播生命周期

### 3.2 场景树与引用

- 每个 Actor 拥有 `THREE.Group`，`userData.actorRef` / `userData.actorUid` 反查 Actor
- 子 Actor 树由 `children` / `_parent` 维护（与 THREE 层级平行）
- `blueprintRef = { id, overrides? }`：记录蓝图实例来源与属性补丁（`PropertyPatch`）

### 3.3 组件与属性补丁

- 组件属性改动走 `deepMerge` 的 `PropertyPatch`（`clonePatch` / `mergePatch`），支持蓝图 overrides 覆盖
- 组件用 `EditableProperty` 声明可编辑属性（类型、默认值、资产引用目标），编辑器 Inspector 据此动态渲染

## 4. 依赖关系

```
Actor → BObject → AObject → OObject
Actor → World（world 引用，SpawnActor 时设置）
组件体系 → deepMerge（PropertyPatch）
Actor → THREE.Group（root 场景节点）
```

## 5. 注册机制

实体类本身不注册；`Actor` / `Component` 的类型工厂注册见 [资产与工具系统](./asset_tools_system.md)（`ActorRegistry` / `ComponentRegistry`）。
