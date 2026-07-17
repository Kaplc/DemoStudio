---
description: "Use when creating or modifying files under src/projects/. Covers project folder structure, file placement, naming conventions, and migration rules for game projects (scene/, config/, components/, comp/, module/)."
applyTo: "src/projects/**"
---
# src/projects 工程文件夹结构规则

`src/projects/` 下的每个游戏项目文件夹必须遵循以下目录结构：

```
{ProjectName}/
├── scene/               # 场景资产文件（.scene.json）
├── config/              # 配置文件（*.config.json, *.table.json, project.json）
├── components/          # UI 组件（React/TSX）
├── comp/                # 游戏组件（继承自 Component 的类）
├── module/              # 按功能域划分的游戏模块
├── index.ts             # 项目入口文件
├── project.json         # 项目元信息配置
└── types.ts             # 类型定义（接口、枚举、常量）
```

## 各文件夹详细规则

### scene/ — 场景资产文件

放置 `.scene.json` 场景资产文件。程序化生成场景的项目（如使用 WorldBuilder）可省略此文件夹。

```
scene/
└── {projectName}.scene.json
```

规则：
- 场景文件统一命名为 `{projectName}.scene.json`
- **禁止**将 `.scene.json` 文件放在项目根目录

### config/ — 配置文件

放置所有配置类文件：

| 文件类型 | 示例 | 说明 |
|----------|------|------|
| `project.json` | — | 项目元信息（名称、入口、标签、worldConfig 等），**保留在根目录** |
| `*.config.json` | `cannon.config.json`、`eatfish.config.json` | 功能配置，由 `ConfigRegistry` 加载 |
| `*.table.json` | `fish.table.json` | 数据表，由 `DataTable` 加载 |

规则：
- `project.json` 作为项目标识文件保留在根目录，不移入 `config/`
- `config/` 内可建子文件夹按功能分组

### components/ — UI 组件

放置 React/TSX UI 组件文件：

```
components/
├── GameHud.tsx
└── ...
```

规则：
- 仅存放与渲染/交互相关的 UI 组件（`.tsx`）
- **不包含**游戏逻辑代码
- 每个组件文件单一职责

### comp/ — 游戏组件

放置继承自 `engine/gameplay/Component.ts` 的游戏逻辑组件：

```
comp/
├── MovementComponent.ts
├── HealthComponent.ts
├── SpawnComponent.ts
└── ...
```

规则：
- 仅存放 `class XxxComponent extends Component` 的类
- 文件名以 `Component.ts` 结尾
- Pawn、PlayerController、GameMode 等不属于 Component 的类**不放入此文件夹**

### module/ — 子模块文件夹

按功能域划分的子模块**文件夹**，用于组织较大的功能逻辑。仅当某组功能可独立成子目录时使用。

```
module/
├── ai/              # AI 逻辑
├── physics/         # 物理/碰撞
├── weapons/         # 武器系统
├── economy/         # 经济/计分系统
├── world/           # 世界生成（WorldBuilder 等）
└── ...
```

规则：
- 每个子模块文件夹应有自己的 `index.ts` 导出
- 跨模块引用通过父项目 `index.ts` 协调
- **不将独立的游戏文件（Pawn、Actor、GameMode、GameInstance、PlayerController、工具类等）放入 module/ 根目录**——这些文件应直接放在项目根目录

## 根目录文件规则

以下文件可放置在项目根目录：

| 文件 | 说明 |
|------|------|
| `index.ts` | 项目入口文件，导出所有公开 API |
| `project.json` | 项目元信息配置 |
| `types.ts` | 类型定义（接口、枚举、类型别名、常量） |
| `*Pawn.ts`, `*Controller.ts` | Pawn / PlayerController 类 |
| `*GameMode.ts`, `*GameInstance.ts` | GameMode / GameInstance 类 |
| `*Actor.ts` 子类 | Actor 子类（鱼、子弹、网、特效等游戏实体） |
| `*.ts` 工具类 | 对象池管理器、纹理生成器等工具模块 |

**禁止**将场景文件（`.scene.json`）、配置文件（`.config.json` / `.table.json`）、UI 组件（`.tsx`）直接放在项目根目录。

## 现有项目迁移要求

所有现有项目需按以上规则迁移：

| 项目 | 需迁移的内容 |
|------|-------------|
| **demo2d** | `demo2d.scene.json` → `scene/demo2d.scene.json`；`project.json`、`types.ts`、`index.ts` 保留根目录 |
| **eatfish** | `eatfish.config.json` → `config/eatfish.config.json`；`fish.table.json` → `config/fish.table.json` |
| **fish** | `fish.scene.json` → `scene/fish.scene.json` |
| **racing** | 已达标，无需迁移 |
| **snake** | `snake.scene.json` → `scene/snake.scene.json` |

迁移步骤：
1. 创建目标文件夹（`scene/`、`config/` 等）
2. 移动文件到对应文件夹
3. 更新 `project.json` 中 `main` 入口路径（如适用）
4. 更新所有 import 路径引用
5. 验证项目可正常构建运行
