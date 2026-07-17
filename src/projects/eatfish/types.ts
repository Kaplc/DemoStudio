/** 大鱼吃小鱼游戏类型定义 */

/** 2D 平面坐标（XZ 平面） */
export interface Vec2 {
  x: number
  z: number
}

/** 游戏配置 */
export interface GameConfig {
  /** 竞技场半宽 */
  arenaHalf: number
  /** 玩家初始大小 */
  playerInitialScale: number
  /** 玩家移动速度 */
  playerSpeed: number
  /** 玩家旋转速度 (rad/s) */
  playerRotateSpeed: number

  /** 食物鱼数量 */
  foodFishCount: number
  /** 食物鱼最小大小 */
  foodFishMinScale: number
  /** 食物鱼最大大小 */
  foodFishMaxScale: number
  /** 食物鱼速度 */
  foodFishSpeed: number

  /** predator 鱼数量 */
  predatorCount: number
  /** predator 初始大于玩家倍数 */
  predatorScaleMultiplier: number
  /** predator 速度 */
  predatorSpeed: number
  /** predator 追捕范围 */
  predatorChaseRange: number

  /** 每吃一条鱼增加的大小 */
  growPerEat: number
  /** 初始无敌时间 (秒) */
  invincibleTime: number

  // ─── 鱼群参数 ───
  /** 鱼群数量 */
  schoolCount: number
  /** 每个鱼群的鱼数 */
  fishPerSchool: number
  /** 鱼群聚集半径 */
  schoolRadius: number
  /** 鱼群内部分离距离 */
  schoolSeparation: number
  /** 跟随领航鱼强度 (0~1) */
  schoolFollowStrength: number
  /** 鱼群颜色主题列表 */
  schoolColors: number[][]
}

/**
 * 数据表行：鱼类原型（DataTable 示例，见 fish.table.json）。
 * color 为数字（加载时由 "#rrggbb" 经 parseHexColor 转换）。
 */
export interface FishArchetype {
  /** 显示名 */
  label: string
  /** 体型缩放 */
  scale: number
  /** 游动速度 */
  speed: number
  /** 分数 */
  score: number
  /** 颜色（数字 hex，如 0xff7043） */
  color: number
}

/**
 * EatFish 默认配置。双重角色：
 *   1. ConfigRegistry.registerDefaults 注册的同步 fallback（JSON 未加载 / 读取失败时兜底）。
 *   2. eatfish.config.json 的镜像源（JSON 颜色为 "#rrggbb" 字符串，此处为数字字面量）。
 */
export const DEFAULT_CONFIG: GameConfig = {
  arenaHalf: 15,
  playerInitialScale: 1.0,
  playerSpeed: 6,
  playerRotateSpeed: 2.5,

  foodFishCount: 18,
  foodFishMinScale: 0.25,
  foodFishMaxScale: 0.7,
  foodFishSpeed: 2,

  predatorCount: 2,
  predatorScaleMultiplier: 1.8,
  predatorSpeed: 3.5,
  predatorChaseRange: 12,

  growPerEat: 0.08,
  invincibleTime: 2,

  // ─── 鱼群参数 ───
  schoolCount: 3,
  fishPerSchool: 6,
  schoolRadius: 4,
  schoolSeparation: 0.6,
  schoolFollowStrength: 0.6,
  schoolColors: [
    [0xff7043, 0xff8a65, 0xffab91], // 橙红系
    [0x42a5f5, 0x64b5f6, 0x90caf9], // 蓝系
    [0x66bb6a, 0x81c784, 0xa5d6a7], // 绿系
    [0xab47bc, 0xce93d8, 0xe1bee7], // 紫系
    [0xffca28, 0xffd54f, 0xffe082], // 黄系
    [0xec407a, 0xf06292, 0xf48fb1], // 粉系
  ],
}

export type GameStatus = 'idle' | 'running' | 'gameover'

/** 鱼群成员信息 */
export interface SchoolMemberInfo {
  /** 在此鱼群中的索引 */
  index: number
  /** 相对中心偏移 */
  offsetX: number
  offsetZ: number
  /** 游动相位 (用于差异化动画) */
  phase: number
}

/**
 * 解析 CSS hex 颜色字符串 → 数字。
 * 用于把 JSON 中的 "#rrggbb" 转换为消费方（setBodyColor / setHex）所需的数字。
 * 支持 "#ff7043" / "ff7043" / "0xff7043" 三种写法。
 */
export function parseHexColor(s: string): number {
  const hex = s.replace(/^#/, '').replace(/^0x/, '')
  return parseInt(hex, 16)
}
