/**
 * balance — 《暖流计划》数值中枢（默认值 + 配置表覆盖）
 *
 * 平衡方案 V1 全量数值的代码默认值在此；运行时经 refreshBalanceFromConfigs()
 * 用 asset/config/*.config.json / *.table.json 覆盖（GameMode.InitGame / restart 时刷新）。
 * 消费方一律读 B.*（可变单例），不要 import 旧常量。
 * 星图布局用画布坐标（1920×1080，y 向下），与渲染/拾取约定一致。
 */
import { ConfigRegistry } from '@/engine'
import type { PlanetId, ResearchLineId, SimBuilding, SimState, StarId } from './types'

// ─── 类型 ───

export interface StarBalance {
  id: StarId
  name: string
  /** 单船满载量（吨 H3） */
  load: number
  /** 距离系数（影响单程时间与油耗） */
  dist: number
  /** 解锁幕 */
  unlockAct: 1 | 2 | 3
}

export interface MapNodeCfg { x: number; y: number; r: number }

/**
 * 行星系子表（star_map.config.json systems 键，每系统一张表）：
 * center=本系中心天体（solar=sun，子系=行星）；nodes=本系成员布局（本系局部画布
 * 1920×1080，中心天体放 (960,540)，成员方位=初相位、距中心距离=轨道半径）。
 */
export interface MapSystemCfg { center: string; nodes: Record<string, MapNodeCfg> }

/** 舰队维护费阶梯行：ships = 船队规模上限（含），costPerS = 维护费速率（H3/秒，全舰队合计） */
export interface FleetMaintTier { ships: number; costPerS: number }

/** 轨道建筑定义（= orbit_build.table.json 行，行键 = OrbitBuilding.type；2026-09-09 近地轨道建设） */
export interface OrbitBuildingDef {
  name: string
  desc: string
  /** 建造造价（H3，选型落位时一次性扣除） */
  cost: number
  /** 建造工期（秒，tickBuild 灌进度） */
  buildTime: number
  /** 造船造价乘区（<1 = 经此建筑造船更便宜；仅对有造船能力的建筑生效） */
  shipBuildCostMult: number
  /** 造船时长除数（>1 = 经此建筑造船更快） */
  shipBuildSpeedMult: number
}

/** 矿种定义（= mineral_type.table.json 行，行键 = 矿点 type；2026-09-12 全息勘探） */
export interface MineralTypeDef {
  name: string
  desc: string
  /** 表现色（全息标记/面板色点；#RRGGBB） */
  color: string
}

/** 矿点定义（= mineral_deposit.table.json 行，行键 = SimMine.depositId） */
export interface MineralDepositDef {
  /** 所在天体（行星或卫星 id） */
  planet: string
  /** 矿种（mineral_type.table.json 行键） */
  type: string
  /** 纬度（deg，-90~90；全息球面布置角） */
  lat: number
  /** 经度（deg，0~360；t=0 相位，全息球自转随 group 整体走） */
  lon: number
  /** 总储量（吨；矿建采出递减，归零 = 枯竭停采） */
  reserve: number
}

/** 矿建定义（= mine_building.table.json 行，行键 = SimMine.type） */
export interface MineBuildingDef {
  name: string
  desc: string
  /** 建造造价（H3，选型落位时一次性扣除） */
  cost: number
  /** 建造工期（秒，tickMines 灌进度） */
  buildTime: number
  /** 满负荷产出速率（H3 吨/秒；受矿点余量门控，枯竭停采） */
  yieldPerS: number
  /** 可建矿种限制（mineral_type 行键逗号分隔；空 = 不限） */
  minTypes: string
}

/** 建筑定义（= building.table.json 行，行键 = SimBuilding.type） */
export interface BuildingDef {
  name: string
  desc: string
  /** 放置造价（H3） */
  cost: number
  /** 功能半径（地图 px；护盾气泡等，0 = 无半径功能） */
  radius: number
  /** 缓存物资上限（中转站） */
  bufferCap: number
  /** 护盾保全容量（耀斑结算名额） */
  shipCap: number
  /** 耀斑结束护盾内存活船恢复延迟（秒） */
  resumeDelay: number
  /** 拆除返还比例（按造价+缓存物资折算 H3） */
  refundPct: number
  /** 可否被航线链接（地球↔建筑 补给线） */
  linkable: boolean
  /** 强化分支表（一槽二选一；行键 = SimBuilding.upgrade；缺省 = 该建筑无强化） */
  upgrades?: Record<string, BuildingUpgradeDef>
}

/** 建筑强化分支定义（building.table.json 行内 upgrades 键；一槽二选一，装一拆一） */
export interface BuildingUpgradeDef {
  name: string
  desc: string
  /** 安装造价（H3，点击即扣；拆除费 = 造价 × 全局 demolishCostPct 不返还） */
  cost: number
  /** 效果修正（buildingEffectiveDef 合成；同键乘算/加算见字段语义） */
  mods: {
    /** 缓存上限乘区（×2 = 800→1600） */
    bufferCapMult?: number
    /** 功能半径乘区（×1.6 = 22→35） */
    radiusMult?: number
    /** 护盾保全名额加算（+2 = 2→4） */
    shipCapAdd?: number
    /** 反向补给线单船建材乘区（×1.5 重载吊臂） */
    hookMult?: number
  }
}

/** 环段建筑效果修正集（ringModsOf 聚合目标；乘算键线性叠乘、加算键加算，封底见 ringBuild.floor*） */
export interface RingModSet {
  /** 全局焚烧乘区（稳压环段 0.96/座；封底 floorBurnMult = 0.2） */
  burnMult: number
  /** 全船满载乘区（超导馈线 1.03/座） */
  loadMult: number
  /** 船队上限加算（扩容泊位 +1/座） */
  shipCapAdd: number
  /** 建设灌入泵速乘区（施工分段 1.05/座） */
  buildPumpMult: number
  /** 全线研究速率乘区（研究馈能 1.04/座） */
  researchMult: number
  /** 断环降温时长乘区（蓄热井 1.12/座 = 降得更慢） */
  coolTimeMult: number
  /** 堆心回温时长乘区（蓄热井 0.92/座 = 回得更快） */
  warmTimeMult: number
}

/** 环上建筑定义（= ring_building.table.json 行，行键 = ringBuildings[] 元素；全局经济修正） */
export interface RingBuildingDef {
  name: string
  desc: string
  /** 安装造价（H3，点击即扣；拆除费 = 造价 × ringBuild.demolishCostPct 走建设泵反向灌入） */
  cost: number
  /** 每座效果（线性叠加；键 = RingModSet 字段） */
  mods: Partial<RingModSet>
}

/** 船型定义（= ship_hull.table.json 行，行键 = SimShip.hull；造船时定型不可改装） */
export interface ShipHullDef {
  name: string
  desc: string
  /** 船体造价（H3；整单价 = 船体 + Σ模块，×船坞折扣） */
  cost: number
  /** 本船型满载乘区 */
  loadMult: number
  /** 本船型航速乘区 */
  speedMult: number
  /** 内置特性（'anti_freeze' = 冻毁免疫，罩外也存活） */
  innate: string[]
  /** 可装模块 id 清单（'*' = 全部） */
  allowed: string[]
}

/** 船用模块定义（= ship_module.table.json 行，行键 = SimShip.modules 元素；仅本船生效） */
export interface ShipModuleDef {
  name: string
  desc: string
  /** 模块造价（H3；并入造船整单价） */
  cost: number
  /** 效果（仅本船；乘算叠加） */
  mods: {
    /** 本船满载乘区（货舱扩容 ×1.3） */
    loadMult?: number
    /** 本船油耗乘区（副油箱 ×0.8） */
    fuelMult?: number
    /** 本船航速乘区（离子引擎 ×1.2） */
    speedMult?: number
    /** 装卸时长乘区（快速货泵 ×0.6） */
    workMult?: number
    /** 耀斑冻毁免疫（防冻加热器） */
    antiFreeze?: boolean
  }
}

/** 卡 id（= cards.table.json 行键） */
export type CardId = string

export type CardType = 'unlock' | 'upgrade'

export interface CardEffects {
  fuelMult?: number; speedMult?: number; cargoMult?: number; burnMult?: number
  /** 聚能环建设计费乘区（环网扩容 0.75，叠乘） */
  ringBuildCostMult?: number
  moonLoadAdd?: number; otherLoadAdd?: number; gravityAdd?: number; fleetBonus?: number
  flareWarning?: boolean
  /** 本次点亮交点数（双生节点=2，缺省 1） */
  extraNodes?: number
  /** 该线（self=触发线）下一节点生长倍率（一次性，节点完成后复位 1） */
  nextGrowth?: { line: 'self' | ResearchLineId; mult: number }
}

export interface CardDef {
  id: CardId
  name: string
  type: CardType
  line: ResearchLineId
  /** 得（绿字文案） */
  gain: string
  /** 失（红字文案） */
  cost: string
  effects: CardEffects
}

// ─── 画布常量（美术约定，非配置） ───

export const MAP_W = 1920
export const MAP_H = 1080

/** 地图系 → 世界系（XZ 地面；渲染/拾取/相机/GM 共用换算） */
export const toWX = (mx: number): number => mx - MAP_W / 2
export const toWZ = (my: number): number => my - MAP_H / 2

/** 太阳系取景天体清单（sol GM 命令与 focusSolarSystem 共用，天体增减只改此处；行星均可进入行星系视角） */
export const SOLAR_FOCUS_BODIES = ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'europa', 'saturn', 'uranus', 'neptune'] as const
export type SolarFocusBody = (typeof SOLAR_FOCUS_BODIES)[number]

/** 配色（模块 10 §2） */
export const COLORS = {
  bg0: '#0a1822',
  bg1: '#0e2a3a',
  panel: '#1a1f26',
  orange: '#ff6a3d',
  amber: '#ffb03d',
  ice: '#bfe9ff',
  blue: '#3fa9f5',
  green: '#43d17c',
  red: '#e84545',
  dim: '#5a707f',
} as const

// ─── 星图布局（每行星系一张子表；扁平 nodes/moons 由 flattenMapSystems 派生） ───

/** 代码内置默认星图子表（star_map.config.json 未加载时兜底；与表内容保持同步） */
export const DEFAULT_MAP_SYSTEMS = {
  solar: {
    center: 'sun',
    nodes: {
      sun: { x: 960, y: 540, r: 96 },
      mercury: { x: 932, y: 447, r: 11 },
      venus: { x: 1131, y: 599, r: 17 },
      earth: { x: 960, y: 790, r: 38 },
      mars: { x: 1230, y: 271, r: 34 },
      jupiter: { x: -296, y: 877, r: 46 },
      saturn: { x: 3263, y: 1158, r: 40 },
      uranus: { x: -3674, y: -703, r: 24 },
      neptune: { x: 8418, y: -407, r: 23 },
    },
  },
  earth: {
    center: 'earth',
    nodes: {
      earth: { x: 960, y: 540, r: 38 },
      moon: { x: 2160, y: 540, r: 17 },
    },
  },
  jupiter: {
    center: 'jupiter',
    nodes: {
      jupiter: { x: 960, y: 540, r: 46 },
      europa: { x: 960, y: 464, r: 30 },
    },
  },
} as Record<string, MapSystemCfg>

/**
 * 子表展开 → 全局扁平布局（B.map.nodes / B.map.moons，8 处消费文件的兼容接口）：
 * solar 表节点直落全局画布；子系表按"中心天体贴 solar 表同名锚点"整体平移，
 * 成员距中心距离 = 卫星轨道半径、方位 = 初相位（moons 由子系表自动派生，不再手写）。
 * 纯函数：改子表后重开一局由 refreshBalanceFromConfigs 重展开。
 */
export function flattenMapSystems(systems: Record<string, MapSystemCfg>): {
  nodes: Record<string, MapNodeCfg>
  moons: Record<string, { parent: string; radius: number }>
} {
  const nodes: Record<string, MapNodeCfg> = {}
  const moons: Record<string, { parent: string; radius: number }> = {}
  const solar = systems.solar
  if (solar) for (const [id, n] of Object.entries(solar.nodes)) nodes[id] = { ...n }
  for (const sys of Object.values(systems)) {
    if (!sys || sys === solar) continue
    const c = sys.nodes[sys.center]
    if (!c) continue
    // 子系中心锚点 = solar 表同名天体（其显示半径 r 亦以 solar 表为准）
    const anchor = nodes[sys.center] ?? { x: c.x, y: c.y, r: c.r }
    for (const [id, n] of Object.entries(sys.nodes)) {
      if (id === sys.center) continue
      nodes[id] = { x: anchor.x + (n.x - c.x), y: anchor.y + (n.y - c.y), r: n.r }
      moons[id] = { parent: sys.center, radius: Math.hypot(n.x - c.x, n.y - c.y) }
    }
  }
  return { nodes, moons }
}

/** 用当前 B.map.systems 重展开扁平 nodes/moons（配置覆盖后调用） */
function applyMapSystems(): void {
  const flat = flattenMapSystems(B.map.systems)
  B.map.nodes = flat.nodes as Record<'sun' | PlanetId | 'moon' | 'europa', MapNodeCfg>
  B.map.moons = flat.moons as Record<'moon' | 'europa', { parent: PlanetId; radius: number }>
}

/** 默认子表的初始扁平派生（B 字面量初始化用；展开语义见 flattenMapSystems） */
const DEFAULT_MAP_FLAT = flattenMapSystems(DEFAULT_MAP_SYSTEMS)

// ─── 运行时数值单例（默认值 = 平衡方案 V1） ───

export const B = {
  // 全局
  earthH3Start: 800,
  baseBurnPerLeg: 20,
  baseLegSeconds: 6,
  loadSeconds: 2,
  unloadSeconds: 2,
  dangerReserveSeconds: 60,
  /** 开局已建成环段数（第 1 格建成但空置：第一分钟引导完成第一次安装） */
  startSlots: 1,
  /** 环段槽位总数（25 槽位制：每建成一级交付一个空槽位，等级 = 已建成槽位数推导） */
  ringSlots: 25,
  /** 研究线弹卡封顶已建成槽位数（达到后停弹卡；≈ 旧 11/12 交点口径的等比映射 22/25） */
  researchSlotCap: 22,
  /** 等级阶梯级数（= 环段数；每级 1 研究点，25 级 = 25 点与改版前总量一致） */
  ringLevels: 25,
  nodeInterval: 130,
  runningRateBonus: 1.25,
  /** 研究点数加成：每点对所在线推进速率的加算倍率（速率 = 基础 × (1 + 点数×此值)） */
  researchPointRateAdd: 0.5,
  /** 研究点数计费：每点每秒消耗 H3（吨/秒/点；断环或储量耗尽不计费不加成） */
  researchPointCostPerS: 3,
  /** 聚能环建设（造价制，2026-09-08 拍板：每级槽位独立 H3 造价，进度 = 已投入 ÷ 本级造价。
   *  ring_build.config.json（标量）+ level_cost.table.json（逐级造价）可覆盖：
   *  defaultPoints = 开局建设点数；minPoints = 最低保留点数（回收封底，0 = 可清空暂停建设）；
   *  costPerS = 每点每秒灌入 H3（吨/秒/点，灌入即计费；全局速度杠杆，速度 = costPerS × 点数 ÷ 本级造价）；
   *  levelCost = 第 n 个环段的总造价（吨；灌满 → 交付；运行时 × ringBuildCostMult 卡折扣）。
   *  demolishCostPct = 环段建筑拆除费比例（造价 × 此值，走建设泵反向灌入 ≈ 同格建设时长 × 此值）；
   *  floorBurnMult / floorMult = 环建筑乘区防爆地板（焚烧乘区不低于 0.2，其余乘区不低于 0.5）。
   *  点数 0 或断环（=储量耗尽）停建，断环还停费，无衰减乘区。 */
  ringBuild: {
    defaultPoints: 1,
    minPoints: 0,
    costPerS: 2,
    demolishCostPct: 0.2,
    floorBurnMult: 0.2,
    floorMult: 0.5,
    levelCost: Array.from({ length: 25 }, () => 51),
  },
  /** 堆心温度降温时长（秒）：储量耗尽（断环）期间堆心从满温缓降到 0 = 堆心熄灭（蓄热井 ×coolTimeMult） */
  coreCoolSeconds: 30,
  /** 堆心温度升温时长（秒）：补入燃料后堆心从 0 缓慢回满（不会瞬间回满；蓄热井 ×warmTimeMult） */
  coreWarmSeconds: 10,
  initialShips: 3,
  shipBuildCost: 180,
  shipBuildTime: 15,
  cargoBase: 200,
  shipRebuildCost: 150,
  materialH3PerUnit: 0.5,
  /** 建筑强化拆除费比例（强化造价 × 此值，不返还；环段建筑另用 ringBuild.demolishCostPct） */
  upgradeDemolishCostPct: 0.2,
  // 舰队维护费阶梯（按总船数升序查档：船越多维护费越高 → H3/秒 从地球储备持续扣除）
  fleetMaint: [
    { ships: 3, costPerS: 0 },
    { ships: 5, costPerS: 1 },
    { ships: 8, costPerS: 2 },
    { ships: 12, costPerS: 3.5 },
    { ships: 99, costPerS: 5 },
  ] as FleetMaintTier[],
  // 飞船数量上限（按聚能环等级查 ship_cap 表 l1..l25；只挡主动造船，卡片/GM 加船可越限）。
  // 曲线 2+⌈0.4×等级⌉：Lv1=3（开局满编，升环解锁造船）→ Lv25=12（与 fleetMaint 顶档对齐）
  shipCap: [3, 3, 4, 4, 4, 5, 5, 6, 6, 6, 7, 7, 8, 8, 8, 9, 9, 10, 10, 10, 11, 11, 12, 12, 12],
  // 三幕门槛（环段口径：原 4/12、8/12 交点等比映射 → 8/25、16/25）
  act2Slots: 8,
  act3Slots: 16,
  act3SurviveSeconds: 240,
  moduleLegSeconds: 36,
  moduleLoadSeconds: 3,
  moduleUnloadSeconds: 3,
  // 资源星
  stars: {
    moon: { id: 'moon', name: '月球', load: 200, dist: 1.0, unlockAct: 1 },
    europa: { id: 'europa', name: '木卫二', load: 600, dist: 3.0, unlockAct: 2 },
    mars: { id: 'mars', name: '火星', load: 1500, dist: 6.0, unlockAct: 3 },
  } as Record<StarId, StarBalance>,
  // 等级焚烧表（下标 = 聚能环等级 − 1）：等级提升 → H3 消耗每一级翻倍
  // 指数曲线 burn(l) = 2^l：Lv1(开局1交点)=2 → Lv25(满级12交点全球组网)=2^25，每一级都是上一级的翻倍（×2）
  // 与 asset/config/level_burn.table.json 双写同步（tests/warm_level_burn.test.ts 锁定）
  levelBurn: Array.from({ length: 25 }, (_, i) => 2 ** (i + 1)),
  // 事件
  gravity: { period: 90, warn: 10, active: 20, speedMult: 2.0, fuelMult: 0.5 },
  flare: { minInterval: 100, maxInterval: 150, duration: 20, warnLead: 10, firstDelay: 60 },
  // 地图建筑（building.table.json 覆盖；行键 = SimBuilding.type，建造面板行序 = 键序。
  // upgrades = 强化分支表（一槽二选一；玩家设计权扩展：装一拆一，拆除费不返还）
  buildings: {
    relay: {
      name: '中转站', desc: '被航线链接 · 缓存物资', cost: 150, radius: 0, bufferCap: 800, shipCap: 0, resumeDelay: 0, refundPct: 0.5, linkable: true,
      upgrades: {
        cold_store: { name: '冷库扩容', desc: '缓存上限 ×2（800→1600）', cost: 120, mods: { bufferCapMult: 2 } },
        heavy_hook: { name: '重载吊臂', desc: '反向补给线单船建材 ×1.5', cost: 120, mods: { hookMult: 1.5 } },
      },
    },
    shield: {
      name: '磁场护盾发生器', desc: '耀斑护盾 · 半径内保全飞船', cost: 220, radius: 220, bufferCap: 0, shipCap: 2, resumeDelay: 3, refundPct: 0.5, linkable: false,
      upgrades: {
        cap_plate: { name: '名额扩容', desc: '保全名额 +2（2→4）', cost: 160, mods: { shipCapAdd: 2 } },
        range_coil: { name: '扩域线圈', desc: '罩半径 ×1.6（22→35）', cost: 160, mods: { radiusMult: 1.6 } },
      },
    },
  } as Record<string, BuildingDef>,
  // 环上建筑（ring_building.table.json 覆盖；行键 = ringBuildings[] 元素，全局经济修正、
  // 线性加算堆叠无上限、乘区防爆地板封底；环构筑 = 玩家亲手搭出的经济引擎）
  ringBuildings: {
    regulator: { name: '稳压环段', desc: '全局焚烧 −4%', cost: 200, mods: { burnMult: 0.96 } },
    conduit: { name: '超导馈线', desc: '全船满载 +3%', cost: 260, mods: { loadMult: 1.03 } },
    berth: { name: '扩容泊位', desc: '船队上限 +1', cost: 400, mods: { shipCapAdd: 1 } },
    constr: { name: '施工分段', desc: '建设灌入速率 +5%', cost: 300, mods: { buildPumpMult: 1.05 } },
    feeder: { name: '研究馈能', desc: '全线研究速率 +4%', cost: 240, mods: { researchMult: 1.04 } },
    heatwell: { name: '蓄热井', desc: '断环降温时长 +12% · 回温提速 −8%', cost: 220, mods: { coolTimeMult: 1.12, warmTimeMult: 0.92 } },
  } as Record<string, RingBuildingDef>,
  // 船型（ship_hull.table.json 覆盖；行键 = SimShip.hull，造船时定型不可改装）
  shipHulls: {
    standard: { name: '标准型', desc: '均衡船体 · 可装全部模块', cost: 180, loadMult: 1.0, speedMult: 1.0, innate: [], allowed: ['*'] },
    hauler: { name: '重载型', desc: '满载 ×1.4 · 航速 ×0.85 · 限装货舱/货泵', cost: 260, loadMult: 1.4, speedMult: 0.85, innate: [], allowed: ['cargo_pod', 'pump'] },
    courier: { name: '快速型', desc: '满载 ×0.7 · 航速 ×1.35 · 限装引擎/油箱', cost: 240, loadMult: 0.7, speedMult: 1.35, innate: [], allowed: ['ion_engine', 'aux_tank'] },
    guardian: { name: '防务型', desc: '内置防冻（冻毁免疫）· 满载 ×0.8 · 限装货舱/油箱', cost: 320, loadMult: 0.8, speedMult: 1.0, innate: ['anti_freeze'], allowed: ['cargo_pod', 'aux_tank'] },
  } as Record<string, ShipHullDef>,
  // 船用模块（ship_module.table.json 覆盖；行键 = SimShip.modules 元素，仅本船生效）
  shipModules: {
    cargo_pod: { name: '货舱扩容', desc: '本船满载 ×1.3', cost: 180, mods: { loadMult: 1.3 } },
    aux_tank: { name: '副油箱', desc: '本船油耗 ×0.8', cost: 160, mods: { fuelMult: 0.8 } },
    ion_engine: { name: '离子引擎', desc: '本船航速 ×1.2', cost: 200, mods: { speedMult: 1.2 } },
    pump: { name: '快速货泵', desc: '装卸时间 ×0.6', cost: 140, mods: { workMult: 0.6 } },
    heater: { name: '防冻加热器', desc: '耀斑冻毁免疫（罩外也存活）', cost: 320, mods: { antiFreeze: true } },
  } as Record<string, ShipModuleDef>,
  // 近地轨道建筑（orbit_build.table.json 覆盖；行键 = OrbitBuilding.type，轨道建设面板行序 = 键序）
  orbitBuildings: {
    dock: { name: '船坞', desc: '轨道造船 · 造价 −25% / 提速 30%', cost: 260, buildTime: 60, shipBuildCostMult: 0.75, shipBuildSpeedMult: 1.3 },
  } as Record<string, OrbitBuildingDef>,
  // 矿种（mineral_type.table.json 覆盖；行键 = 矿点 type，全息标记/面板色点用 color）
  mineralTypes: {
    he3: { name: '氦-3 矿脉', desc: '聚变原料 · 直采即燃料', color: '#4fd8ff' },
    metal: { name: '金属矿脉', desc: '精炼出售 · 折算燃料', color: '#ffb03d' },
    ice: { name: '水冰矿脉', desc: '电解获氘 · 折算燃料', color: '#dff3ff' },
  } as Record<string, MineralTypeDef>,
  // 矿点（mineral_deposit.table.json 覆盖；行键 = SimMine.depositId，一矿点至多一座矿建）
  mineralDeposits: {
    e1: { planet: 'earth', type: 'metal', lat: 22, lon: 130, reserve: 500 },
    m1: { planet: 'moon', type: 'he3', lat: 18, lon: 40, reserve: 900 },
    m2: { planet: 'moon', type: 'he3', lat: -30, lon: 210, reserve: 1400 },
    mc1: { planet: 'mercury', type: 'metal', lat: 12, lon: 100, reserve: 1600 },
    mc2: { planet: 'mercury', type: 'metal', lat: -42, lon: 280, reserve: 2200 },
    ma1: { planet: 'mars', type: 'metal', lat: 26, lon: 70, reserve: 1200 },
    ma2: { planet: 'mars', type: 'he3', lat: -18, lon: 240, reserve: 800 },
    eu1: { planet: 'europa', type: 'ice', lat: 30, lon: 160, reserve: 1500 },
    eu2: { planet: 'europa', type: 'ice', lat: -24, lon: 330, reserve: 1000 },
  } as Record<string, MineralDepositDef>,
  // 矿建（mine_building.table.json 覆盖；行键 = SimMine.type，全息面板建造区行序 = 键序）
  mineBuildings: {
    extractor: { name: '采矿机', desc: '低成本持续开采', cost: 150, buildTime: 12, yieldPerS: 0.5, minTypes: '' },
    processor: { name: '冶炼厂', desc: '高投入高产出的精炼线', cost: 360, buildTime: 24, yieldPerS: 1.4, minTypes: '' },
  } as Record<string, MineBuildingDef>,
  // 全息勘探表现参数（代码常量：纯渲染值，不入表）
  holo: {
    /** 全息球半径 = 行星显示半径 × 此倍率 */
    radiusMult: 1.55,
    /** 自转速率（rad/s，表现值） */
    spin: 0.12,
    /** 矿点屏幕拾取半径（px） */
    pickRadius: 26,
  },
  // 近地轨道建设参数（orbit_build.config.json 覆盖）
  orbitBuild: {
    /** 轨道环半径（画布 px，距锚行星中心；建筑绕环均布） */
    ringRadius: 96,
    /** 环上角速度（rad/s，与地图建筑入轨同口径 ω = orbitSpeed / ringRadius） */
    orbitSpeed: 0.5,
    /** 同型建筑上限 */
    maxPerType: 3,
    /** 建筑 UI 标签悬浮高度（世界单位 = 设计 px；building_label 世界空间 UI 逐帧贴此高度） */
    labelHeight: 64,
    /** 建筑 UI 标签显示距离（世界单位；相机距标签超过此值隐藏，近了恢复） */
    labelLodDist: 420,
  },
  // 建筑放置（建造模式）
  build: {
    /** 网格间距（地图 px；放置吸附 + 网格线） */
    grid: 40,
    /** 建筑间最小间距（地图 px） */
    minSpacing: 44,
    /** 距太阳最小净空（太阳半径 + 该值内不可放） */
    sunClearance: 24,
    /** 建筑入轨：本征轨道切向公转速度（px/s；角速度 = orbitSpeed / orbitR，离行星越近转越快） */
    orbitSpeed: 1.5,
    /** 建筑入轨吸附半径（放置点距行星中心 ≤ 此值自动入轨绕其公转，否则静态放置） */
    orbitAttach: 400,
    /** 轨道半径抬底（入轨半径下限 = 行星显示半径 + 此值，避免轨道穿进行星本体） */
    orbitMinPad: 30,
  },
  // 星图布局（权威 = systems，每行星系一张子表，结构见 MapSystemCfg / star_map.config.json；
  // nodes/moons 为子表展开的扁平缓存：行星轨道圈/卫星环/系视角成员等消费接口不变）
  map: {
    hitTolerance: 28,
    routeHitDistance: 14,
    systems: DEFAULT_MAP_SYSTEMS,
    nodes: DEFAULT_MAP_FLAT.nodes as Record<'sun' | PlanetId | 'moon' | 'europa', MapNodeCfg>,
    moons: DEFAULT_MAP_FLAT.moons as Record<'moon' | 'europa', { parent: PlanetId; radius: number }>,
  },
  // 卡库（refreshBalanceFromConfigs 时由 warm-current.cards 表覆盖；空表回退 DEFAULT_CARDS）
  cards: [] as CardDef[],
}

// ─── 环建筑 / 船型模块 / 建筑强化（查表入口 + 乘区聚合，纯函数） ───

/** 环上建筑定义查询（未知类型 null） */
export function ringBuildingDefOf(id: string): RingBuildingDef | null {
  return (B.ringBuildings as Record<string, RingBuildingDef | undefined>)[id] ?? null
}

/** 船型定义查询（未知船型 null） */
export function shipHullDefOf(id: string): ShipHullDef | null {
  return (B.shipHulls as Record<string, ShipHullDef | undefined>)[id] ?? null
}

/** 船用模块定义查询（未知模块 null） */
export function shipModuleDefOf(id: string): ShipModuleDef | null {
  return (B.shipModules as Record<string, ShipModuleDef | undefined>)[id] ?? null
}

/** 全零环乘区（无环建筑 / 兜底） */
export function freshRingMods(): RingModSet {
  return { burnMult: 1, loadMult: 1, shipCapAdd: 0, buildPumpMult: 1, researchMult: 1, coolTimeMult: 1, warmTimeMult: 1 }
}

/**
 * 环建筑全局乘区聚合（方案口径：**线性加算堆叠**——每座按 (值−1) 加算进乘区，
 * 25 格全稳压 = 1 − 25×4% → 封底 0.2；纯函数，读态即得）。
 * 拆除中的目标槽建筑效果立即停摆（跳过统计，六型效果全为增益，停摆只亏不赚无拆机套利）。
 * 防爆地板：焚烧乘区封底 floorBurnMult（阻止 25 格全稳压 → 焚烧归零的死平解），
 * 其余乘算键封底 floorMult；加算与上限不封（极端构筑爽感保留）。
 */
export function ringModsOf(state: Pick<SimState, 'ringBuildings' | 'ringDemolish'>): RingModSet {
  const m = freshRingMods()
  const arr = state.ringBuildings ?? []
  for (let i = 0; i < arr.length; i++) {
    const id = arr[i]
    if (!id) continue
    if (state.ringDemolish && state.ringDemolish.active && i === state.ringDemolish.slot) continue
    const def = ringBuildingDefOf(id)
    if (!def) continue
    const e = def.mods
    // 线性加算：每座贡献 (值 − 1)（乘区键）或原值（加算键 shipCapAdd）
    if (e.burnMult !== undefined) m.burnMult += e.burnMult - 1
    if (e.loadMult !== undefined) m.loadMult += e.loadMult - 1
    if (e.buildPumpMult !== undefined) m.buildPumpMult += e.buildPumpMult - 1
    if (e.researchMult !== undefined) m.researchMult += e.researchMult - 1
    if (e.coolTimeMult !== undefined) m.coolTimeMult += e.coolTimeMult - 1
    if (e.warmTimeMult !== undefined) m.warmTimeMult += e.warmTimeMult - 1
    if (e.shipCapAdd !== undefined) m.shipCapAdd += e.shipCapAdd
  }
  m.burnMult = Math.max(B.ringBuild.floorBurnMult, m.burnMult)
  for (const k of ['loadMult', 'buildPumpMult', 'researchMult', 'coolTimeMult', 'warmTimeMult'] as const) {
    m[k] = Math.max(B.ringBuild.floorMult, m[k])
  }
  return m
}

/**
 * 建筑有效定义 = 表基值 + 已装强化修正合成（强化数值消费唯一出口：
 * 护盾半径/名额、缓存上限等消费方一律走这里，改表/换分支即生效）。
 * 返回新对象（不改 B 表值）；未知建筑类型返回 null。
 */
export function buildingEffectiveDef(b: Pick<SimBuilding, 'type' | 'upgrade'>): BuildingDef | null {
  const base = (B.buildings as Record<string, BuildingDef | undefined>)[b.type] ?? null
  if (!base) return null
  const def: BuildingDef = { ...base }
  const up = b.upgrade && base.upgrades ? base.upgrades[b.upgrade] : undefined
  if (!up) return def
  const e = up.mods
  if (e.bufferCapMult !== undefined) def.bufferCap = Math.round(def.bufferCap * e.bufferCapMult)
  if (e.radiusMult !== undefined) def.radius = def.radius * e.radiusMult
  if (e.shipCapAdd !== undefined) def.shipCap = def.shipCap + e.shipCapAdd
  return def
}

/** 建筑反向补给线建材乘区（重载吊臂 hookMult；无强化 = 1；buildingEffectiveDef 之外的独立修正键） */
export function buildingHookMult(b: Pick<SimBuilding, 'type' | 'upgrade'>): number {
  const base = (B.buildings as Record<string, BuildingDef | undefined>)[b.type]
  const up = b.upgrade && base?.upgrades ? base.upgrades[b.upgrade] : undefined
  return up?.mods.hookMult ?? 1
}

/** 代码内置默认卡库（cards.table.json 未加载时的兜底；与表内容保持同步） */
export const DEFAULT_CARDS: CardDef[] = [
  { id: 'event_warning', name: '事件预警', type: 'unlock', line: 'infra', gain: '极寒停航提前 10 秒预告', cost: '该线下次生长 −10%', effects: { flareWarning: true, nextGrowth: { line: 'self', mult: 0.9 } } },
  { id: 'engine_overdrive', name: '引擎超频', type: 'upgrade', line: 'engine', gain: '所有航线油耗 −15%', cost: '航速 −5%', effects: { fuelMult: 0.85, speedMult: 0.95 } },
  { id: 'speed_up', name: '航速提升', type: 'upgrade', line: 'engine', gain: '飞行速度 +20%', cost: '油耗 +8%', effects: { speedMult: 1.2, fuelMult: 1.08 } },
  { id: 'moon_enrich', name: '月球富集', type: 'upgrade', line: 'engine', gain: '月球单船满载 +50', cost: '其他星满载 −10', effects: { moonLoadAdd: 50, otherLoadAdd: -10 } },
  { id: 'cargo_expand', name: '扩容货舱', type: 'upgrade', line: 'cargo', gain: '单船货舱 +20%', cost: '单船油耗 +10%', effects: { cargoMult: 1.2, fuelMult: 1.1 } },
  { id: 'fleet_expand', name: '扩编船队', type: 'upgrade', line: 'cargo', gain: '飞船 +1（立即入列空闲池）', cost: '单节点消耗 +5%', effects: { fleetBonus: 1, burnMult: 1.05 } },
  // 2026-09-08 环线移除：环线卡（ring_saving/reserve_expand/thermal_redundancy）下线
  { id: 'gravity_extend', name: '引力延长', type: 'upgrade', line: 'infra', gain: '引力窗口 +5 秒', cost: '单节点消耗 +2%', effects: { gravityAdd: 5, burnMult: 1.02 } },
  { id: 'growth_accel', name: '生长加速', type: 'upgrade', line: 'expand', gain: '本线下一个节点进度条提速 +50%', cost: '单节点消耗 +6%', effects: { nextGrowth: { line: 'self', mult: 1.5 }, burnMult: 1.06 } },
  { id: 'twin_node', name: '环网扩容', type: 'upgrade', line: 'expand', gain: '聚能环建设计费 −25%（施工更省 H3）', cost: '本线下次生长 −20%', effects: { ringBuildCostMult: 0.75, nextGrowth: { line: 'self', mult: 0.8 } } },
]

// ─── 配置覆盖 ───

function assignNumeric(target: Record<string, unknown>, src: Record<string, unknown> | undefined, keys: string[]): void {
  if (!src) return
  for (const k of keys) {
    if (src[k] !== undefined) target[k] = src[k]
  }
}

/**
 * 从 ConfigRegistry 读取 warm-current.* 配置覆盖默认值。
 * GameMode.InitGame / sim.restart 时调用（改表后重开一局即生效）。
 * 配置未注册（单测/独立预览）时静默保留代码默认值。
 */
export function refreshBalanceFromConfigs(): void {
  try {
    const g = ConfigRegistry.getConfig<Record<string, unknown>>('warm-current.global')
    assignNumeric(B as unknown as Record<string, unknown>, g, [
      'earthH3Start', 'baseBurnPerLeg', 'baseLegSeconds', 'loadSeconds', 'unloadSeconds',
      'dangerReserveSeconds', 'startSlots', 'ringSlots', 'researchSlotCap', 'ringLevels', 'nodeInterval',
      'runningRateBonus', 'researchPointRateAdd', 'researchPointCostPerS', 'coreCoolSeconds', 'coreWarmSeconds', 'initialShips', 'shipBuildCost', 'shipBuildTime', 'cargoBase',
      'shipRebuildCost', 'materialH3PerUnit', 'upgradeDemolishCostPct', 'act2Slots', 'act3Slots', 'act3SurviveSeconds',
      'moduleLegSeconds', 'moduleLoadSeconds', 'moduleUnloadSeconds',
    ])
  // 聚能环建设参数（独立配置 warm-current.ring_build；字段级覆盖，未配置字段保留 B 兜底。
  // 注：文件内容包在 "ringBuild" 键下，getConfig 返回顶层 → 取 rbCfg.ringBuild 解包）
  try {
    const rbRaw = ConfigRegistry.getConfig<Record<string, unknown>>('warm-current.ring_build')
    const rbCfg = (rbRaw?.ringBuild ?? rbRaw) as Record<string, number>
    if (rbCfg) {
      for (const k of ['defaultPoints', 'minPoints', 'costPerS', 'demolishCostPct', 'floorBurnMult', 'floorMult'] as const) {
        if (typeof rbCfg[k] === 'number') (B.ringBuild as unknown as Record<string, number>)[k] = rbCfg[k]
      }
    }
  } catch { /* 未注册 → 默认值 */ }

  // 聚能环交点造价表（level_cost.table.json：n1..n12 行 → B.ringBuild.levelCost 按序覆盖）
  try {
    const costTable = ConfigRegistry.getTable<{ cost: number }>('warm-current.level_cost')
    if (costTable) {
      const costs: number[] = []
      const keys = costTable.getRowNames().sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
      for (const k of keys) costs.push(costTable.getRow(k)!.cost)
      if (costs.length > 0) B.ringBuild.levelCost = costs
    }
  } catch { /* 未注册 → 默认值 */ }

  // 飞船数量上限表（ship_cap.table.json：l1..l25 行 → B.shipCap 按序覆盖）
  try {
    const capTable = ConfigRegistry.getTable<{ cap: number }>('warm-current.ship_cap')
    if (capTable) {
      const caps: number[] = []
      const keys = capTable.getRowNames().sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
      for (const k of keys) caps.push(capTable.getRow(k)!.cap)
      if (caps.length > 0) B.shipCap = caps
    }
  } catch { /* 未注册 → 默认值 */ }
  } catch { /* 未注册 → 默认值 */ }

  try {
    const table = ConfigRegistry.getTable<{ name: string; load: number; dist: number; unlockAct: number }>('warm-current.stars')
    if (table) {
      for (const key of table.getRowNames()) {
        const star = B.stars[key as StarId]
        const row = table.getRow(key)
        if (star && row) Object.assign(star, row, { id: key })
      }
    }
  } catch { /* 未注册 → 默认值 */ }

  try {
    const table = ConfigRegistry.getTable<{ burn: number }>('warm-current.level_burn')
    if (table) {
      const burns: number[] = []
      const keys = table.getRowNames().sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
      for (const k of keys) burns.push(table.getRow(k)!.burn)
      if (burns.length > 0) B.levelBurn = burns
    }
  } catch { /* 未注册 → 默认值 */ }

  try {
    const table = ConfigRegistry.getTable<FleetMaintTier>('warm-current.fleet_maint')
    if (table) {
      const tiers = table.getRowNames()
        .map((k) => table.getRow(k))
        .filter((r): r is FleetMaintTier => !!r && typeof r.ships === 'number' && typeof r.costPerS === 'number')
        .sort((a, b) => a.ships - b.ships)
      if (tiers.length > 0) B.fleetMaint = tiers
    }
  } catch { /* 未注册 → 默认值 */ }

  try {
    const table = ConfigRegistry.getTable<Partial<BuildingDef>>('warm-current.building')
    if (table) {
      for (const key of table.getRowNames()) {
        const row = table.getRow(key)
        const def = (B.buildings as Record<string, BuildingDef | undefined>)[key]
        if (def && row) Object.assign(def, row)
      }
    }
  } catch { /* 未注册 → 默认值 */ }

  // 环上建筑表（ring_building.table.json：行键 = 环建筑 id，整行覆盖默认值；
  // 表新增行而代码无默认值时按兜底行插入，纯表驱动加环建筑）
  try {
    const table = ConfigRegistry.getTable<Partial<RingBuildingDef>>('warm-current.ring_building')
    if (table) {
      for (const key of table.getRowNames()) {
        const row = table.getRow(key)
        const def = (B.ringBuildings as Record<string, RingBuildingDef | undefined>)[key]
        if (def && row) Object.assign(def, row)
        else if (row) (B.ringBuildings as Record<string, RingBuildingDef>)[key] = {
          name: key, desc: '', cost: 0, mods: {}, ...row,
        }
      }
    }
  } catch { /* 未注册 → 默认值 */ }

  // 船型表（ship_hull.table.json：行键 = SimShip.hull，整行覆盖；表加行即加船型）
  try {
    const table = ConfigRegistry.getTable<Partial<ShipHullDef>>('warm-current.ship_hull')
    if (table) {
      for (const key of table.getRowNames()) {
        const row = table.getRow(key)
        const def = (B.shipHulls as Record<string, ShipHullDef | undefined>)[key]
        if (def && row) Object.assign(def, row)
        else if (row) (B.shipHulls as Record<string, ShipHullDef>)[key] = {
          name: key, desc: '', cost: 0, loadMult: 1, speedMult: 1, innate: [], allowed: ['*'], ...row,
        }
      }
    }
  } catch { /* 未注册 → 默认值 */ }

  // 船用模块表（ship_module.table.json：行键 = 模块 id，整行覆盖；表加行即加模块）
  try {
    const table = ConfigRegistry.getTable<Partial<ShipModuleDef>>('warm-current.ship_module')
    if (table) {
      for (const key of table.getRowNames()) {
        const row = table.getRow(key)
        const def = (B.shipModules as Record<string, ShipModuleDef | undefined>)[key]
        if (def && row) Object.assign(def, row)
        else if (row) (B.shipModules as Record<string, ShipModuleDef>)[key] = {
          name: key, desc: '', cost: 0, mods: {}, ...row,
        }
      }
    }
  } catch { /* 未注册 → 默认值 */ }

  // 近地轨道建设参数（orbit_build.config.json：单例 config；字段级覆盖，未配置字段保留 B 兜底。
  // 注：文件内容包在 "orbitBuild" 键下，getConfig 返回顶层 → 取 obCfg.orbitBuild 解包）
  try {
    const obRaw = ConfigRegistry.getConfig<Record<string, unknown>>('warm-current.orbit_build')
    const obCfg = ((obRaw as { orbitBuild?: Record<string, number> } | undefined)?.orbitBuild ?? obRaw) as Record<string, number> | undefined
    if (obCfg) {
for (const k of ['ringRadius', 'orbitSpeed', 'maxPerType', 'labelHeight', 'labelLodDist'] as const) {
        if (typeof obCfg[k] === 'number') (B.orbitBuild as unknown as Record<string, number>)[k] = obCfg[k]
      }
    }
  } catch { /* 未注册 → 默认值 */ }

  // 近地轨道建筑表（orbit_build.table.json：行键 = OrbitBuilding.type，整行覆盖默认值；
  // 表新增行而代码无默认值时按兜底行插入，保证纯表驱动加建筑可行）
  try {
    const table = ConfigRegistry.getTable<Partial<OrbitBuildingDef>>('warm-current.orbit_buildings')
    if (table) {
      for (const key of table.getRowNames()) {
        const row = table.getRow(key)
        const def = (B.orbitBuildings as Record<string, OrbitBuildingDef | undefined>)[key]
        if (def && row) Object.assign(def, row)
        else if (row) (B.orbitBuildings as Record<string, OrbitBuildingDef>)[key] = {
          name: key, desc: '', cost: 0, buildTime: 0, shipBuildCostMult: 1, shipBuildSpeedMult: 1, ...row,
        }
      }
    }
  } catch { /* 未注册 → 默认值 */ }

  // 矿种/矿点/矿建三表（mineral_type / mineral_deposit / mine_building：整行覆盖 + 兜底行插入，纯表驱动）
  try {
    const table = ConfigRegistry.getTable<Partial<MineralTypeDef>>('warm-current.mineral_type')
    if (table) {
      for (const key of table.getRowNames()) {
        const row = table.getRow(key)
        const def = (B.mineralTypes as Record<string, MineralTypeDef | undefined>)[key]
        if (def && row) Object.assign(def, row)
        else if (row) (B.mineralTypes as Record<string, MineralTypeDef>)[key] = { name: key, desc: '', color: '#4fd8ff', ...row }
      }
    }
  } catch { /* 未注册 → 默认值 */ }
  try {
    const table = ConfigRegistry.getTable<Partial<MineralDepositDef>>('warm-current.mineral_deposit')
    if (table) {
      for (const key of table.getRowNames()) {
        const row = table.getRow(key)
        const def = (B.mineralDeposits as Record<string, MineralDepositDef | undefined>)[key]
        if (def && row) Object.assign(def, row)
        else if (row) (B.mineralDeposits as Record<string, MineralDepositDef>)[key] = { planet: 'earth', type: 'metal', lat: 0, lon: 0, reserve: 0, ...row }
      }
    }
  } catch { /* 未注册 → 默认值 */ }
  try {
    const table = ConfigRegistry.getTable<Partial<MineBuildingDef>>('warm-current.mine_building')
    if (table) {
      for (const key of table.getRowNames()) {
        const row = table.getRow(key)
        const def = (B.mineBuildings as Record<string, MineBuildingDef | undefined>)[key]
        if (def && row) Object.assign(def, row)
        else if (row) (B.mineBuildings as Record<string, MineBuildingDef>)[key] = { name: key, desc: '', cost: 0, buildTime: 0, yieldPerS: 0, minTypes: '', ...row }
      }
    }
  } catch { /* 未注册 → 默认值 */ }

  try {
    const ev = ConfigRegistry.getConfig<{ gravity?: Record<string, number>; flare?: Record<string, number> }>('warm-current.events')
    if (ev?.gravity) Object.assign(B.gravity, ev.gravity)
    if (ev?.flare) Object.assign(B.flare, ev.flare)
  } catch { /* 未注册 → 默认值 */ }

  // 星图布局：systems 子表逐系逐节点合并（默认值兜底；config 新子表可直接追加），合并后重展开扁平 nodes/moons
  try {
    const mp = ConfigRegistry.getConfig<{ hitTolerance?: number; routeHitDistance?: number; systems?: Record<string, Partial<MapSystemCfg>> }>('warm-current.star_map')
    if (mp) {
      if (mp.hitTolerance !== undefined) B.map.hitTolerance = mp.hitTolerance
      if (mp.routeHitDistance !== undefined) B.map.routeHitDistance = mp.routeHitDistance
      if (mp.systems) {
        for (const [sid, sys] of Object.entries(mp.systems)) {
          if (!sys) continue
          let cur = B.map.systems[sid]
          if (!cur) { cur = { center: '', nodes: {} }; B.map.systems[sid] = cur }
          if (sys.center !== undefined) cur.center = sys.center
          for (const [k, node] of Object.entries(sys.nodes ?? {})) {
            const cn = cur.nodes[k]
            if (cn && node) Object.assign(cn, node)
            else if (node) cur.nodes[k] = { ...node }
          }
        }
        applyMapSystems()
      }
    }
  } catch { /* 未注册 → 默认值 */ }

  // 卡库：表优先，空/未注册回退内置默认
  B.cards = DEFAULT_CARDS
  try {
    const table = ConfigRegistry.getTable<{ name: string; type: string; line: ResearchLineId; gain: string; cost: string; effects?: CardEffects }>('warm-current.cards')
    if (table && table.getRowNames().length > 0) {
      B.cards = table.getRowNames().map((id) => {
        const row = table.getRow(id)!
        return {
          id, name: row.name, type: row.type as CardDef['type'], line: row.line,
          gain: row.gain, cost: row.cost, effects: row.effects ?? {},
        }
      })
    }
  } catch { /* 未注册 → 默认值 */ }
}
