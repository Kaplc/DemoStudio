# 资产与工具系统（Engine Asset·Tools）

> 资产注册/加载（场景、蓝图、配置表、数据表）+ 运行时工具（注册表、存档、对象池）。
> 代码位置：`src/engine/asset/` `src/engine/tools/`
> 相关文档：[系统总览](../system_overview.md) / [实体体系](./entity_system.md) / [游戏流程](./gameflow_system.md)

## 1. 概述

两大职责：

1. **资产管线**：场景资产（`.scene.json`）与蓝图资产（`.blueprint.json`）的注册、解析、加载
2. **运行时工具**：各类注册表（组件/Actor/对象/游戏模式）、配置表系统、存档系统、对象池、属性补丁

## 2. 资产系统（asset/）

### 核心类

| 类 | 说明 |
|---|---|
| `AssetRegistry` | 资产注册中心：统一管理项目场景/蓝图资产。`registerAll({ scenes, blueprintModules, scriptModules })` 批量注册；蓝图/脚本注册 key 由 import.meta.glob 文件路径自动推导（`asset/...`） |
| `BlueprintAsset` | 蓝图资产结构：`BlueprintComponentDef` / `BlueprintChildDef` / `ResolvedBlueprint` / `ResolvedChildDef` / `ResolvedComponentDef` |
| `BlueprintRegistry` | 蓝图注册中心：以资产路径为 key；`resolve(path)` 递归展开 ref 子节点为内联数据；`register` / `loadFromJson` 失效缓存；`clearAll()` 切工程时调用 |
| `SceneAsset` | 场景资产结构：`SceneNode` / `SpriteNode` / `MaterialProps` / `ColorHex` / `SkyboxConfig` / `BlueprintNode` / `RefNode` / `ActorNode` |
| `SceneLoader` | 声明式场景资产 → `SceneGroup`（group + name + mode + skybox + blueprintNodes + refNodes + actorNodes + dispose） |

### 资产注册流程

```ts
// 项目 asset/index.ts
AssetRegistry.registerAll({
  scenes,                              // SceneAsset[]
  blueprintModules: bpModules,         // import.meta.glob eager
  scriptModules,                       // 脚本模块（自动推导脚本 id）
})
// 之后 World.SwitchToScene('FishMenu') 按场景名切换
```

### 加载流程

```
SceneAsset（JSON）→ loadScene() 展开为 THREE.Group
  ├─ sprite/mesh 节点 → 直接渲染（track disposables）
  ├─ blueprint 节点 → 收集交给 World 层实例化
  └─ ref 节点 → 归一化为 NormalizedRefNode（递归 resolve 蓝图 ref）
```

## 3. 工具系统（tools/）

### 注册表族

| 类 | 说明 |
|---|---|
| `ComponentRegistry` | 组件工厂注册表（`ComponentFactory` / `ComponentConfigurator`） |
| `ActorRegistry` | Actor 工厂注册表（`ActorFactory`） |
| `ObjectRegistry` | 对象注册表（OObject 族统一登记） |
| `GameModeRegistry` | 游戏模式注册表 |
| `GameFactoryRegistry` | 游戏工厂注册表（`GameInstanceFactory`） |
| `ScriptRegistry` | 脚本注册表（详见 [输入/物理/脚本系统](./input_physics_script_system.md)） |
| `registerBuiltinComponents` / `registerBuiltinActors` | 内置组件/Actor 批量注册 |

### 配置表系统（ConfigRegistry / DataTable）

两种形态：

| 形态 | 说明 |
|---|---|
| 单例配置 | 一份整体配置对象（`*.config.json`），替换硬编码 DEFAULT_CONFIG |
| 数据表 | UE 风格键值行表（`*.table.json`），`DataTable` 封装 |

同步/异步解法：

```
registerDefaults（启动期同步注册默认值）
loadConfig（异步加载并覆盖缓存；剔除 `_` 前缀键；transform 钩子归一化如 "#rrggbb" → 数字）
getConfig（同步返回：缓存 → 默认值 → 抛错（未注册=编程错误））
→ loadConfig 可 fire-and-forget，竞态下最多首帧用默认值
```

### 存档系统（SaveSystem）

- 通过 Electron IPC 读写 `userData/saves/<game>/<slot>.json`
- `SaveSystem.save({ game, slot, payload, score, phase, label })` 补全 meta（`SAVE_FORMAT_VERSION`）后落盘
- `load` 校验 `meta.game` 防止跨游戏误读
- 非 Electron 环境安全降级（返回 `success: false` 而非抛异常）
- 配合 `SaveSlotComponent`（GameInstance 内 KV 键值槽）与 `ISaveData`（`SaveData` / `SaveMeta` / `SaveSlotInfo`）

### 其他工具

| 类 | 说明 |
|---|---|
| `ObjectPool` | 通用对象池 |
| `deepMerge` | 属性补丁：`mergePatch` / `clonePatch` / `emptyPatch` / `PropertyPatch`（蓝图 overrides 与属性合并基础） |
| `Gizmos` | 引擎侧 Gizmos（编辑器辅助对象） |
| `ConfigLoaderBase` | 项目 ConfigLoader 基类（项目侧扩展） |

## 4. 依赖关系

```
AssetRegistry → BlueprintRegistry / ScriptRegistry
SceneLoader → TextureLoader / SceneAsset
BlueprintRegistry → deepMerge（PropertyPatch）
World → AssetRegistry / ObjectRegistry / GameModeRegistry / SceneLoader
ConfigRegistry → readJsonFile IPC（与场景资产同一机制，dev 可用、支持热更新）
SaveSystem → electronAPI.saveGameFile / loadGameFile
```
