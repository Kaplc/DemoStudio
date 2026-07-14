/** 贪吃蛇游戏类型定义 */

export interface Vec2 {
  x: number
  z: number
}

export interface GameConfig {
  gridSize: number
  cellSize: number
  moveInterval: number
  gridHalf: number
}

export const DEFAULT_CONFIG: GameConfig = {
  gridSize: 20,
  cellSize: 1,
  moveInterval: 0.15,
  gridHalf: 10,
}

export type Direction = 'up' | 'down' | 'left' | 'right'

export const DIRECTION_VECTORS: Record<Direction, Vec2> = {
  up: { x: 0, z: -1 },
  down: { x: 0, z: 1 },
  left: { x: -1, z: 0 },
  right: { x: 1, z: 0 },
}

export type GameStatus = 'idle' | 'running' | 'gameover'
