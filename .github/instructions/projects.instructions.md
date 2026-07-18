---
description: "Use when creating or modifying files under src/projects/. Covers project folder structure, file placement, naming conventions, and migration rules for game projects (asset/, config/, gameplay/, hud/)."
applyTo: "src/projects/**"
---
# src/projects 工程文件夹结构规则

`src/projects/` 下的每个游戏项目文件夹必须遵循以下目录结构：

```
{ProjectName}/
├── asset/               # 场景资产文件（.scene.json）
├── config/              # 配置文件（*.config.json, *.table.json）
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

放置 `.scene.json` 场景资产文件。程序化生成场景的项目（如使用 WorldBuilder）可省略此文件夹。

```
asset/
├── fish.scene.json
├── fish_menu.scene.json
└── ...
```

规则：
- **禁止**将 `.scene.json` 文件放在项目根目录或 `gameplay/` 内

### config/ — 配置文件

放置全局配置文件（所有阶段共享的配置）：

| 文件类型 | 示例 | 说明 |
|----------|------|------|
| `project.json` | — | 项目元信息（名称、入口、标签、worldConfig 等），**保留在根目录** |
| `*.config.json` | `cannon.config.json`、`eatfish.config.json` | 功能配置，由 `ConfigRegistry` 加载 |
| `*.table.json` | `fish.table.json` | 数据表，由 `DataTable` 加载 |

规则：
- `project.json` 作为项目标识文件保留在根目录，不移入 `config/`
- 若某个阶段的配置仅在该阶段使用，可放在 `gameplay/{mode}/config/` 下

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

## 迁移指南

### 新项目搭建步骤
1. 创建 `asset/`、`config/`、`gameplay/` 文件夹
2. 在 `gameplay/` 下创建 `common/` 放置共享类型和工具
3. 按阶段在 `gameplay/` 下创建 `{mode}/` 文件夹
4. 在每个 mode 文件夹下创建 `hud/` 放置 UI 组件
5. 创建 `index.ts` 导出所有公开 API
6. 创建 `project.json` 配置项目元信息

### 现有项目迁移步骤
1. 创建目标文件夹
2. 移动文件到对应文件夹
3. 更新所有 import 路径引用
4. 更新 `index.ts` 导出路径
5. 验证项目可正常构建运行
