# World Asset 系统设计方案

## 1. 需求分析

### 1.1 现状问题

| 问题 | 描述 |
|------|------|
| 硬编码地图加载 | Viewport 中用 `if (currentProject?.name === 'Snake')` 直接判断，新增游戏必须改 Viewport |
| 无统一接口 | `SnakeScene3D.build(20)` 返回 `THREE.Group`，但类型和接口都是 Snake 特有的 |
| 无注册机制 | 不知道该"游戏名 → 地图构建器"的映射在哪里管理 |
| 配置硬编码 | `gridSize: 20` 写死在 Viewport 中，未与 `project.json` 联动 |

### 1.2 设计目标

> **核心思想**：将地图构建从 Viewport 中解耦，通过 Registry + Builder 模式实现"选工程 → 自动加载对应地图"的通用机制。

| 目标 | 说明 |
|------|------|
| 解耦 | Viewport 不再 hardcode 任何游戏名 |
| 可扩展 | 新增游戏只需：写 Builder → 注册 → 添加 project.json |
| 统一接口 | 所有地图构建器返回同类型的 `WorldAsset` |
| 可配置 | 构建参数可从 `project.json` 读取 |

---

## 2. 核心架构

```
┌─────────────────────────────────────────────────────────────┐
│                        WorldRegistry                        │
│                 游戏名 → WorldBuilder 的映射                   │
│                  register() / get() / has()                  │
└─────────────────────────────────────────────────────────────┘
         ▲                              ▲
         │ register                     │ get
┌────────┴──────────┐     ┌─────────────┴─────────────┐
│  SnakeWorldBuilder │     │       Viewport.tsx         │
│  implements        │     │  currentProject 变化时调用  │
│  WorldBuilder      │     │  builder.build(config)     │
└───────────────────┘     │  → WorldAsset → sharedScene │
                           └───────────────────────────┘
```

### 2.1 模块划分

| 模块 | 位置 | 职责 |
|------|------|------|
| `WorldBuilder` 接口 | `src/framework/WorldAsset.ts` | 定义地图构建器的标准接口 |
| `WorldAsset` 类型 | `src/framework/WorldAsset.ts` | 构建结果的数据结构 |
| `WorldBuildConfig` 类型 | `src/framework/WorldAsset.ts` | 构建参数配置 |
| `WorldRegistry` | `src/framework/WorldRegistry.ts` | 注册中心，管理 游戏名→Builder 映射 |
| `SnakeScene3D` (改造) | `projects/snake/src/game/Scene3D.ts` | 实现 WorldBuilder 接口 |
| 注册点 | `src/App.tsx` | 初始化时调用 `WorldRegistry.register()` |

---

## 3. 数据结构设计

### 3.1 `WorldBuilder` 接口

```typescript
// src/framework/WorldAsset.ts

import * as THREE from 'three'

/** 世界构建配置 — 每个游戏可扩展此接口 */
export interface WorldBuildConfig {
  /** 场景网格大小（默认 20） */
  gridSize?: number
  /** 扩展配置，从 project.json 的 worldConfig 字段读取 */
  [key: string]: unknown
}

/** 世界构建结果 */
export interface WorldAsset {
  /** 构建出的 3D 对象组 */
  readonly group: THREE.Group
  /** 资源名称（对应游戏名） */
  readonly name: string
  /** 释放资源 */
  dispose(): void
}

/** 世界构建器接口 — 每个游戏实现此接口 */
export interface WorldBuilder {
  /** 构建世界场景 */
  build(config: WorldBuildConfig): WorldAsset
}
```

### 3.2 `WorldRegistry` 注册中心

```typescript
// src/framework/WorldRegistry.ts

import type { WorldBuilder } from './WorldAsset'

export class WorldRegistry {
  private static builders = new Map<string, WorldBuilder>()

  /** 注册世界构建器 */
  static register(gameName: string, builder: WorldBuilder): void {
    builders.set(gameName, builder)
  }

  /** 获取指定游戏的世界构建器 */
  static get(gameName: string): WorldBuilder | undefined {
    return builders.get(gameName)
  }

  /** 检查是否已注册 */
  static has(gameName: string): boolean {
    return builders.has(gameName)
  }

  /** 获取所有已注册的游戏名 */
  static getRegisteredGames(): string[] {
    return [...builders.keys()]
  }
}
```

### 3.3 `SnakeScene3D` 改造适配

```typescript
// projects/snake/src/game/Scene3D.ts

export class SnakeScene3D implements WorldBuilder {
  build(config: WorldBuildConfig): WorldAsset {
    const gridSize = config.gridSize ?? 20
    // ... 现有构建逻辑不变 ...
    return {
      group: this.group,
      name: 'Snake',
      dispose: () => this.dispose(),
    }
  }
  // ... 现有 addBox / dispose 方法不变 ...
}
```

---

## 4. 调用链

| 步骤 | 调用方 | 被调用方 | 方法 | 传入参数 | 返回值 | 备注 |
|------|--------|---------|------|---------|--------|------|
| 1 | `App.tsx` | `WorldRegistry` | `register('Snake', builder)` | 游戏名, WorldBuilder | void | 应用启动时注册 |
| 2 | 用户 | `ProjectSelector` | 点击工程卡片 | - | - | 选择 Snake |
| 3 | `ProjectSelector` | `editorStore` | `setCurrentProject(project)` | `{ name: 'Snake' }` | void | 更新状态 |
| 4 | `Viewport` | `WorldRegistry` | `get('Snake')` | 游戏名 | `WorldBuilder \| undefined` | 查找构建器 |
| 5 | `Viewport` | `SnakeScene3D` | `build({ gridSize: 20 })` | `WorldBuildConfig` | `WorldAsset` | 构建 3D 场景 |
| 6 | `Viewport` | `sharedScene` | `add(asset.group)` | `THREE.Group` | void | 添加到场景 |
| 7 | `Viewport` | `arenaRef` | 保存 asset 引用 | `WorldAsset` | void | 用于后续清理 |
| 8 | 下次切换工程 | `Viewport` | `arenaRef.dispose()` | - | void | 卸载旧地图 |

---

## 5. 相关文件

### 新建文件

| 文件路径 | 操作 | 说明 |
|---------|------|------|
| `src/framework/WorldAsset.ts` | **新建** | WorldBuilder 接口、WorldAsset、WorldBuildConfig 类型定义 |
| `src/framework/WorldRegistry.ts` | **新建** | 静态注册中心 |

### 修改文件

| 文件路径 | 操作 | 说明 |
|---------|------|------|
| `src/games/snake/Scene3D.ts` | **修改** | 实现 `WorldBuilder` 接口，`build()` 返回 `WorldAsset` |
| `src/components/Viewport.tsx` | **修改** | 用 `WorldRegistry` 替换硬编码的 `if (name === 'Snake')` |
| `src/framework/index.ts` | **修改** | 导出 `WorldBuilder`、`WorldAsset`、`WorldRegistry` |
| `src/App.tsx` | **修改** | 初始化时注册 SnakeWorldBuilder |
| `src/games/snake/index.ts` | **修改** | 导出 SnakeScene3D 作为 WorldBuilder |
| `projects/snake/project.json` | **修改** | （可选）添加 `worldConfig.gridSize` 字段 |

---

## 6. 实现步骤

### Step 1: 创建类型定义

创建 `src/framework/WorldAsset.ts`，定义 `WorldBuildConfig`、`WorldAsset`、`WorldBuilder`。

### Step 2: 创建注册中心

创建 `src/framework/WorldRegistry.ts`，实现静态注册/查找。

### Step 3: 改造 SnakeScene3D

修改 `src/games/snake/Scene3D.ts`，让类实现 `WorldBuilder` 接口，`build()` 返回 `WorldAsset`。

### Step 4: 注册构建器

在 `src/App.tsx` 中，初始化完成后注册：
```typescript
import { SnakeScene3D } from './games/snake'
WorldRegistry.register('Snake', new SnakeScene3D())
```

### Step 5: 改造 Viewport

将 `useEffect([currentProject])` 中的硬编码判断替换为：
```typescript
if (currentProject) {
  const builder = WorldRegistry.get(currentProject.name)
  if (builder) {
    const asset = builder.build({ gridSize: 20 })
    shared.add(asset.group)
    arenaRef.current = asset
  }
}
```

### Step 6: 输出 framework

在 `src/framework/index.ts` 中添加新类的导出。

---

## 7. 优缺点分析

### 优点

1. **解耦彻底** — Viewport 不再需要知道任何具体游戏名，新增游戏只需 `register` + `project.json`，Viewport 零改动
2. **与现有架构吻合** — 基于已有的 `GameInstance`/`Game` 抽象模式，`WorldRegistry.register` 与 UE 的注册模式一致，学习成本低
3. **配置可扩展** — `WorldBuildConfig` 使用 `[key: string]: unknown`，允许每个游戏自定义配置字段，未来可从 `project.json` 读取

### 缺点

1. **仍为代码生成** — 地图资源依然是代码硬编码，不支持外部资源文件（glTF/OBJ）。**缓解措施**: Builder 接口本身不限制实现方式，后续可添加 `FileWorldBuilder` 子类
2. **注册时机依赖** — 必须在 Viewport 使用前注册，否则 `get()` 返回 undefined。**缓解措施**: 在 `App.tsx` 的 `useEffect` 初始化阶段就完成注册

### 适用场景

- 编辑器需要支持多游戏/多工程切换
- 每个游戏的地图由代码生成（程序化生成）
- 需要统一的地图生命周期管理（加载/卸载/释放）

### 不适用场景

- 需要从外部文件（glTF/FBX/OBJ）加载地图资产的场景（需额外实现 `FileWorldBuilder` 或加载器）
- 需要运行时动态下载地图资源的场景

---

## 8. 后续扩展

### 8.1 支持从 project.json 读取配置

```json
{
  "name": "Snake",
  "worldConfig": {
    "gridSize": 30,
    "theme": "neon"
  }
}
```

Viewport 中：
```typescript
const config = currentProject.worldConfig ?? { gridSize: 20 }
const asset = builder.build(config)
```

### 8.2 支持外部文件加载

```typescript
class GltfWorldBuilder implements WorldBuilder {
  async build(config: WorldBuildConfig): Promise<WorldAsset> {
    const loader = new THREE.GLTFLoader()
    const gltf = await loader.loadAsync(config.url!)
    return { group: gltf.scene, name: config.name!, dispose: () => ... }
  }
}
```
