/**
 * ClashMaster — 部落冲突配置
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

// ════════════════════════════════════════════
//  兵种配置（部落冲突风格，对应 troop.table.json）
// ════════════════════════════════════════════

/** 兵种攻击目标类型 */
export type TroopTarget = 'ground' | 'both'
/** 兵种攻击偏好（决定索敌优先级） */
export type TroopPreferred = 'any' | 'defenses' | 'resources' | 'walls'

/** 兵种配置行（DataTable 行表，对应 troop.table.json 的每一行） */
export interface TroopType {
  /** 显示名 */
  name: string
  /** 描述 */
  desc: string
  /** 占用兵营空间 */
  housing: number
  /** 训练费用（金币） */
  cost: number
  /** 训练时间（秒） */
  trainTime: number
  /** 生命值 */
  hp: number
  /** 每秒伤害（0 = 无伤害，如治疗师） */
  dps: number
  /** 攻击距离（世界单位；近战填 0.5） */
  range: number
  /** 移动速度（世界单位/秒） */
  speed: number
  /** 目标类型 */
  target: TroopTarget
  /** 攻击偏好（决定索敌优先级） */
  preferred: TroopPreferred
  /** 渲染尺寸 [宽, 高, 深] 世界单位 */
  size: [number, number, number]
  /** 是否飞行单位 */
  flying: boolean
  /** 主体颜色（#rrggbb，加载时归一化为数字） */
  color: number
  /** 兵种模型蓝图路径（胶囊体模型，如 'asset/blueprints/troops/barbarian.blueprint.json'） */
  blueprint: string
}

/** 兵种配置默认值（JSON 未加载时的同步 fallback） */
export const DEFAULT_TROOPS: Record<string, TroopType> = {
  barbarian: {
    name: '野蛮人', desc: '近战肉搏单位，数量取胜的炮灰。',
    housing: 1, cost: 25, trainTime: 20, hp: 45, dps: 8, range: 1.5, speed: 4,
    target: 'ground', preferred: 'any', size: [0.8, 1.1, 0.8], flying: false, color: 0xe53935,
    blueprint: 'asset/blueprints/troops/barbarian.blueprint.json',
  },
  archer: {
    name: '弓箭手', desc: '远程输出单位，可攻击空中目标。',
    housing: 1, cost: 50, trainTime: 25, hp: 20, dps: 7, range: 4.0, speed: 6,
    target: 'both', preferred: 'any', size: [0.7, 1.0, 0.7], flying: false, color: 0x8e24aa,
    blueprint: 'asset/blueprints/troops/archer.blueprint.json',
  },
  goblin: {
    name: '哥布林', desc: '移速极快，优先攻击资源建筑。',
    housing: 1, cost: 25, trainTime: 22, hp: 25, dps: 11, range: 1.5, speed: 8,
    target: 'ground', preferred: 'resources', size: [0.7, 0.9, 0.7], flying: false, color: 0x2e7d32,
    blueprint: 'asset/blueprints/troops/goblin.blueprint.json',
  },
  giant: {
    name: '巨人', desc: '高血量坦克，优先攻击防御建筑。',
    housing: 5, cost: 250, trainTime: 120, hp: 300, dps: 11, range: 1.5, speed: 3,
    target: 'ground', preferred: 'defenses', size: [1.1, 1.5, 1.1], flying: false, color: 0x6d4c41,
    blueprint: 'asset/blueprints/troops/giant.blueprint.json',
  },
  wallBreaker: {
    name: '炸弹人', desc: '自爆式破墙单位，对城墙伤害翻倍。',
    housing: 2, cost: 1000, trainTime: 120, hp: 20, dps: 12, range: 1.5, speed: 6,
    target: 'ground', preferred: 'walls', size: [0.7, 0.9, 0.7], flying: false, color: 0x37474f,
    blueprint: 'asset/blueprints/troops/wallBreaker.blueprint.json',
  },
  balloon: {
    name: '气球兵', desc: '飞行投弹单位，优先攻击防御建筑。',
    housing: 5, cost: 2000, trainTime: 240, hp: 150, dps: 25, range: 1.5, speed: 2.5,
    target: 'ground', preferred: 'defenses', size: [1.0, 1.0, 1.0], flying: true, color: 0x5c6bc0,
    blueprint: 'asset/blueprints/troops/balloon.blueprint.json',
  },
  wizard: {
    name: '法师', desc: '高伤害远程单位，可攻击空中目标。',
    housing: 4, cost: 1500, trainTime: 180, hp: 75, dps: 50, range: 4.0, speed: 4,
    target: 'both', preferred: 'any', size: [0.7, 1.1, 0.7], flying: false, color: 0x7b1fa2,
    blueprint: 'asset/blueprints/troops/wizard.blueprint.json',
  },
  healer: {
    name: '治疗师', desc: '飞行治疗单位，每秒为友军恢复生命。',
    housing: 14, cost: 5000, trainTime: 360, hp: 500, dps: 0, range: 5.0, speed: 4,
    target: 'ground', preferred: 'any', size: [1.2, 0.8, 1.2], flying: true, color: 0x00897b,
    blueprint: 'asset/blueprints/troops/healer.blueprint.json',
  },
  dragon: {
    name: '飞龙', desc: '空中重火力单位，喷吐火焰攻击。',
    housing: 20, cost: 25000, trainTime: 900, hp: 1900, dps: 140, range: 3.0, speed: 4,
    target: 'both', preferred: 'any', size: [1.6, 1.4, 1.6], flying: true, color: 0xef6c00,
    blueprint: 'asset/blueprints/troops/dragon.blueprint.json',
  },
  pekka: {
    name: '皮卡超人', desc: '重装近战单位，剑刃劈砍一切。',
    housing: 25, cost: 30000, trainTime: 900, hp: 2800, dps: 260, range: 1.5, speed: 4,
    target: 'ground', preferred: 'any', size: [1.3, 1.9, 1.3], flying: false, color: 0x455a64,
    blueprint: 'asset/blueprints/troops/pekka.blueprint.json',
  },
}

// ════════════════════════════════════════════
//  关卡配置（对应 levels.table.json）
// ════════════════════════════════════════════

/** 关卡配置行（DataTable 行表，对应 levels.table.json 的每一行） */
export interface LevelType {
  /** 显示名（如"关卡 1"） */
  name: string
  /** 描述 */
  desc: string
  /** 对应场景资产 name（SwitchToScene 按 name 查找；场景资产 mode 必须为 "level"） */
  scene: string
  /** 地图面板节点位置（父容器局部坐标，占位值，作者可在编辑器微调） */
  pos: [number, number]
  /** 难度星级（1~5，占位显示） */
  stars: number
}

