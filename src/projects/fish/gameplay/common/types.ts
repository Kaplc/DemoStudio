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
export type FishArt = 'small' | 'medium' | 'large' | 'fast' | 'rare' | 'puffer' | 'eel' | 'clown' | 'manta'
  | 'boss_shark' | 'boss_kraken' | 'boss_dragon' | 'boss_whale' | 'boss_crab'

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

/** 鱼种配置（对应 fish.config.json） */
export interface FishConfig {
  fishTypes: FishType[]
}

export const DEFAULT_FISH_CONFIG: FishConfig = {
  fishTypes: [
    { key: 'guppy', name: '小鱼',   size: [1.4, 0.9], speed: 3.2, score: 3,   hp: 3,   radius: 0.6, captureChance: 0.15,  weight: 30, art: 'small', schoolSize: [6, 12] },
    { key: 'clown', name: '小丑鱼', size: [1.2, 0.8], speed: 3.5, score: 4,   hp: 3,   radius: 0.5, captureChance: 0.18,  weight: 28, art: 'clown', schoolSize: [8, 14] },
    { key: 'angel', name: '神仙鱼', size: [2.0, 1.4], speed: 2.6, score: 8,   hp: 8,   radius: 0.9, captureChance: 0.07,  weight: 24, art: 'medium', schoolSize: [4, 8] },
    { key: 'dart',  name: '飞鱼',   size: [1.2, 0.7], speed: 5.5, score: 9,   hp: 5,   radius: 0.5, captureChance: 0.09,  weight: 14, art: 'fast', schoolSize: [5, 10] },
    { key: 'puffer',name: '河豚',   size: [2.0, 2.0], speed: 1.8, score: 15,  hp: 20,  radius: 1.1, captureChance: 0.04,  weight: 12, art: 'puffer',schoolSize: [2, 3] },
    { key: 'eel',   name: '电鳗',   size: [3.5, 0.8], speed: 4.0, score: 20,  hp: 10,  radius: 0.7, captureChance: 0.05,  weight: 10, art: 'eel',   schoolSize: [1, 2] },
    { key: 'tuna',  name: '金枪鱼', size: [3.0, 1.8], speed: 2.0, score: 28,  hp: 22,  radius: 1.3, captureChance: 0.035, weight: 14, art: 'large', schoolSize: [2, 4] },
    { key: 'glow',  name: '发光鱼', size: [2.2, 1.5], speed: 2.8, score: 45,  hp: 16,  radius: 1.0, captureChance: 0.025, weight: 6,  art: 'rare', schoolSize: [2, 4] },
    { key: 'manta', name: '魔鬼鱼', size: [4.0, 3.0], speed: 2.2, score: 55,  hp: 35,  radius: 1.8, captureChance: 0.015, weight: 4,  art: 'manta', schoolSize: [1, 2] },
  ],
}

/** 炮等级配置 */
export interface CannonLevel {
  level: number
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

/** 炮台配置（对应 cannon.config.json） */
export interface CannonConfig {
  initialLevel: number
  levels: CannonLevel[]
}

export const DEFAULT_CANNON_CONFIG: CannonConfig = {
  initialLevel: 1,
  levels: [
    { level: 1, name: 'I 型炮',   cost: 1, power: 1, captureBonus: 1.0, netRadius: 0.8, netSpeed: 18, fireCooldown: 0.28 },
    { level: 2, name: 'II 型炮',  cost: 2, power: 3, captureBonus: 1.3, netRadius: 1.1, netSpeed: 20, fireCooldown: 0.22 },
    { level: 3, name: 'III 型炮', cost: 4, power: 6, captureBonus: 1.7, netRadius: 1.5, netSpeed: 22, fireCooldown: 0.18 },
    { level: 4, name: 'IV 型炮',  cost: 7, power: 10, captureBonus: 2.2, netRadius: 2.0, netSpeed: 24, fireCooldown: 0.15 },
    { level: 5, name: 'V 型炮',   cost: 12, power: 16, captureBonus: 3.0, netRadius: 2.6, netSpeed: 26, fireCooldown: 0.12 },
  ],
}

/** Boss 类型配置（扩展自 FishType，不含 weight/schoolSize） */
export interface BossType {
  key: string
  name: string
  size: [number, number]
  speed: number
  score: number
  hp: number
  radius: number
  captureChance: number
  art: FishArt
}

/** Boss 配置（对应 boss.config.json） */
export interface BossConfig {
  /** Boss 出现间隔（秒） */
  bossInterval: number
  /** Boss 类型列表，生成时随机选一个 */
  bossTypes: BossType[]
}

export const DEFAULT_BOSS_CONFIG: BossConfig = {
  bossInterval: 40,
  bossTypes: [
    { key: 'shark',  name: '大白鲨', size: [5.5, 3.0], speed: 1.8, score: 300, hp: 130, radius: 2.4, captureChance: 0.008, art: 'boss_shark' },
    { key: 'kraken', name: '克拉肯', size: [6.0, 4.0], speed: 1.2, score: 500, hp: 200, radius: 2.8, captureChance: 0.005, art: 'boss_kraken' },
    { key: 'dragon', name: '海龙',   size: [5.0, 3.5], speed: 2.5, score: 400, hp: 160, radius: 2.5, captureChance: 0.006, art: 'boss_dragon' },
    { key: 'whale',  name: '巨鲸',   size: [7.0, 4.5], speed: 0.8, score: 800, hp: 350, radius: 3.2, captureChance: 0.003, art: 'boss_whale' },
    { key: 'crab',   name: '巨蟹王', size: [4.5, 4.0], speed: 1.0, score: 600, hp: 250, radius: 2.6, captureChance: 0.004, art: 'boss_crab' },
  ],
}

/** 鱼群生成节奏配置（对应 school.config.json） */
export interface SchoolTimingConfig {
  /** 基础间隔（秒） */
  baseInterval: number
  /** 最小间隔（秒，难度递增后不低于此值） */
  minInterval: number
  /** 衰减率（每秒减少量） */
  decayRate: number
  /** 随机区间下限（乘法系数） */
  timerRandomLow: number
  /** 随机区间上限（乘法系数） */
  timerRandomHigh: number
}

/** 鱼群/散兵生成配置（对应 school.config.json） */
export interface SchoolConfig {
  school: SchoolTimingConfig
  single: SchoolTimingConfig
  spawn: {
    /** 鱼群垂直散布因子（× 鱼 size[1]） */
    schoolSpreadFactor: number
    /** 鱼群游速变化下限 */
    speedVariationMin: number
    /** 鱼群游速变化随机幅度 */
    speedVariationMax: number
    /** 边缘出生外扩量（世界单位） */
    spawnMargin: number
    /** 散兵 Y 方向内外边距（世界单位） */
    singleYSpawnMargin: number
  }
}

export const DEFAULT_SCHOOL_CONFIG: SchoolConfig = {
  school: {
    baseInterval: 5.0,
    minInterval: 2.0,
    decayRate: 0.025,
    timerRandomLow: 0.6,
    timerRandomHigh: 0.8,
  },
  single: {
    baseInterval: 1.8,
    minInterval: 0.6,
    decayRate: 0.015,
    timerRandomLow: 0.5,
    timerRandomHigh: 1.0,
  },
  spawn: {
    schoolSpreadFactor: 1.8,
    speedVariationMin: 0.85,
    speedVariationMax: 0.3,
    spawnMargin: 1.0,
    singleYSpawnMargin: 2.0,
  },
}

/** 初始金币 */
export const INITIAL_COINS = 100
/** 网最大飞行距离（世界单位，超出销毁） */
export const NET_MAX_DISTANCE = 24
