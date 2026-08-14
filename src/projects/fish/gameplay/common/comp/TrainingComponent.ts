/**
 * TrainingComponent — 训练部队系统组件（部落冲突风格）
 *
 * 挂载到 FishGameInstance（AObject）上，管理：
 *  - 训练队列（FIFO，按兵种配置的 trainTime 倒计时，update 驱动逐项完成）
 *  - 已训练完成的军队（兵种 id → 数量）
 *  - 军队容量（housing 总和上限）
 *
 * 与资源系统解耦：训练扣费由入口（FishGameInstance.trainTroop）先调用
 * resources.spend('coins', cost)，再调本组件 enqueue —— 本组件只负责队列/军队本身。
 * 队列变化/训练完成通过 onChange 回调通知（兵营 UI 刷新）。
 *
 * 注意：挂载在 GameInstance（AObject 无组件 Tick 驱动），由宿主在 tick() 中
 * 手动调用 update(dt) 驱动训练倒计时（基地阶段才推进）。
 *
 * 用法（FishGameInstance 构造）：
 *   this.training = new TrainingComponent(this, { maxHousing: 40 })
 *   this.addComponent(this.training)
 */
import { AObjectComponent, logger } from '@/engine'
import type { AObject } from '@/engine'
import type { TroopType } from '../types'

/** 训练队列项（外部可读快照） */
export interface TrainingItem {
  troopId: string
  name: string
  housing: number
  remaining: number
  total: number
}

export class TrainingComponent extends AObjectComponent<AObject> {
  /** 军队容量上限（housing 总和） */
  maxHousing = 40
  /** 训练时间倍率（1 = 按配置；调试可调小加速） */
  trainTimeScale = 1

  /** 训练队列（FIFO，逐项完成） */
  private queue: TrainingItem[] = []
  /** 已训练完成的军队：兵种 id → 数量 */
  private army = new Map<string, number>()

  /** 队列/军队变化回调（外部刷新 UI） */
  onChange: (() => void) | null = null

  constructor(owner: AObject, options: { maxHousing?: number; trainTimeScale?: number } = {}) {
    super(owner)
    this.name = 'TrainingComponent'
    if (options.maxHousing !== undefined) this.maxHousing = options.maxHousing
    if (options.trainTimeScale !== undefined) this.trainTimeScale = options.trainTimeScale
  }

  /** 每帧驱动训练倒计时（由宿主 FishGameInstance.tick 手动调用，基地阶段推进） */
  update(dt: number): void {
    if (this.queue.length === 0) return
    const head = this.queue[0]
    head.remaining -= dt
    if (head.remaining <= 0) {
      this.queue.shift()
      this.army.set(head.troopId, (this.army.get(head.troopId) ?? 0) + 1)
      logger.info(`[TrainingComponent] 训练完成: ${head.name} 加入军队（当前兵力 ${this.getArmyHousing()}/${this.maxHousing}）`)
      this.onChange?.()
    }
  }

  // ═════════ 训练 ═════════

  /**
   * 入训练队列（调用方应先扣费/校验）。返回是否成功。
   * 失败原因（容量不足等）经日志输出。
   */
  enqueue(troopId: string, troop: TroopType): boolean {
    // 自动记录兵种信息（容量换算/摘要用）
    this.registerTroop(troopId, troop)
    // 容量校验（含队列中已占用的空间）
    const used = this.getArmyHousing() + this.queue.reduce((s, t) => s + t.housing, 0)
    if (used + troop.housing > this.maxHousing) {
      logger.warn(`[TrainingComponent] 训练失败：军队容量不足（${used}/${this.maxHousing}，还需 ${troop.housing}）`)
      return false
    }
    const total = troop.trainTime * this.trainTimeScale
    this.queue.push({
      troopId,
      name: troop.name,
      housing: troop.housing,
      remaining: total,
      total,
    })
    logger.info(`[TrainingComponent] 开始训练: ${troop.name}（训练 ${troop.trainTime}s，占用 ${troop.housing} 空间；队列 ${this.queue.length} 项）`)
    this.onChange?.()
    return true
  }

  // ═════════ 查询 ═════════

  /** 当前军队占用容量（housing 总和） */
  getArmyHousing(): number {
    let sum = 0
    for (const [tid, count] of this.army) {
      sum += (this.armyHousingMap.get(tid) ?? 0) * count
    }
    return sum
  }

  /** 训练队列快照（供 UI 显示剩余时间） */
  getQueue(): ReadonlyArray<Readonly<TrainingItem>> {
    return this.queue.map((t) => ({ ...t }))
  }

  /** 训练队列剩余时间合计（秒） */
  getQueueTimeLeft(): number {
    return this.queue.reduce((s, t) => s + Math.max(0, t.remaining), 0)
  }

  /** 军队中某兵种数量 */
  getArmyCount(troopId: string): number {
    return this.army.get(troopId) ?? 0
  }

  /**
   * 部署一个兵（战斗放兵消耗，放完即消失）：
   * 军队中该兵种数量 -1（至少为 0），触发 onChange 刷新 UI。
   * @returns 是否部署成功（数量 > 0 才成功）
   */
  deployTroop(troopId: string): boolean {
    const count = this.army.get(troopId) ?? 0
    if (count <= 0) {
      logger.warn(`[TrainingComponent] 部署失败：军队中无 "${troopId}"（数量 ${count}）`)
      return false
    }
    this.army.set(troopId, count - 1)
    const t = this.troopById.get(troopId)
    logger.info(`[TrainingComponent] 部署完成: ${t?.name ?? troopId} 上战场（剩余 ${count - 1}）`)
    this.onChange?.()
    return true
  }

  /** 军队全部耗尽（所有兵种数量均为 0，战斗失败判定用） */
  isArmyEmpty(): boolean {
    for (const count of this.army.values()) {
      if (count > 0) return false
    }
    return true
  }

  /**
   * 调试用：直接向军队注入兵种（绕过训练队列/容量/扣费，战斗测试专用）。
   * 生产流程应走 FishGameInstance.trainTroop（扣费 → 入队 → 倒计时完成入列）。
   */
  debugAddArmy(troopId: string, count: number): boolean {
    if (count <= 0) return false
    this.army.set(troopId, (this.army.get(troopId) ?? 0) + Math.floor(count))
    logger.info(`[TrainingComponent] 调试注入军队: ${troopId} x${count}（当前 ${this.army.get(troopId)}）`)
    this.onChange?.()
    return true
  }

  /** 军队摘要：'野蛮人x3 巨人x1'（按兵种名） */
  getArmySummary(): string {
    const parts: string[] = []
    for (const [tid, count] of this.army) {
      if (count <= 0) continue
      const t = this.troopById.get(tid)
      parts.push(`${t?.name ?? tid}x${count}`)
    }
    return parts.length > 0 ? parts.join(' ') : '无'
  }

  /** 训练队列摘要：'野蛮人 8s 巨人 45s' */
  getQueueSummary(): string {
    return this.queue.map((t) => `${t.name} ${Math.ceil(t.remaining)}s`).join(' ') || '空闲'
  }

  // ═════════ 兵种表引用（供容量/摘要换算） ═════════

  /** 兵种 id → housing 映射（由外部注入，或 enqueue 时自动记录） */
  private armyHousingMap = new Map<string, number>()
  /** 兵种 id → 兵种信息（由外部注入，或 enqueue 时自动记录） */
  private troopById = new Map<string, TroopType>()

  /** 注册兵种信息（外部可在初始化时批量注入，enqueue 也会自动记录） */
  registerTroop(troopId: string, troop: TroopType): void {
    this.armyHousingMap.set(troopId, troop.housing)
    this.troopById.set(troopId, troop)
  }

  override getProperties(): Record<string, unknown> {
    return {
      MaxHousing: this.maxHousing,
      ArmyHousing: this.getArmyHousing(),
      Queue: this.getQueueSummary(),
      Army: this.getArmySummary(),
    }
  }
}
