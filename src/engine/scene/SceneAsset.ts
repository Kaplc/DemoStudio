/**
 * SceneAsset — 声明式场景资产类型定义
 * 由 JSON 文件描述（如 src/projects/snake/snake.scene.json），
 * SceneLoader 读取后构建为 THREE.Group。
 *
 * 节点分两类：
 *   - 原子节点 box / plane / sphere：对应单个 Three.js 几何体
 *   - 模板节点 checkerFloor / gridLines / pillar / wallRing：在 loader 内展开为多个几何体
 *
 * 颜色统一用 CSS hex 字符串 "#rrggbb"，loader 内部用 new THREE.Color(str) 转换，
 * 与旧代码 0x 数字颜色结果完全一致。
 */

import type { PropertyPatch } from '../tools/deepMerge'

/** 颜色：CSS hex 字符串 "#rrggbb" */
export type ColorHex = string

export type Vec2 = [number, number]
export type Vec3 = [number, number, number]

/** 通用材质参数（所有节点共享，字段全可选，缺失走 loader 默认） */
export interface MaterialProps {
  color?: ColorHex
  /** 纹理路径（可选，加载后作为 map；与 color 叠加，通常配 color=#ffffff） */
  texture?: string
  roughness?: number
  metalness?: number
  opacity?: number
  transparent?: boolean
  castShadow?: boolean
  receiveShadow?: boolean
  /** "standard"=MeshStandardMaterial（默认）| "basic"=MeshBasicMaterial */
  kind?: 'standard' | 'basic'
}

interface BaseNode {
  name?: string
}

/** box 原子节点 — 对应 BoxGeometry；cast/receiveShadow 默认 true（对齐旧 addBox） */
export interface BoxNode extends BaseNode {
  type: 'box'
  size: Vec3
  pos?: Vec3
  /** 旋转 [x,y,z] 弧度 */
  rot?: Vec3
  material?: MaterialProps
}

/** plane 原子节点 — 对应 PlaneGeometry（仅用 size 前两位） */
export interface PlaneNode extends BaseNode {
  type: 'plane'
  size: Vec3
  pos?: Vec3
  rot?: Vec3
  material?: MaterialProps
}

/** sphere 原子节点 — 对应 SphereGeometry(radius, segments, segments) */
export interface SphereNode extends BaseNode {
  type: 'sphere'
  radius: number
  pos?: Vec3
  segments?: number
  material?: MaterialProps
}

/** 模板：棋盘格地板（gridSize×gridSize 个交替色 tile） */
export interface CheckerFloorNode extends BaseNode {
  type: 'checkerFloor'
  gridSize: number
  colors?: [ColorHex, ColorHex]
  /** 单格边长，默认 0.96 */
  tileSize?: number
  /** 离地高度，默认 0.02 */
  y?: number
  material?: MaterialProps
}

/** 模板：网格线（沿 X/Z 各 gridSize+1 条，共享同一材质） */
export interface GridLinesNode extends BaseNode {
  type: 'gridLines'
  gridSize: number
  color?: ColorHex
  opacity?: number
  /** 线宽，默认 0.02 */
  thickness?: number
  y?: number
}

/** 模板：单根角柱（柱身 + 顶盖 + 顶部球） */
export interface PillarNode extends BaseNode {
  type: 'pillar'
  /** 地面坐标 [x, z]，y 由各子部件内部决定 */
  pos: Vec2
  colors?: { shaft?: ColorHex; cap?: ColorHex; orb?: ColorHex }
}

/** 模板：围墙环（四面墙 + 四条顶盖） */
export interface WallRingNode extends BaseNode {
  type: 'wallRing'
  gridSize: number
  /** 墙高，默认 1.2 */
  height?: number
  wallColor?: ColorHex
  capColor?: ColorHex
  /** 墙厚，默认 0.3 */
  thickness?: number
  wallMaterial?: MaterialProps
  capMaterial?: MaterialProps
}

/** sprite 原子节点 — 2D 精灵：XY 平面 PlaneGeometry（法线 +Z，面向 -Z 相机），可纯色或贴图 */
export interface SpriteNode extends BaseNode {
  type: 'sprite'
  /** 宽高 [w, h]（世界单位） */
  size: Vec2
  pos?: Vec3
  /** 旋转 [x,y,z] 弧度 */
  rot?: Vec3
  /** 纹理路径（顶层便捷字段；缺失时用 material.texture / material.color） */
  texture?: string
  material?: MaterialProps
}

/** 引用节点 — 引用另一个蓝图资产（类似 BlueprintChildDef.ref），由 World.SpawnActorFromBlueprint 实例化 */
export interface RefNode extends BaseNode {
  type: 'ref'
  /** 引用的蓝图路径 */ // @deprecated blueprint
  ref: string
  /** 也兼容旧的 `blueprint` 字段名 */
  blueprint?: string
  /** 世界坐标位置（兼容旧字段 pos） */
  position?: Vec3
  pos?: Vec3
  /** 欧拉旋转角弧度（兼容旧字段 rot） */
  rotation?: Vec3
  rot?: Vec3
  scale?: Vec3
  /** 实例级属性覆盖（叠加在蓝图 CDO 之上） */
  overrides?: PropertyPatch
}

/** blueprint 节点 — 旧格式，兼容保留；新场景应使用 RefNode */
export interface BlueprintNode extends BaseNode {
  type: 'blueprint'
  /** 引用的 Blueprint 路径 */
  blueprint: string
  pos?: Vec3
  rot?: Vec3
  scale?: Vec3
  /** 实例级属性覆盖（叠加在蓝图 CDO 之上） */
  overrides?: PropertyPatch
}

/** 内联 Actor 节点 — 直接在场景中定义一个 Actor（类似 BlueprintChildDef，baseClass + components + children） */
export interface ActorNode extends BaseNode {
  type: 'actor'
  /** ActorRegistry 类型名（如 'Actor'、'FishHouse' 等） */
  baseClass: string
  /** 世界坐标位置 */
  position?: Vec3
  /** 欧拉旋转角弧度 */
  rotation?: Vec3
  /** 缩放 */
  scale?: Vec3
  /** 默认挂载的 Component */
  components?: import('../gameplay/blueprint/BlueprintAsset').BlueprintComponentDef[]
  /** 子 Actor（递归，支持内联和引用） */
  children?: import('../gameplay/blueprint/BlueprintAsset').BlueprintChildDef[]
}

export type SceneNode =
  | BoxNode | PlaneNode | SphereNode | SpriteNode
  | CheckerFloorNode | GridLinesNode | PillarNode | WallRingNode
  | BlueprintNode | RefNode | ActorNode

/** 天空盒/场景氛围配置 */
export interface SkyboxConfig {
  /** 背景颜色 (#rrggbb)，不设置则使用引擎默认 (0x1a1a2e) */
  backgroundColor?: ColorHex
  /** 雾效颜色 (#rrggbb) */
  fogColor?: ColorHex
  /** 雾效近裁剪距离 */
  fogNear?: number
  /** 雾效远裁剪距离 */
  fogFar?: number
  /** 天空盒立方体贴图路径前缀（如 /textures/skybox/sky），
   *  6 张图片命名约定为 {skyboxPath}_px.{ext}, _nx, _py, _ny, _pz, _nz */
  skyboxPath?: string
  /** 立方体贴图文件后缀，默认 .jpg */
  skyboxExt?: string
}

/** 场景资产根文档 */
export interface SceneAsset {
  name: string
  /** 场景对应的游戏阶段/模式标识（如 "menu"、"base"、"game"），由 GameInstance 据此决定启动哪个 GameMode */
  mode?: string
  objects: SceneNode[]
  /** 天空盒/背景/雾效配置（可选） */
  skybox?: SkyboxConfig
}
