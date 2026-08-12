---
description: "Use when creating or modifying files under src/projects/. Covers project folder structure, file placement, naming conventions, and migration rules for game projects (asset/, asset/config/, gameplay/, hud/)."
applyTo: "src/projects/**"
---
# src/projects 工程文件夹结构规则

`src/projects/` 下的每个游戏项目文件夹必须遵循以下目录结构：

```
{ProjectName}/
├── asset/               # 场景资产文件（.scene.json）+ 配置资产（asset/config/）
│   └── config/          #   配置文件（*.config.json, *.table.json）
├── gameplay/            # 按阶段/模式划分的游戏逻辑子文件夹
│   ├── common/          #   跨阶段共享（types.ts、textures.ts、工具类等）
│   ├── {modeA}/         #   阶段 A（menu / base 等）
│   │   ├── hud/         #     该阶段的 UI 组件（.tsx）
│   │   ├── {ModeA}GameMode.ts
│   │   └── ...
│   ├── {modeB}/         #   阶段 B（game 等）
│   │   ├── hud/         #     该阶段的 UI 组件（.tsx）
│   │   ├── config/      #     该阶段独用的配置文件（可选）
│   │   ├── {ModeB}GameMode.ts
│   │   ├── *Actor.ts
│   │   ├── *Pawn.ts
│   │   ├── *Controller.ts
│   │   ├── ...
│   └── {Mode}GameInstance.ts  # 游戏实例（多阶段编排），放在 gameplay/ 根目录
├── index.ts             # 项目入口文件
└── project.json         # 项目元信息配置
```

**参考项目：** `fish/` 实现了完整的三阶段结构（`menu/` → `base/` → `game/`），新增项目应参照此模式。

## 各文件夹详细规则

### asset/ — 场景资产文件

放置 `.scene.json` 场景资产文件和 `blueprints/` 蓝图资产文件。

```
asset/
├── fish.scene.json
├── fish_menu.scene.json
├── fish_base.scene.json
├── config/                # 配置文件（*.config.json / *.table.json）
│   ├── cannon.config.json
│   └── troop.table.json
└── blueprints/
    ├── beach_house.blueprint.json
    └── seaweed_sprite.blueprint.json
```

规则：
- **禁止**将 `.scene.json` 文件放在项目根目录或 `gameplay/` 内
- **场景资产**：`asset/*.scene.json`（不包含子目录）
- **蓝图资产**：`asset/blueprints/*.blueprint.json`
- **配置资产**：`asset/config/*.config.json` 与 `asset/config/*.table.json`（配置表，由 ConfigRegistry 加载）
- **自动扫描**：新增文件无需修改代码，`import.meta.glob` 在 `asset/index.ts` 中自动发现并注册
- **注册时机**：打开工程时触发（`setCurrentProject` → `registerFishAssets()` → `AssetRegistry.registerAll()`）
- **asset/index.ts 模板**：

```typescript
// src/projects/{name}/asset/index.ts
import { AssetRegistry } from '@/engine'
import type { SceneAsset, BlueprintAsset } from '@/engine'

export function register{Name}Assets(): void {
  const scenes = Object.values(
    import.meta.glob<{ default: SceneAsset }>('./*.scene.json', { eager: true })
  ).map((m) => m.default as SceneAsset)
  const blueprints = Object.values(
    import.meta.glob<{ default: BlueprintAsset }>('./blueprints/*.blueprint.json', { eager: true })
  ).map((m) => m.default as BlueprintAsset)
  AssetRegistry.registerAll({ scenes, blueprints })
}
```

### asset/config/ — 配置文件（已从 config/ 目录迁入）

放置全局配置文件（所有阶段共享的配置），与场景/蓝图资产同属 `asset/` 资源目录：

| 文件类型 | 位置 | 说明 |
|----------|------|------|
| `project.json` | 项目根目录 | 项目元信息（名称、入口、标签、worldConfig 等），**保留在根目录** |
| `*.config.json` | `asset/config/` | 功能配置，由 `ConfigRegistry` 加载 |
| `*.table.json` | `asset/config/` | 数据表，由 `DataTable` 加载 |

规则：
- `project.json` 作为项目标识文件保留在根目录，不移入 `asset/config/`
- 若某个阶段的配置仅在该阶段使用，可放在 `gameplay/{mode}/config/` 下
- 各项目的配置加载器（如 `FishConfigLoader.ts`）位于项目根目录，由 GameInstance 构造时统一调用（`initXxxConfigs`）
- **半自动注册**：`asset/config/` 下配置文件（`.config.json` / `.table.json`）由 `asset/config/index.ts` 的 glob 自动扫描注册（路径/name 推导，新增文件无需改代码）；配置加载器只需手动注册默认值（`registerDefaults`）与归一化 transform（`registerConfigTransform` / `registerTableTransform`）
- **`asset/config/index.ts` 模板**：

```typescript
// src/projects/{name}/asset/config/index.ts
import type { ConfigGlobModules } from '@/engine'

export const configGlob: ConfigGlobModules = {
  configModules: import.meta.glob('./**/*.config.json'),
  tableModules: import.meta.glob('./**/*.table.json'),
}
```

- **配置名推导规则**：`{projectName}.{文件名}`（`cannon.config.json` → `fish.cannon`；`eatfish.config.json` → `eatfish.eatfish`）

### gameplay/ — 按阶段/模式划分的子文件夹

**核心约定：每个阶段（mode）就是一个文件夹。** 新增场景时，直接在 `gameplay/` 下创建新文件夹存放该模式的所有代码。

```
gameplay/
├── common/              # 跨阶段共享
│   ├── types.ts         #   类型定义（接口、枚举、类型别名、常量）
│   └── textures.ts      #   纹理生成器等工具模块
├── menu/                # 主菜单阶段
│   ├── hud/
│   │   └── FishMainMenuUI.tsx
│   ├── FishMainMenuGameMode.ts
│   └── fish_menu.scene.json
├── base/                # 基地阶段
│   ├── hud/
│   │   └── FishBaseUI.tsx
│   ├── FishBaseGameMode.ts
│   └── fish_base.scene.json
├── game/                # 玩法阶段
│   ├── hud/
│   │   └── GameHud.tsx
│   ├── config/          #   该阶段独用的配置文件（可选）
│   ├── FishGameMode.ts
│   ├── FishCannon.ts       (Pawn)
│   ├── FishPawn.ts         (Actor)
│   ├── FishBullet.ts       (Actor + IPoolable)
│   ├── FishPlayerController.ts
│   ├── FishObjectPools.ts
│   └── ...
└── FishGameInstance.ts  # 游戏实例（多阶段编排）
```

规则：
- **新增场景**：在 `gameplay/` 下创建 `{modeName}/` 文件夹，该阶段的所有代码放在其下
- **跨阶段共享**：共享代码（`types.ts`、`textures.ts`、工具类）放在 `gameplay/common/`
- **UI 组件**：每个阶段的 `.tsx` UI 文件放在该阶段的 `hud/` 子文件夹内
- **文件地位**：`GameMode`、`Pawn`、`Actor`、`PlayerController`、工具类等直接放在 mode 文件夹根目录（不嵌套子目录）
- **游戏实例**：`GameInstance` 放在 `gameplay/` 根目录（跨阶段编排）
- **禁止**将 `.tsx` 文件放在 mode 根目录——必须放入 `hud/`

### comp/ — 游戏组件（可选）

放置继承自 `engine/gameplay/Component.ts` 的游戏逻辑组件：

```
gameplay/{mode}/comp/
├── MovementComponent.ts
├── HealthComponent.ts
└── ...
```

规则：
- 仅存放 `class XxxComponent extends Component` 的类
- 文件名以 `Component.ts` 结尾
- 若某 mode 有多个 Component，可创建 `comp/` 子文件夹；一个都没有则可省略

### module/ — 子模块文件夹（可选）

按功能域划分的子模块**文件夹**，用于组织较大的功能逻辑。仅当某组功能可独立成子目录时使用。

```
gameplay/{mode}/module/
├── ai/              # AI 逻辑
├── physics/         # 物理/碰撞
├── weapons/         # 武器系统
└── economy/         # 经济/计分系统
```

规则：
- 每个子模块文件夹应有自己的 `index.ts` 导出
- 跨模块引用通过父项目 `index.ts` 协调

## 根目录文件规则

以下文件可放置在项目根目录：

| 文件 | 说明 |
|------|------|
| `index.ts` | 项目入口文件，导出所有公开 API |
| `project.json` | 项目元信息配置 |

**禁止**将场景文件（`.scene.json`）、配置文件（`.config.json` / `.table.json`）、UI 组件（`.tsx`）直接放在项目根目录。

### 新项目搭建步骤
1. 创建 `asset/`（含 `blueprints/`、`config/`）、`gameplay/` 文件夹
2. 在 `gameplay/` 下创建 `common/` 放置共享类型和工具
3. 按阶段在 `gameplay/` 下创建 `{mode}/` 文件夹
4. 在每个 mode 文件夹下创建 `hud/` 放置 UI 组件
5. 创建 `asset/index.ts` 用 `import.meta.glob` 自动扫描注册资产
6. 在 `register.ts` 中规定 `registerAssets` 字段（指向 `asset/index.ts` 的注册函数）
7. 创建 `index.ts` 导出所有公开 API
8. 创建 `project.json` 配置项目元信息

## 程序化生成规则（World 工厂方法）

**项目代码中禁止直接调用 `new THREE.Mesh()`、`new THREE.BoxGeometry()`、`new THREE.SphereGeometry()`、`new THREE.PlaneGeometry()`、`new THREE.MeshBasicMaterial()` 等 THREE 构造函数创建几何体。**

所有程序化生成的基础图元必须通过 `World` 提供的工厂方法创建：

| 方法 | 用途 |
|------|------|
| `world.createGroup()` | 空 Group（组合体容器） |
| `world.createBoxMesh(w, h, d, color, transparent?, opacity?)` | Box 网格 |
| `world.createSphereMesh(radius, color, segments?, transparent?, opacity?)` | 球体网格 |
| `world.createPlaneMesh(w, h, color, transparent, opacity, side)` | 平面网格 |
| `world.createInvisibleBox(w, h, d)` | 不可见 Box（点击碰撞体） |
| `world.createEdgesBox(w, h, d, color, transparent?, opacity?)` | Box 线框 |

生成的物体应包装为 `StaticMeshActor`，通过 `world.SpawnActor()` 注册到 Actor 生命周期，由 `World.DestroyAllActors()` 统一清理（自动 `EndPlay()` + 释放 geometry/material + 从场景移除）。

```typescript
// ✅ 正确做法
const group = world.createGroup()
const mesh = world.createBoxMesh(1, 1, 1, 0xff0000)
group.add(mesh)
const actor = new StaticMeshActor(group, 'MyDecor')
world.SpawnActor(actor)

// ❌ 禁止做法
const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xff0000 }))
scene.add(mesh)
```

参考实现：`src/projects/fish/gameplay/base/FishBaseGameMode.ts`、`FishHouseActor.ts`

## 场景切换方法（World.SwitchToScene）

阶段性场景切换必须使用 `World.SwitchToScene(sceneAsset, extraSetup?)`，它会自动：

1. 读取 `sceneAsset.mode`
2. 从 `GameModeRegistry` 查找对应 GameMode 构造函数并实例化
3. `Pause` → `DestroyAllActors` → `SetGameMode`
4. `loadSceneAsActors(sceneAsset)` — 将场景资产文件中的对象加载为 `StaticMeshActor`
5. 执行 `extraSetup` 回调（相机、Controller、UI 等项目专属设置）
6. `BeginPlay()` — 恢复世界运行

**使用步骤：**

### 1. 注册 mode → GameMode 映射

在每个项目的 `register.ts` 文件中注册：

```typescript
// src/projects/fish/register.ts
import { GameModeRegistry } from '@/engine'
import { FishMainMenuGameMode } from './gameplay/menu/FishMainMenuGameMode'
import { FishBaseGameMode } from './gameplay/base/FishBaseGameMode'
import { FishGameMode } from './gameplay/game/FishGameMode'

// 注册各场景 mode 对应的 GameMode
GameModeRegistry.register('menu', FishMainMenuGameMode)
GameModeRegistry.register('base', FishBaseGameMode)
GameModeRegistry.register('game', FishGameMode)
```

### 2. 使用 SwitchToScene 切换

```typescript
// 在 GameInstance 中
world.SwitchToScene(baseSceneData, () => {
    // 项目专属设置（处于暂停态，安全执行）
    setupCamera(gameMode.gameCamera, 8, 6, 10)
    gameMode.cameraManager.RegisterCamera(gameMode.gameCamera)
    PhySys.setup(gameMode.gameCamera.camera, ui.el)
    const spawn = gameMode.SpawnPlayer()
    spawn?.controller.Possess(spawn.pawn)
    ui.renderReact(React.createElement(FishBaseUI, { ... }))
})
```

**禁止**手动拼凑 `Pause → DestroyAllActors → SetGameMode → loadPhaseScene → setup → BeginPlay`，统一使用 `SwitchToScene`。

## 配置表加载规则

1. **配置表由各 GameMode 自身在构造时加载**，不允许在编辑器启动时提前加载
2. 在 `GameMode.constructor` 中调用项目的 `initXxxConfigs(logger.info)`，保证 `registerDefaults` 先于 `getConfig` 执行
3. `registerAllProjectModules()` 只注册 GameFactoryRegistry，不调用 `initConfigs`
4. 编辑器项目切换时不触发配置加载，遵循"不用不加载"原则
