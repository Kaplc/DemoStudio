/**
 * ProgressionService — 成长进度服务（ClashMaster）
 *
 * 挂载到 FishGameInstance：
 *  - 星级战绩：按战斗结算统计评 1-3 星，写 KV levelRecords（只增不减）
 *  - 每关三星首杀 → 宝石奖励（GemService 渠道）
 *  - 成就/每日任务：统计上报 + 达标领取，每日跨天刷新 3 条任务
 *
 * 星级规则（doc/devdocs/progression/star-rating.md）：
 *   ⭐1 摧毁率 ≥ 50%；⭐2 摧毁大本营；⭐3 摧毁率 100%（独立达成，按或合并）
 */
import { AObjectComponent, logger } from '@/engine'
import type { AObject } from '@/engine'
import type { SaveSlotComponent } from '@/engine'
import type { TaskType } from '../common/types'

/** 单关历史最高战绩（type 别名：隐式索引签名，满足 KVValue 约束） */
export type LevelRecord = {
  bestStars: number
  bestDestroyRate: number
}

/** 战斗结算输入（星级评价） */
export interface BattleStatsInput {
  destroyRate: number
  townhallDestroyed: boolean
  levelId: string | null
  /** 战斗内摧毁建筑数（成就/每日 destroyBuildings 上报口径） */
  destroyedCount?: number
}

/** 每日任务运行时条目（type 别名：隐式索引签名，满足 KVValue 约束） */
export type DailyTaskEntry = {
  taskId: string
  name: string
  type: TaskType['type']
  target: number
  progress: number
  claimed: boolean
  rewardCoins?: number
  rewardElixir?: number
  rewardGems?: number
}

/** 三星首杀宝石奖励（每关一次性） */
export const THREE_STAR_FIRST_KILL_GEMS = 10

export class ProgressionService extends AObjectComponent<AObject> {
  private readonly save: SaveSlotComponent
  /** 资源钱包（奖励发放走 GemService 统一入口） */
  wallet: { get(r: string): number, spend(r: string, n: number): boolean, add(r: string, n: number): void } | null = null
  /** 宝石统一入口（由宿主注入 ProductionService.addGems 的引用，保证对账） */
  addGems: ((reason: string, amount: number) => void) | null = null
  /** 成就/每日任务配置表（构造后由宿主注入） */
  achievementTable: Record<string, TaskType> = {}
  dailyTable: Record<string, TaskType> = {}
  /** 战斗胜利事件回调（成就统计上报用） */
  onBattleWon: (() => void) | null = null

  constructor(owner: AObject, options: { save: SaveSlotComponent }) {
    super(owner)
    this.name = 'ProgressionService'
    this.save = options.save
  }

  // ════════════════════════════════════════════
  //  星级战绩
  // ════════════════════════════════════════════

  /** 战斗结束评星：⭐1 摧毁 ≥50%；⭐2 拆大本营；⭐3 100% 全拆 */
  static evaluateStars(destroyRate: number, townhallDestroyed: boolean): number {
    let stars = 0
    if (destroyRate >= 0.5) stars++
    if (townhallDestroyed) stars++
    if (destroyRate >= 1) stars++
    return stars
  }

  /** 某关历史最高星（无记录 = 0） */
  getLevelStars(levelId: string): number {
    return this.getLevelRecord(levelId)?.bestStars ?? 0
  }

  /** 某关历史最高记录 */
  getLevelRecord(levelId: string): LevelRecord | null {
    const records = this.save.get<Record<string, LevelRecord>>('levelRecords') ?? {}
    return records[levelId] ?? null
  }

  /**
   * 战斗结算：评星 → 刷新历史最高 → 三星首杀发宝石奖励。
   * @returns 本局星级与是否首杀三星
   */
  settleBattle(input: BattleStatsInput): { stars: number, firstThreeStar: boolean } {
    const stars = ProgressionService.evaluateStars(input.destroyRate, input.townhallDestroyed)
    let firstThreeStar = false
    if (input.levelId) {
      const records = this.save.get<Record<string, LevelRecord>>('levelRecords') ?? {}
      const prev = records[input.levelId]
      const rate = Math.round(input.destroyRate * 100) / 100
      if (!prev || stars > prev.bestStars || rate > prev.bestDestroyRate) {
        records[input.levelId] = {
          bestStars: Math.max(stars, prev?.bestStars ?? 0),
          bestDestroyRate: Math.max(rate, prev?.bestDestroyRate ?? 0),
        }
        this.save.set('levelRecords', records)
        logger.info(`[Progression] 关卡战绩更新: ${input.levelId} ${stars}★（摧毁 ${(rate * 100).toFixed(0)}%，历史最高 ${records[input.levelId].bestStars}★）`)
      }
      // 三星首杀奖励：此前无三星记录且本局三星
      if (stars >= 3 && (prev?.bestStars ?? 0) < 3) {
        firstThreeStar = true
        this.addGems?.(`三星首杀-${input.levelId}`, THREE_STAR_FIRST_KILL_GEMS)
      }
    }
    // 成就/任务统计：摧毁建筑数（真实栋数，由 GameMode 战场计数器提供）
    this.report('destroyBuildings', input.destroyedCount ?? 0)
    if (input.townhallDestroyed) this.report('battleWins', 1)
    return { stars, firstThreeStar }
  }

  // ════════════════════════════════════════════
  //  关卡解锁
  // ════════════════════════════════════════════

  /**
   * 关卡是否解锁（实时推导，读 levelRecords 星级，不落额外字段）。
   * 前置关卡记录缺失视为未解锁（记 warn 防配置错误导致静默卡死）。
   */
  isLevelUnlocked(requirement: { levelId: string, stars: number } | undefined): boolean {
    if (!requirement) return true
    const records = this.save.get<Record<string, LevelRecord>>('levelRecords') ?? {}
    const got = records[requirement.levelId]?.bestStars ?? 0
    if (got >= requirement.stars) return true
    // 前置关卡从未通关：正常流程（首次游玩）与配置错误（levelId 配错）都走这里，
    // 用 debug 级日志提示排查线索，避免高频 warn 刷屏
    logger.debug(`[Progression] 关卡未解锁: 需 ${requirement.levelId} ≥ ${requirement.stars}★（当前 ${got}★）`)
    return false
  }

  /** GM 强制解锁：直接写三星记录（调试用） */
  gmUnlockLevel(levelId: string): void {
    const records = this.save.get<Record<string, LevelRecord>>('levelRecords') ?? {}
    records[levelId] = { bestStars: 3, bestDestroyRate: Math.max(records[levelId]?.bestDestroyRate ?? 0, 1) }
    this.save.set('levelRecords', records)
    logger.info(`[Progression] GM 强制解锁: ${levelId} → 3★`)
  }

  // ════════════════════════════════════════════
  //  成就 / 每日任务
  // ════════════════════════════════════════════

  /** 统计上报入口（战斗结算/建造完成/收集/训练等埋点调用；进度只增不减） */
  report(type: TaskType['type'], amount: number): void {
    if (amount <= 0) return
    // 成就累计
    const ach = this.save.get<Record<string, number>>('achievementProgress') ?? {}
    let achChanged = false
    for (const [id, def] of Object.entries(this.achievementTable)) {
      if (def.type !== type) continue
      const before = Math.min(ach[id] ?? 0, def.target)
      ach[id] = before + amount
      achChanged = true
    }
    if (achChanged) this.save.set('achievementProgress', ach)
    // 每日任务进度
    const daily = this.save.get<{ date: string, tasks: DailyTaskEntry[] }>('dailyTasks')
    if (daily) {
      let changed = false
      for (const t of daily.tasks) {
        if (t.type !== type || t.claimed || t.progress >= t.target) continue
        t.progress = Math.min(t.target, t.progress + amount)
        changed = true
      }
      if (changed) this.save.set('dailyTasks', daily)
    }
    // 达标成就提示
    for (const [id, def] of Object.entries(this.achievementTable)) {
      if (def.type === type && (ach[id] ?? 0) >= def.target) {
        const claimed = this.save.get<string[]>('achievementsClaimed') ?? []
        if (!claimed.includes(id)) logger.info(`[Achievement] 成就可领取: ${def.name}（${id}）`)
      }
    }
  }

  /** 成就进度与可领取状态快照（任务面板渲染用） */
  getAchievementSnapshot(): Array<{ id: string, def: TaskType, progress: number, claimable: boolean, claimed: boolean }> {
    const progress = this.save.get<Record<string, number>>('achievementProgress') ?? {}
    const claimed = this.save.get<string[]>('achievementsClaimed') ?? []
    return Object.entries(this.achievementTable).map(([id, def]) => ({
      id,
      def,
      progress: Math.min(progress[id] ?? 0, def.target),
      claimable: (progress[id] ?? 0) >= def.target && !claimed.includes(id),
      claimed: claimed.includes(id),
    }))
  }

  /** 领取成就奖励（幂等：已领取返回 false；奖励统一走资源入口） */
  claimAchievement(id: string): boolean {
    const def = this.achievementTable[id]
    if (!def) return false
    const claimed = this.save.get<string[]>('achievementsClaimed') ?? []
    if (claimed.includes(id)) return false
    const progress = this.save.get<Record<string, number>>('achievementProgress') ?? {}
    if ((progress[id] ?? 0) < def.target) return false
    claimed.push(id)
    this.save.set('achievementsClaimed', claimed)
    this.grantReward(`成就-${id}`, def)
    logger.info(`[Achievement] 成就奖励已领取: ${def.name}`)
    return true
  }

  /** 每日跨天检测 + 任务刷新（基地阶段每秒调用；本地日期为准，不补发） */
  tickDailyRefresh(): void {
    const today = new Date().toDateString()
    const st = this.save.get<{ date: string, tasks: DailyTaskEntry[] }>('dailyTasks')
    if (st && st.date === today) return
    // 从任务池随机取 3 条
    const pool = Object.entries(this.dailyTable)
    const picked: DailyTaskEntry[] = []
    const used = new Set<number>()
    while (picked.length < Math.min(3, pool.length)) {
      const i = Math.floor(Math.random() * pool.length)
      if (used.has(i)) continue
      used.add(i)
      const [id, def] = pool[i]
      picked.push({
        taskId: id, name: def.name, type: def.type, target: def.target, progress: 0, claimed: false,
        rewardCoins: def.rewardCoins, rewardElixir: def.rewardElixir, rewardGems: def.rewardGems,
      })
    }
    this.save.set('dailyTasks', { date: today, tasks: picked })
    logger.info(`[Daily] 每日任务已刷新（${today}）：${picked.map((t) => t.name).join(' / ')}`)
  }

  /** 每日任务快照（面板渲染用） */
  getDailyTasks(): DailyTaskEntry[] {
    return this.save.get<{ tasks: DailyTaskEntry[] }>('dailyTasks')?.tasks ?? []
  }

  /** 领取每日任务奖励（幂等） */
  claimDaily(taskId: string): boolean {
    const st = this.save.get<{ date: string, tasks: DailyTaskEntry[] }>('dailyTasks')
    if (!st) return false
    const t = st.tasks.find((x) => x.taskId === taskId)
    if (!t || t.claimed || t.progress < t.target) return false
    t.claimed = true
    this.save.set('dailyTasks', st)
    this.grantReward(`每日-${taskId}`, { name: t.name, rewardCoins: t.rewardCoins, rewardElixir: t.rewardElixir, rewardGems: t.rewardGems } as TaskType)
    logger.info(`[Daily] 每日任务奖励已领取: ${t.name}`)
    return true
  }

  /** 奖励发放统一走资源入口（宝石走 GemService，金币/药水直接入仓） */
  private grantReward(reason: string, def: TaskType): void {
    if (def.rewardCoins) this.wallet?.add('coins', def.rewardCoins)
    if (def.rewardElixir) this.wallet?.add('elixir', def.rewardElixir)
    if (def.rewardGems) this.addGems?.(reason, def.rewardGems)
  }
}
