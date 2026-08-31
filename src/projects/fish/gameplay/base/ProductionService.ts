/**
 * ProductionService — 生产/升级/研究/宝石统一服务（ClashMaster 经营闭环核心）
 *
 * 挂载到 FishGameInstance，与 ResourcesComponent / TrainingComponent 并列：
 *  - 金矿/水库资源产出与收集（基地阶段推进 tick）
 *  - 建筑等级 / 升级队列 / 研究队列（实验室）/ 障碍物清除队列（同一套 finishAt 模型）
 *  - 兵种研究等级查询（训练/战斗装配按等级取属性）
 *  - 宝石货币统一 API：spend / add / FastForward 加速折算（每分钟 1 宝石向上取整）
 *
 * 纪律：所有状态只写内存 KV（手动存档模型），schema 见 FishSaveAdapter。
 * 计时统一用 finishAt 时间戳（Date.now 毫秒）：基地阶段每帧补结算，天然支持离线。
 */
import { AObjectComponent, logger } from '@/engine'
import type { AObject } from '@/engine'
import type { SaveSlotComponent } from '@/engine'
import { troopLevel } from '../common/types'
import type { TroopLevelStats, TroopType } from '../common/types'

/** 升级/研究/清除队列条目（finishAt 时间戳模型，离线结算天然支持） */
export type ProductionTimer = {
  /** 目标 id：建筑 = buildingId，研究 = 兵种 id，清除 = 障碍物 id */
  targetId: string
  /** 完成时间戳（Date.now 毫秒） */
  finishAt: number
}

/** 建筑等级配置（buildingLevels.config.json；缺行回退 1 级单级模式） */
export interface BuildingLevelStats {
  /** 升到该级的费用 */
  upgradeCost: number
  /** 升到该级的耗时（秒） */
  upgradeTime: number
  /** 该级生命值 */
  hp: number
  /** 该级产出速率（每分钟，金矿/水库用） */
  produceRate: number
  /** 该级积压容量（金矿/水库用） */
  storage: number
  /** 该级仓库容量（仓库/大本营用） */
  storageCap: number
}

/** 建筑等级表（键 = 建筑类型 id，值 = 各等级属性数组，下标 0 = 1 级） */
export type BuildingLevelsConfig = Record<string, BuildingLevelStats[]>

/** 生产服务选项 */
export interface ProductionServiceOptions {
  /** KV 存档组件引用（生产/升级状态读写） */
  save: SaveSlotComponent
}

/** 宝石加速折算：每分钟 1 宝石，向上取整 */
export function fastForwardGemCost(remainingSec: number): number {
  return Math.max(1, Math.ceil(remainingSec / 60))
}

export class ProductionService extends AObjectComponent<AObject> {
  /** KV 存档组件（生产/升级状态读写） */
  private readonly save: SaveSlotComponent
  /** 建筑等级表（config 注入；未注入 = 全部单级，无升级） */
  buildingLevels: BuildingLevelsConfig = {}
  /** 兵种表引用（研究等级 clamp / 训练费用查询） */
  troopResolver: ((id: string) => TroopType | undefined) | null = null
  /** 上次产出结算时间戳（毫秒；每次结算后更新） */
  private lastProduceAt = 0
  /** 产出入账回调（收集动画/HUD 刷新用；参数 = 资源类型与数量） */
  onProduced: ((resource: 'coins' | 'elixir', amount: number) => void) | null = null

  constructor(owner: AObject, options: ProductionServiceOptions) {
    super(owner)
    this.name = 'ProductionService'
    this.save = options.save
    this.lastProduceAt = Date.now()
  }

  // ════════════════════════════════════════════
  //  资源钱包（宝石挂到外部 ResourcesComponent，此处只做统一入口）
  // ════════════════════════════════════════════

  /** 资源钱包引用（构造后由宿主注入：宝石 spend/add 走这里） */
  wallet: { get(r: string): number, spend(r: string, n: number): boolean, add(r: string, n: number): void } | null = null

  /** 宝石余额 */
  get gems(): number {
    return this.wallet?.get('gems') ?? 0
  }

  /**
   * 宝石扣减统一入口（加速/购买资源/GM 扣减全走这里，保证埋点对账）。
   * @returns 是否扣减成功（余额不足返回 false，不产生任何状态变化）
   */
  spendGems(reason: string, amount: number): boolean {
    if (amount <= 0) return true
    if (!this.wallet || !this.wallet.spend('gems', amount)) {
      logger.warn(`[Production] 宝石不足，扣减失败：${reason}（需 ${amount}，余 ${this.gems}）`)
      return false
    }
    logger.info(`[Production] 宝石消耗: ${reason} -${amount}（余 ${this.gems}）`)
    return true
  }

  /** 宝石入账统一入口（成就/三星首杀/障碍物掉落/GM 发放全走这里） */
  addGems(reason: string, amount: number): void {
    if (amount <= 0) return
    this.wallet?.add('gems', amount)
    logger.info(`[Production] 宝石入账: ${reason} +${amount}（余 ${this.gems}）`)
  }

  /**
   * 加速：按剩余秒数折算宝石（每分钟 1 颗向上取整）并立即完成。
   * @param timer 队列条目（targetId + finishAt）
   * @param kind 队列类型（日志用）
   * @param onFinish 折算成功后的完成回调（由调用方定义具体效果）
   * @returns 是否加速成功
   */
  fastForward(timer: ProductionTimer, kind: string, onFinish: (t: ProductionTimer) => void): boolean {
    const remaining = Math.max(0, Math.ceil((timer.finishAt - Date.now()) / 1000))
    if (remaining <= 0) {
      onFinish(timer)
      return true
    }
    if (!this.spendGems(`加速-${kind}-${timer.targetId}`, fastForwardGemCost(remaining))) return false
    logger.info(`[Production] 加速完成: ${kind} ${timer.targetId}（${remaining}s → 0，消耗 ${fastForwardGemCost(remaining)} 宝石）`)
    onFinish(timer)
    return true
  }

  // ════════════════════════════════════════════
  //  建筑等级
  // ════════════════════════════════════════════

  /** 某建筑当前等级（无记录 = 1 级） */
  getBuildingLevel(buildingId: string): number {
    const m = this.save.get<Record<string, number>>('buildingLevels') ?? {}
    const lv = m[buildingId]
    return typeof lv === 'number' && lv >= 1 ? Math.floor(lv) : 1
  }

  /** 建筑某级属性（未配表回退：1 级单级，升级不可用） */
  buildingStats(buildingId: string, level: number): BuildingLevelStats | null {
    const rows = this.buildingLevels[buildingId]
    if (!rows || rows.length === 0) return null
    return rows[Math.max(0, Math.min(level - 1, rows.length - 1))] ?? null
  }

  /** 建筑最大等级（未配表 = 1） */
  buildingMaxLevel(buildingId: string): number {
    return this.buildingLevels[buildingId]?.length ?? 1
  }

  /** 升级队列状态：buildingId → timer（0/1 项；Array.find 为 null 表示无升级中） */
  getUpgrading(): ProductionTimer | null {
    const list = this.save.get<ProductionTimer[]>('upgradeQueue') ?? []
    return list.length > 0 ? list[0] : null
  }

  /**
   * 开始升级建筑：校验（等级表存在 / 未达上限 / 无进行中升级 / 资源足够）→
   * 扣资源 → 写升级队列。
   * @param cost 扣费资源（默认金币；实验室等特殊建筑可指定药水）
   */
  startBuildingUpgrade(buildingId: string, resource: 'coins' | 'elixir' = 'coins'): boolean {
    const cur = this.getBuildingLevel(buildingId)
    const next = cur + 1
    const stats = this.buildingStats(buildingId, next)
    if (!stats) {
      logger.warn(`[Production] 升级失败: 建筑 "${buildingId}" 无 ${next} 级配置（已达上限或未配表）`)
      return false
    }
    if (this.getUpgrading()) {
      logger.warn(`[Production] 升级失败: 已有建筑升级中（${this.getUpgrading()?.targetId}）`)
      return false
    }
    if (!this.wallet || !this.wallet.spend(resource, stats.upgradeCost)) {
      logger.warn(`[Production] 升级失败: ${resource} 不足（需 ${stats.upgradeCost}）`)
      return false
    }
    const list = this.save.get<ProductionTimer[]>('upgradeQueue') ?? []
    list.push({ targetId: buildingId, finishAt: Date.now() + stats.upgradeTime * 1000 })
    this.save.set('upgradeQueue', list)
    logger.info(`[Production] 开始升级建筑: ${buildingId} ${cur}→${next}（-${stats.upgradeCost} ${resource}，${stats.upgradeTime}s）`)
    return true
  }

  /** 取消/秒完成前的返还规则：50% 升级费用（向上取整） */
  refundOnCancel(buildingId: string): void {
    const next = this.getBuildingLevel(buildingId) + 1
    const stats = this.buildingStats(buildingId, next)
    if (!stats || !this.wallet) return
    const back = Math.ceil(stats.upgradeCost / 2)
    this.wallet.add('coins', back)
    logger.info(`[Production] 取消升级返还: ${buildingId} +${back} 金币（50%）`)
  }

  // ════════════════════════════════════════════
  //  兵种研究（实验室）
  // ════════════════════════════════════════════

  /** 某兵种当前研究等级（无记录 = 1 级） */
  getTroopLevel(troopId: string): number {
    const m = this.save.get<Record<string, number>>('troopLevels') ?? {}
    const lv = m[troopId]
    return typeof lv === 'number' && lv >= 1 ? Math.floor(lv) : 1
  }

  /** 实验室等级 = 兵种可研究最高等级（未建实验室/未配表 = 1 级上限） */
  getLabLevel(): number {
    return this.getBuildingLevel('laboratory')
  }

  /** 兵种研究上限 = min(实验室等级, 表内 levels 长度) */
  troopMaxLevel(troopId: string): number {
    const troop = this.troopResolver?.(troopId)
    if (!troop) return 1
    return Math.min(this.getLabLevel(), troop.levels?.length ?? 1)
  }

  /** 研究队列（同时最多一项） */
  getResearching(): ProductionTimer | null {
    const list = this.save.get<ProductionTimer[]>('researchQueue') ?? []
    return list.length > 0 ? list[0] : null
  }

  /** 障碍物清除队列首项（null = 无清除中） */
  getClearing(): ProductionTimer | null {
    const list = this.save.get<ProductionTimer[]>('clearQueue') ?? []
    return list.length > 0 ? list[0] : null
  }

  /** 按研究等级取兵种属性（训练/战斗装配统一走这里） */
  troopStats(troopId: string): TroopLevelStats {
    const troop = this.troopResolver?.(troopId)
    if (!troop) return { hp: 0, dps: 0, cost: 0 }
    return troopLevel(troop, this.getTroopLevel(troopId))
  }

  /** 按研究等级取兵种配置视图（hp/dps/cost 已替换为当前等级值；ability/size 等保持原样） */
  troopView(troopId: string): TroopType | undefined {
    const troop = this.troopResolver?.(troopId)
    if (!troop) return undefined
    const s = this.troopStats(troopId)
    return { ...troop, hp: s.hp, dps: s.dps, cost: s.cost }
  }

  /** 开始研究：校验（兵种存在 / 未达上限 / 无进行中研究 / 药水足够）→ 扣药水 → 写研究队列 */
  startResearch(troopId: string): boolean {
    const troop = this.troopResolver?.(troopId)
    if (!troop?.levels) {
      logger.warn(`[Research] 研究失败: 兵种 "${troopId}" 无等级表（不可研究）`)
      return false
    }
    const cur = this.getTroopLevel(troopId)
    const next = cur + 1
    if (next > this.troopMaxLevel(troopId)) {
      logger.warn(`[Research] 研究失败: "${troop.name}" 已达可研究上限（实验室 ${this.getLabLevel()} 级）`)
      return false
    }
    if (this.getResearching()) {
      logger.warn(`[Research] 研究失败: 已有研究进行中（${this.getResearching()?.targetId}）`)
      return false
    }
    const row = troop.levels[next - 1]
    const cost = row?.researchCost ?? 0
    const time = row?.researchTime ?? 0
    if (!this.wallet || !this.wallet.spend('elixir', cost)) {
      logger.warn(`[Research] 研究失败: 药水不足（需 ${cost}）`)
      return false
    }
    const list = this.save.get<ProductionTimer[]>('researchQueue') ?? []
    list.push({ targetId: troopId, finishAt: Date.now() + time * 1000 })
    this.save.set('researchQueue', list)
    logger.info(`[Research] 开始研究: ${troop.name} ${cur}→${next}（-${cost} 药水，${time}s）`)
    return true
  }

  // ════════════════════════════════════════════
  //  资源产出（金矿/水库，惰性时间戳结算）
  // ════════════════════════════════════════════

  /**
   * 基地阶段每帧驱动：按 elapsed 秒 × 各矿产出速率惰性结算增量（封顶各自 storage），
   * 离线/跨阶段累积一次性补齐。写 KV 键 productionState。
   */
  update(elapsedSec: number, goldmineLevel: number, elixirLevel: number): void {
    if (elapsedSec <= 0) return
    const st = this.save.get<{ lastTickAt: number, stored: { goldmine: number, elixir: number } }>('productionState')
      ?? { lastTickAt: Date.now(), stored: { goldmine: 0, elixir: 0 } }
    const now = Date.now()
    const deltaSec = Math.min(elapsedSec, (now - this.lastProduceAt) / 1000)
    this.lastProduceAt = now
    if (deltaSec <= 0) return

    for (const [id, level, rate, cap] of [
      ['goldmine', goldmineLevel, this.buildingStats('goldmine', goldmineLevel)?.produceRate ?? 0, this.buildingStats('goldmine', goldmineLevel)?.storage ?? 0],
      ['elixir', elixirLevel, this.buildingStats('elixir', elixirLevel)?.produceRate ?? 0, this.buildingStats('elixir', elixirLevel)?.storage ?? 0],
    ] as const) {
      if (rate <= 0 || cap <= 0) continue
      const gain = Math.min(cap - (st.stored[id] ?? 0), rate * deltaSec / 60)
      if (gain > 0) st.stored[id] = (st.stored[id] ?? 0) + gain
    }
    st.lastTickAt = now
    this.save.set('productionState', st)
  }

  /** 当前积压量（浮点；展示取整） */
  getStored(id: 'goldmine' | 'elixir'): number {
    return this.save.get<{ stored: { goldmine: number, elixir: number } }>('productionState')?.stored[id] ?? 0
  }

  /** 仓库容量（大本营等级查 storageCap；未配表默认 5000） */
  getStorageCap(): number {
    const lv = this.getBuildingLevel('townhall')
    return this.buildingStats('townhall', lv)?.storageCap ?? 5000
  }

  /**
   * 收集某矿积压：入仓（受仓库容量约束）→ 清零积压。
   * @returns 实际收集量（0 = 仓库满收集失败）
   */
  collect(id: 'goldmine' | 'elixir'): number {
    const resource = id === 'goldmine' ? 'coins' : 'elixir'
    const stored = Math.floor(this.getStored(id))
    if (stored <= 0) return 0
    if (!this.wallet) return 0
    // 仓库容量校验：当前该资源 + 收集量 ≤ cap（超出部分留在矿内）
    const space = Math.max(0, this.getStorageCap() - this.wallet.get(resource))
    if (space <= 0) {
      logger.warn(`[Production] 收集失败: 仓库已满（${resource} ${this.wallet.get(resource)}/${this.getStorageCap()}）`)
      return 0
    }
    const amount = Math.min(stored, space)
    this.wallet.add(resource, amount)
    const st = this.save.get<{ lastTickAt: number, stored: { goldmine: number, elixir: number } }>('productionState')
      ?? { lastTickAt: Date.now(), stored: { goldmine: 0, elixir: 0 } }
    st.stored[id] = Math.max(0, (st.stored[id] ?? 0) - amount)
    this.save.set('productionState', st)
    logger.info(`[Production] 收集: ${resource} +${amount}（矿内剩 ${Math.floor(st.stored[id])}，仓库 ${this.wallet.get(resource)}/${this.getStorageCap()}）`)
    this.onProduced?.(resource, amount)
    return amount
  }

  /** 障碍物清除：直接入账并写清除队列（障碍物本身由基地 GameMode 管理视觉/占格） */
  startObstacleClear(obstacleId: string, costCoins: number, costElixir: number, timeSec: number): boolean {
    if (costCoins > 0 && !this.wallet?.spend('coins', costCoins)) {
      logger.warn(`[Obstacle] 清除失败: 金币不足（需 ${costCoins}）`)
      return false
    }
    if (costElixir > 0 && !this.wallet?.spend('elixir', costElixir)) {
      logger.warn(`[Obstacle] 清除失败: 药水不足（需 ${costElixir}）`)
      return false
    }
    if (timeSec <= 0) return true // 即时清除：只扣费
    const list = this.save.get<ProductionTimer[]>('clearQueue') ?? []
    list.push({ targetId: obstacleId, finishAt: Date.now() + timeSec * 1000 })
    this.save.set('clearQueue', list)
    logger.info(`[Obstacle] 开始清除: ${obstacleId}（${timeSec}s）`)
    return true
  }

  // ════════════════════════════════════════════
  //  队列推进（基地阶段每帧调用；离线按 finishAt 补结算）
  // ════════════════════════════════════════════

  /** 队列推进入口：upgradeQueue → level+1；researchQueue → troopLevels+1；clearQueue → 由宿主回调处理 */
  updateTimers(onObstacleCleared: (id: string) => void): void {
    const now = Date.now()
    // 建筑升级
    const up = this.getUpgrading()
    if (up && now >= up.finishAt) {
      const levels = { ...this.save.get<Record<string, number>>('buildingLevels'), [up.targetId]: this.getBuildingLevel(up.targetId) + 1 }
      this.save.set('buildingLevels', levels)
      this.save.set('upgradeQueue', [])
      logger.info(`[Production] 建筑升级完成: ${up.targetId} → ${this.getBuildingLevel(up.targetId)} 级`)
    }
    // 兵种研究
    const rs = this.getResearching()
    if (rs && now >= rs.finishAt) {
      const lv = { ...this.save.get<Record<string, number>>('troopLevels'), [rs.targetId]: this.getTroopLevel(rs.targetId) + 1 }
      this.save.set('troopLevels', lv)
      this.save.set('researchQueue', [])
      logger.info(`[Research] 研究完成: ${rs.targetId} → ${this.getTroopLevel(rs.targetId)} 级`)
    }
    // 障碍物清除
    const cl = (this.save.get<ProductionTimer[]>('clearQueue') ?? []).filter((t) => {
      if (now >= t.finishAt) {
        onObstacleCleared(t.targetId)
        return false
      }
      return true
    })
    this.save.set('clearQueue', cl)
  }
}
