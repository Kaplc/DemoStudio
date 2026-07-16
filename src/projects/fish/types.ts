/**
 * FishMaster — 捕鱼达人配置
 * 坐标系：XY 平面(z=0)，正交相机沿 +Z 朝 -Z 看，x→右、y→上。
 * 海域 x∈[-AREA_W, AREA_W]，y∈[-AREA_H, AREA_H]，炮台在底部 (0, CANNON_Y)。
 */

/** 相机正交半高 */
export const CAMERA_ORTHO_SIZE = 10
/** 海域半宽（鱼在此范围游动 / 出界即销毁） */
export const AREA_W = 17.5
/** 海域半高 */
export const AREA_H = 9.5
/** 炮台 Y（底部偏上一点） */
export const CANNON_Y = -AREA_H + 1.5

/** 美术变体（对应 textures.ts 的绘制函数） */
export type FishArt = 'small' | 'medium' | 'large' | 'fast' | 'rare' | 'boss'

/** 鱼种配置 */
export interface FishType {
  key: string
  name: string
  /** 体型 [w, h] 世界单位 */
  size: [number, number]
  /** 游速（世界单位/秒） */
  speed: number
  /** 分值（金币） */
  score: number
  /** 最大 hp */
  hp: number
  /** 碰撞半径 */
  radius: number
  /** 基础捕获率（0~1）：roll < captureChance*captureBonus 即秒捕 */
  captureChance: number
  /** 出现权重（相对；Boss weight=0 由定时器单独生成） */
  weight: number
  art: FishArt
  boss?: boolean
  /** 鱼群数量范围 [最小, 最大] — 成群出现 */
  schoolSize: [number, number]
}

/** 鱼种表（权重>0 的进随机池；shark 仅 Boss 定时器生成） */
export const FISH_TYPES: FishType[] = [
  { key: 'guppy', name: '小鱼',   size: [1.4, 0.9], speed: 3.2, score: 3,   hp: 3,   radius: 0.6, captureChance: 0.15,  weight: 30, art: 'small', schoolSize: [6, 12] },
  { key: 'angel', name: '神仙鱼', size: [2.0, 1.4], speed: 2.6, score: 8,   hp: 8,   radius: 0.9, captureChance: 0.07,  weight: 24, art: 'medium', schoolSize: [4, 8] },
  { key: 'tuna',  name: '金枪鱼', size: [3.0, 1.8], speed: 2.0, score: 28,  hp: 22,  radius: 1.3, captureChance: 0.035, weight: 14, art: 'large', schoolSize: [2, 4] },
  { key: 'dart',  name: '飞鱼',   size: [1.2, 0.7], speed: 5.5, score: 9,   hp: 5,   radius: 0.5, captureChance: 0.09,  weight: 14, art: 'fast', schoolSize: [5, 10] },
  { key: 'glow',  name: '发光鱼', size: [2.2, 1.5], speed: 2.8, score: 45,  hp: 16,  radius: 1.0, captureChance: 0.025, weight: 6,  art: 'rare', schoolSize: [2, 4] },
  { key: 'shark', name: '鲨鱼 Boss', size: [5.5, 3.0], speed: 1.5, score: 300, hp: 130, radius: 2.4, captureChance: 0.008, weight: 0, art: 'boss', boss: true, schoolSize: [1, 1] },
]

/** 炮等级配置 */
export interface CannonLevel {
  level: 1 | 2 | 3
  name: string
  /** 单发消耗金币 */
  cost: number
  /** 命中威力（扣 hp） */
  power: number
  /** 捕获率加成倍数 */
  captureBonus: number
  /** 网碰撞半径 */
  netRadius: number
  /** 网飞行速度 */
  netSpeed: number
  /** 连射冷却（秒） */
  fireCooldown: number
}

export const CANNON_LEVELS: CannonLevel[] = [
  { level: 1, name: 'I 型炮',   cost: 1, power: 1, captureBonus: 1.0, netRadius: 0.8, netSpeed: 18, fireCooldown: 0.28 },
  { level: 2, name: 'II 型炮',  cost: 2, power: 3, captureBonus: 1.3, netRadius: 1.1, netSpeed: 20, fireCooldown: 0.22 },
  { level: 3, name: 'III 型炮', cost: 4, power: 6, captureBonus: 1.7, netRadius: 1.5, netSpeed: 22, fireCooldown: 0.18 },
]

/** 初始金币 */
export const INITIAL_COINS = 100
/** Boss 出现间隔（秒） */
export const BOSS_INTERVAL = 45
/** 网最大飞行距离（世界单位，超出销毁） */
export const NET_MAX_DISTANCE = 24
