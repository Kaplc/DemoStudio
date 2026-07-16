/**
 * Demo2D — 2D 演示项目配置常量
 * 坐标系：XY 平面（z=0），正交相机沿 +Z 朝 -Z 看，x→右、y→上
 */
export const CONFIG = {
  /** 移动边界（玩家位置被夹在 ±bound） */
  bound: 9,
  /** 玩家移动速度（世界单位/秒） */
  playerSpeed: 8,
  /** 玩家碰撞半径 */
  playerRadius: 0.7,
  /** 金币碰撞半径 */
  coinRadius: 0.4,
}

export const BOUND = CONFIG.bound
export const PLAYER_RADIUS = CONFIG.playerRadius
export const COIN_RADIUS = CONFIG.coinRadius
