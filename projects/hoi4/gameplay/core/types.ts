/**
 * hoi4 core 类型定义 — 整局状态 + 配置表行类型
 *
 * 铁律（doc-dev/hoi4-like-grand-strategy plan.md §D1）：
 *  - 本目录（gameplay/core/）纯 TS、确定性、零渲染依赖（不 import THREE / @/engine）；
 *  - 状态全部 JSON-safe（无 Map/Set/class 实例字段），serialize/deserialize 往返无损；
 *  - 所有调参数值来自 Hoi4Tables（配置表），core 内不写死魔法数。
 */

// ═══════════════ 配置表行 ═══════════════

export type Ideology = 'democratic' | 'communist' | 'fascist' | 'neutral'

export interface CountryDef {
  name: string
  color: string
  ideology: Ideology
  pp: number
  stability: number
  warSupport: number
  manpower: number
  ai?: { aggressive?: number; industrial?: number }
}

export interface TerrainDef {
  name: string
  /** 守方防御乘数（战斗） */
  defMod: number
  /** 行军时间乘数 */
  moveMult: number
}

export interface BuildingDef {
  name: string
  /** 建造点数（民用工厂·日） */
  cost: number
}

export interface LawDef {
  id: string
  name: string
  ppCost: number
  /** 消费品占比（0-1，economy 法） */
  cg?: number
  factoryOutputMod?: number
  constrMod?: number
  researchMod?: number
  /** 人力获取乘数（征兵法） */
  manpowerMod?: number
  reqWarSupport?: number
}

export interface EquipmentDef {
  name: string
  /** 单件钢材消耗/日产出件 */
  steelPerUnit: number
  oilPerUnit?: number
}

export interface BattalionDef {
  name: string
  /** 科技加成分类（infantry/artillery/armor） */
  category: string
  /** 战斗宽度 */
  width: number
  manpower: number
  org: number
  hp: number
  softAttack: number
  hardAttack: number
  defense: number
  breakthrough: number
  armor: number
  /** 硬度 0-1 */
  hardness: number
  /** 营装备需求（编成一个营扣的库存） */
  equipment: Record<string, number>
}

export interface SupportDef {
  name: string
  manpower: number
  org: number
  softAttack: number
  hardAttack: number
  defense: number
  breakthrough: number
  /** 连装备需求 */
  equipment: Record<string, number>
}

export interface TemplateDef {
  name: string
  battalions: Record<string, number>
  supports: string[]
}

export interface TechEffect {
  type: 'stat_bonus' | 'unlock_equipment' | 'unlock_battalion' | 'unlock_template' | 'factory_output' | 'construction_speed'
  id?: string
  /** stat_bonus 的营分类（缺省 = 全营） */
  category?: string
  /** 数值：stat_bonus 的比率加成 / factory_output、construction_speed 的修正增量 */
  bonus?: number
  softAttack?: number
  hardAttack?: number
  defense?: number
  breakthrough?: number
  org?: number
}

export interface TechDef {
  name: string
  desc: string
  category: 'infantry' | 'artillery' | 'armor' | 'industry' | 'doctrine'
  days: number
  prereq: string[]
  mutuallyExclusive?: string[]
  effect: TechEffect
  aiWillDo: number
}

export type FocusEffect =
  | { type: 'pp'; amount: number }
  | { type: 'stability'; amount: number }
  | { type: 'war_support'; amount: number }
  | { type: 'factory'; civ?: number; mil?: number }
  | { type: 'research_bonus'; category: string; amount: number }
  | { type: 'equipment'; id: string; amount: number }
  | { type: 'manpower'; amount: number }
  | { type: 'justification_speed'; mod: number }
  | { type: 'war_goal'; tag: string }

export interface FocusDef {
  name: string
  desc: string
  /** 完成天数（基准 70） */
  days: number
  /** 树布局坐标（面板像素） */
  x: number
  y: number
  prereq: string[]
  mutuallyExclusive: string[]
  effects: FocusEffect[]
  aiWillDo: number
  /** 限定国家（空 = 通用） */
  tags?: string[]
}

export type EventTrigger = {
  /** 最早触发时刻（游戏小时，自 1936-1-1 起） */
  minHour?: number
  tags?: string[]
  atWar?: boolean
  /** 每日判定触发概率 0-1 */
  chance?: number
}

export type EventEffect =
  | FocusEffect
  | { type: 'declare_war'; target: string }
  | { type: 'to_option_country' } // 占位：效果落在触发国（未来扩展用）

export interface EventDef {
  name: string
  desc: string
  trigger: EventTrigger
  options: Array<{ name: string; effects: EventEffect[] }>
  /** 是否一次性（默认 true） */
  once?: boolean
}

export interface CombatParams {
  baseWidth: number
  widthPerExtraDirection: number
  divisionWidth: number
  orgDamageCoef: number
  strengthDamageCoef: number
  entrenchPerHour: number
  entrenchMax: number
  entrenchDefensePerPoint: number
  orgRegenPerHour: number
  orgRegenInBattlePerHour: number
  moveHoursBase: number
  trainingDays: number
  ppPerDay: number
  civFactoryOutput: number
  milFactoryOutput: number
  constrMaxFactories: number
  efficiencyStart: number
  efficiencyGainPerDay: number
  efficiencyMax: number
  manpowerPerDayPerState: number
}

export interface AiWeights {
  /** 建造：民厂相对军厂的目标比（民/军 ≥ 该值才建军厂） */
  civMilRatio: number
  /** 训练：库存装备 ≥ 模板需求 × 该值才补队列 */
  trainEquipmentBuffer: number
  /** 进攻：本地攻击优势阈值（攻方战力/守方战力） */
  attackAdvantage: number
  /** 边境防守师比例 */
  defendRatio: number
}

// ═══════════════ 地图数据（map.json 形态） ═══════════════

export interface ProvinceDef {
  x: number
  y: number
  terrain: string
  sea: boolean
  coastal: boolean
  neighbors: number[]
  state: number
}

export interface StateDef {
  id: number
  name: string
  provinces: number[]
  owner: string
  capital: number
  vp: number
  pop: number
  slots: number
  steel: number
  oil: number
}

export interface MapDef {
  width: number
  height: number
  pxPerUnit: number
  worldWidth: number
  worldHeight: number
  capitals: Record<string, number>
  provinces: Record<string, ProvinceDef>
  states: StateDef[]
}

// ═══════════════ 运行时整局状态 ═══════════════

export interface ConstructionItem {
  id: number
  building: string
  /** 落位州（-1 = AI 自动选） */
  stateId: number
  progress: number
  cost: number
}

export interface ProductionLine {
  id: number
  equipment: string
  factories: number
  efficiency: number
}

export interface TrainingItem {
  id: number
  template: string
  daysLeft: number
}

export interface CountryModifiers {
  factoryOutput: number
  constructionSpeed: number
  researchSpeed: number
  justificationSpeed: number
  /** 分类攻击/防御加成（科技 stat_bonus 累加，'' 键=全营全局加成） */
  catSoftAttack: Record<string, number>
  catHardAttack: Record<string, number>
  catDefense: Record<string, number>
  catBreakthrough: Record<string, number>
  /** 全师组织度加值（学说 org 效果累加） */
  orgFlat: number
}

export interface CountryState {
  tag: string
  pp: number
  manpower: number
  stability: number
  warSupport: number
  /** 民用/军用工厂（全国计数；位置在州） */
  civFactories: number
  milFactories: number
  laws: { economy: string; conscription: string; trade: string }
  constructionQueue: ConstructionItem[]
  productionLines: ProductionLine[]
  equipmentStock: Record<string, number>
  researchBonus: Record<string, number>
  techs: { researching: Array<{ id: string; daysLeft: number }>; completed: string[] }
  focus: { current: string | null; daysLeft: number; completed: string[] }
  trainingQueue: TrainingItem[]
  /** 训练完成待部署的师（存模板 id 列表） */
  deployPool: string[]
  /** 累计部署师数（师命名序号） */
  deployedCount: number
  /** 已解锁装备 id（科技 unlock_equipment 写入） */
  unlockedEquipments: string[]
  /** 已解锁营类型 id（科技 unlock_battalion 写入） */
  unlockedBattalions: string[]
  /** 编制设计器保存的自定义模板（id = 'custom_<n>'） */
  customTemplates: Record<string, TemplateDef>
  /** 自定义模板计数（命名用） */
  customTemplateCount: number
  /** 制造借口中：目标 tag → 剩余天数 */
  justifying: Record<string, number>
  /** 战争目标（已具备宣战资格的 tag） */
  warGoals: string[]
  /** 已宣战对象（双向冗余，保存恢复时合并） */
  wars: string[]
  /** 灯下黑标记：已投降（胜利方=conqueredBy） */
  capitulated: boolean
  conqueredBy: string | null
  modifiers: CountryModifiers
  isAI: boolean
}

export interface Division {
  id: number
  owner: string
  template: string
  name: string
  /** 当前所在省 */
  province: number
  org: number
  /** 兵力 0-1（受战斗损耗） */
  strength: number
  /** 剩余路径（不含当前省） */
  path: number[]
  /** 当前段已行军小时 */
  moveProgress: number
  /** 停留小时累计（堑壕） */
  stationaryHours: number
  supplied: boolean
  /** 战斗 id（0 = 无） */
  battle: number
  /** 训练度（部署即 0.5，随时间到 1；影响战力） */
  training: number
}

export interface Battle {
  id: number
  province: number
  attacker: string
  defender: string
  attackers: number[]
  defenders: number[]
  hours: number
  /** 攻方进度 0-100（占省进度条显示用） */
  progress: number
}

export interface PendingEvent {
  /** 事件来源国（受效果国） */
  tag: string
  eventId: string
}

export interface Hoi4State {
  version: number
  /** 游戏小时（自 1936-1-1 00:00） */
  hour: number
  speed: number
  paused: boolean
  seed: number
  playerTag: string | null
  countries: Record<string, CountryState>
  /** 省控制权：pid → 控制 tag（owner=核心归属在 map.json states；开战后控制权才分离） */
  provinceControl: Record<number, string>
  divisions: Record<string, Division>
  battles: Record<string, Battle>
  /** 待玩家处理的事件队列（AI 国事件自动选第一项） */
  pendingEvents: PendingEvent[]
  /** 已触发过的事件（once 去重） */
  firedEvents: string[]
  /** 胜负：null=进行中 */
  result: 'victory' | 'defeat' | null
  nextId: number
}

// ═══════════════ 派生统计（计算值，不序列化） ═══════════════

export interface TemplateStats {
  width: number
  manpower: number
  org: number
  hp: number
  softAttack: number
  hardAttack: number
  defense: number
  breakthrough: number
  armor: number
  hardness: number
  equipment: Record<string, number>
  battalionCount: number
}
