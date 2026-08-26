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

### 使用方法

| 方法 | 签名 | 说明 |
|---|---|---|
| 批量注册 | `AssetRegistry.registerAll({ scenes?, blueprintModules?, scriptModules? })` | 项目 asset/index.ts 调用；场景缺 name → warn 跳过 |
| 场景查询 | `getScene(name)` / `getSceneByMode(mode)` / `getSceneNames()` / `hasScene(name)` | 未注册返回 null；getSceneByMode 返回第一个匹配 |
| 蓝图注册 | `BlueprintRegistry.register(path, asset)` / `loadFromJson(path, json)` | 改资产后同步注册表（失效缓存） |
| 蓝图解析 | `BlueprintRegistry.resolve(path): ResolvedBlueprint` | 递归展开 ref；未注册抛 Error；检测循环引用 |
| 场景加载 | `SceneLoader.loadScene(asset): SceneGroup` | 展开为 THREE.Group + 节点分类 |

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

### 场景嵌套 children（2026-08-17 起）

场景资产 `objects[]` 的 `actor` / `ref` 节点支持 `children` 递归子对象数组（结构与蓝图 `BlueprintChildDef` 一致：`name` / `baseClass` / `ref` / `components` / `children`，无 `type` 字段）：

- **加载**：`loadScene` 把 ref 节点的 `children` 归一化进 `NormalizedRefNode.children`；`World.loadSceneAsActors` 对 ref 节点递归调用 `spawnSceneChildren`（挂到 ref 实例下），actor 节点子对象由 `spawnInlineActor` → `spawnInlineChildren` 递归生成
- **预览**：`ScenePreviewManager` 经 onSpawn 回调按「深度优先先序 + 路径栈」构建 Actor→JSON 节点/路径映射；大纲在 ref 实例内部只显示场景自有子对象（`_actorJsonMap` 登记），蓝图内部结构不展开
- **序列化**：保存时统一递归写出——`objects` 保持顶层列表，有子对象写 `children` 递归数组、无则不写；旧平铺资产加载/保存语义不变
- **约束**：同一父节点下 `name` 必须唯一（assetLint `doc:scene` 检查）；编辑器大纲右键「创建/复制」自动生成唯一名

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

使用方法：

```ts
// 注册默认值（启动期同步）
ConfigRegistry.registerDefaults('fish.cannon', DEFAULT_CANNON_CONFIG)
// 异步加载覆盖（fire-and-forget，竞态下最多首帧用默认值）
void ConfigRegistry.loadConfig('fish.cannon', 'cannon.config.json')
// 同步读取：缓存 → 默认值 → 抛错（未注册=编程错误）
const cfg = ConfigRegistry.getConfig<SchoolConfig>('fish.school')
// 数据表读取（未加载返回 undefined，消费方 if 守卫）
const table = ConfigRegistry.getTable<FishArchetype>('eatfish.fish') ?? null
```

关键语义：

- `loadConfig` 读取失败**不缓存**，`getConfig` 回退默认值；`loadTable` 失败返回 null
- 顶层 `_` 前缀键剔除（`stripMeta`，支持 `_comment`）；override 键**整体替换**（含数组，不做元素级合并）
- **无 electronAPI 时** `readJson` 返回 null（warn）→ 全部走默认值，不抛异常
- `registerGlob(projectName, ...)` name 规则：`{projectName}.{文件名}`；transform 须先注册（加载异步）

### 游戏存档（SaveSlotComponent）

- KV 内存模型 + 手动落盘：挂到 GameInstance 上获得 `set/get/delete/has/keys` 能力
- 内存优先：set/delete 只改内存 Map 不触发 IO，调 `flush()` 整表写入文件
- 通过 `electronAPI.writeJsonFile` 落盘（与蓝图资产写盘共用 IPC），路径约定 `src/projects/<game>/data/*.json`
- 支持 `autoFlush`：'onStop' / 'onDestroy' / tick 周期（毫秒），可组合
- 无 electronAPI 时降级为纯内存模式（刷新即丢，控制台 WARN 一次）
- 详见 `engine/gameflow/SaveSlotComponent.ts` 头注释

### 其他工具

| 类 | 说明 |
|---|---|
| `ObjectPool` | 通用对象池：`acquire()/release()/releaseAll()/clear()`；空闲对象隐藏 root；`maxSize>0` 超限回收最老活跃对象；`maxSize=0` 不限制 |
| `deepMerge` | 属性补丁：`mergePatch` / `clonePatch` / `emptyPatch` / `PropertyPatch`（蓝图 overrides 与属性合并基础） |
| `Gizmos` | 引擎侧 Gizmos（编辑器辅助对象） |
| `ConfigLoaderBase` | 项目 ConfigLoader 基类（项目侧扩展） |

## 4. 边界条件

| 条件 | 行为/后果 | 处理方式 |
|---|---|---|
| `BlueprintRegistry.resolve` 未注册路径 | `throw new Error('Blueprint "X" 未注册')` | 调用方 try/catch（SpawnActorFromBlueprint 已接住） |
| 蓝图 ref 循环引用 | `throw new Error('检测到 Blueprint ref 循环引用')` | 编辑器层回滚 + 返回失败 |
| `getConfig` 未注册 | `throw new Error('配置 "X" 未注册...')`（编程错误） | 先 registerDefaults / loadConfig |
| `getTable` 未加载 | 返回 undefined（非编程错误） | 消费方 `?? null` 守卫 |
| `loadConfig` 读取失败 | 不缓存，回退默认值 | 引擎内置降级 |
| 无 electronAPI | readJson 返回 null → 全部走默认值 | 引擎内置降级 |
| `AssetRegistry.getScene` 未注册 | 返回 null | 调用方判空 |
| `ScriptRegistry.create` 未注册 | 返回 null | 调用方判空 |
| ObjectPool 超限 | maxSize>0 时回收最老活跃对象 | 按需调 maxSize |
| SaveSlotComponent 无 writeJsonFile IPC | flush 失败返回 false，数据保留在内存 | 引擎内置降级 |
| resolve 结果修改 | 返回对象只读约定 | 实例化用 clonePatch 深拷贝 |

## 5. 依赖关系

```
AssetRegistry → BlueprintRegistry / ScriptRegistry
SceneLoader → TextureLoader / SceneAsset
BlueprintRegistry → deepMerge（PropertyPatch）
World → AssetRegistry / ObjectRegistry / GameModeRegistry / SceneLoader
ConfigRegistry → readJsonFile IPC（与场景资产同一机制，dev 可用、支持热更新）
SaveSlotComponent → electronAPI.writeJsonFile（KV 存档整表落盘）
```
