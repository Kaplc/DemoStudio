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

/** 颜色：CSS hex 字符串 "#rrggbb" */
export type ColorHex = string

export type Vec2 = [number, number]
export type Vec3 = [number, number, number]

/** 通用材质参数（所有节点共享，字段全可选，缺失走 loader 默认） */
export interface MaterialProps {
  color?: ColorHex
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

export type SceneNode =
  | BoxNode | PlaneNode | SphereNode
  | CheckerFloorNode | GridLinesNode | PillarNode | WallRingNode

/** 场景资产根文档 */
export interface SceneAsset {
  name: string
  objects: SceneNode[]
}
