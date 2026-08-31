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

  /** 队列/军队变化回调（外部刷新 UI；单槽，供 UI 直接绑定会被覆盖） */
  onChange: (() => void) | null = null

  /** 系统级变化监听器（持久化订阅等；与单槽 onChange 并存互不覆盖） */
  private _changeListeners: Array<() => void> = []

  /**
   * 注册队列/军队变化监听器（返回解绑函数）。与 onChange 单槽并存：
   * UI 可继续绑定/覆盖 onChange，不影响这里的持久化链路。
   */
  addChangeListener(fn: () => void): () => void {
    this._changeListeners.push(fn)
    return () => {
      this._changeListeners = this._changeListeners.filter((f) => f !== fn)
    }
  }

  /** 统一的变化广播：先单槽后监听器列表（副本遍历，允许回调中解绑） */
  private notifyChange(): void {
    this.onChange?.()
    for (const fn of [...this._changeListeners]) fn()
  }

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
      this.notifyChange()
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
    this.notifyChange()
    return true
  }

  /** 清空训练队列与军队（GM 重置存档用） */
  resetAll(): void {
    if (this.queue.length === 0 && this.getArmyCountAll() === 0) return
    this.queue = []
    this.army.clear()
    logger.info('[TrainingComponent] 训练队列与军队已清空')
    this.notifyChange()
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

  /** 军队总兵力（所有兵种数量之和） */
  getArmyCountAll(): number {
    let sum = 0
    for (const count of this.army.values()) sum += count
    return sum
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
    this.notifyChange()
    return true
  }

  /**
   * 军队回滚（部署失败补偿）：数量 +1 并广播。
   * 配合 GameMode"先扣军队再 acquire 兵池"的失败回滚路径。
   * @returns 是否回滚成功（未知兵种不创建幽灵条目）
   */
  refundTroop(troopId: string): boolean {
    if (!this.troopById.has(troopId)) return false
    this.army.set(troopId, (this.army.get(troopId) ?? 0) + 1)
    logger.info(`[TrainingComponent] 军队回滚: ${this.troopById.get(troopId)?.name ?? troopId} +1（兵池 acquire 失败补偿）`)
    this.notifyChange()
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
    this.notifyChange()
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

  // ═════════ 快照 / 恢复（持久化支持，由 FishSaveAdapter 调用） ═════════

  /** 军队快照（持久化采集用）：兵种 id → 数量（仅含数量 > 0 的条目） */
  getArmySnapshot(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const [tid, count] of this.army) {
      if (count > 0) out[tid] = count
    }
    return out
  }

  /** 训练队列快照（持久化采集用，最小字段；恢复时按兵种表重建其余字段） */
  getQueueSnapshot(): Array<{ troopId: string; remaining: number }> {
    return this.queue.map((t) => ({ troopId: t.troopId, remaining: t.remaining }))
  }

  /**
   * 持久化恢复：用快照整体替换军队（调用方已做兵种合法性过滤）。
   * 数量取整并 clamp 到 ≥0，全部为 0 的条目跳过。
   * @returns 恢复的兵种数
   */
  setArmySnapshot(snapshot: Record<string, number>): number {
    this.army.clear()
    let restored = 0
    for (const [tid, raw] of Object.entries(snapshot ?? {})) {
      const count = Math.max(0, Math.floor(Number(raw) || 0))
      if (count <= 0) continue
      this.army.set(tid, count)
      restored++
    }
    logger.info(`[TrainingComponent] 军队已从存档恢复（${restored} 个兵种）`)
    this.notifyChange()
    return restored
  }

  /**
   * 持久化恢复：按快照重建训练队列。name/housing/total 由 resolveTroop 查兵种表补全
   * （未知兵种跳过），remaining clamp 到 [0, total]。不做离线追时——与正常训练
   * 同一推进模型（基地阶段由宿主 update(dt) 推进倒计时）。
   * @returns 恢复的队列条目数
   */
  setQueueSnapshot(
    items: ReadonlyArray<{ troopId: string; remaining: number }>,
    resolveTroop: (id: string) => TroopType | undefined,
  ): number {
    this.queue = []
    let restored = 0
    for (const item of items ?? []) {
      const troop = resolveTroop(item?.troopId)
      if (!troop) {
        logger.warn(`[TrainingComponent] 队列恢复跳过：未知兵种 "${item?.troopId}"`)
        continue
      }
      this.registerTroop(item.troopId, troop)
      const total = troop.trainTime * this.trainTimeScale
      const raw = Number.isFinite(item.remaining) ? item.remaining : total
      const remaining = Math.min(Math.max(raw, 0), total)
      this.queue.push({ troopId: item.troopId, name: troop.name, housing: troop.housing, remaining, total })
      restored++
    }
    logger.info(`[TrainingComponent] 训练队列已从存档恢复 ${restored} 项`)
    this.notifyChange()
    return restored
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
