/** 3D 赛车游戏类型定义 */

/** 游戏配置 */
export interface GameConfig {
  /** 赛道半径 */
  trackRadius: number
  /** 赛道宽度 */
  trackWidth: number
  /** 路面分段数 */
  trackSegments: number

  /** 最大速度 */
  maxSpeed: number
  /** 加速度 */
  acceleration: number
  /** 刹车减速度 */
  brakeDecel: number
  /** 自然摩擦减速度 */
  friction: number
  /** 转向速度 (rad/s) */
  steerSpeed: number
  /** 转向恢复速度 */
  steerReturnSpeed: number
  /** 最大转向角 (rad) */
  maxSteerAngle: number

  /** 圈数 */
  lapsToWin: number
  /** 倒计时 (秒) */
  countdownTime: number
  /** 游戏时间限制 (秒) */
  timeLimit: number
}

export const DEFAULT_CONFIG: GameConfig = {
  trackRadius: 18,
  trackWidth: 8,
  trackSegments: 48,

  maxSpeed: 25,
  acceleration: 12,
  brakeDecel: 20,
  friction: 4,
  steerSpeed: 2.5,
  steerReturnSpeed: 5,
  maxSteerAngle: 0.6,

  lapsToWin: 3,
  countdownTime: 3,
  timeLimit: 120,
}

export type GamePhase = 'countdown' | 'racing' | 'finished' | 'gameover'
