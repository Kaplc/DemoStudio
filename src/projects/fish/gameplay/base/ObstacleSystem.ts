/**
 * ObstacleSystem — 基地障碍物系统（树/石头：占格、清除、宝石掉落）
 *
 * 职责：
 *  - 基地 BeginPlay 时随机撒布障碍物（避开初始建筑占格与出生点，正方形格 1×1）
 *  - 点击障碍物 → 扣资源清除（树花金币、石头花药水）→ 完成后留空地
 *  - 清除完成概率掉落宝石（走 ProductionService.addGems 统一对账）
 *  - GM clearObstacles 命令可批量清除；每次进基地补撒至上限-1（可持续收集）
 *
 * 实现约定：障碍物是独立 Actor（立方体网格 + ClickableComponent），
 * 占格写进 FishBaseGameMode 的障碍物占用表（与建筑共用格子，放置校验天然生效）。
 * 持久化：障碍物不进存档（每次进基地按上限补撒的轻量规则刷新），
 * 清除队列走 ProductionService.clearQueue（KV 键，finishAt 时间戳支持离线结算）。
 */
import { GenericActor, BoxMeshComponent, ClickableComponent, spawnActor, logger } from '@/engine'
import { createMesh, createBoxGeometry, createMeshStandardMaterial } from '@/engine/gameflow/ThreeObjectUtils'
import type { FishBaseGameMode } from './FishBaseGameMode'

/** 障碍物类型定义 */
interface ObstacleKind {
  id: string
  kindId: 'tree' | 'rock'
  name: string
  color: number
  size: number
  height: number
  /** 清除费用（金币） */
  costCoins: number
  /** 清除费用（药水） */
  costElixir: number
  /** 清除耗时（秒；0 = 即时） */
  clearTime: number
  /** 宝石掉落概率（0~1） */
  gemChance: number
}

/** 障碍物类型表（树 = 金币清除，石头 = 药水清除） */
const OBSTACLE_KINDS: Record<'tree' | 'rock', ObstacleKind> = {
  tree: { id: 'obstacle_tree', kindId: 'tree', name: '树', color: 0x2e7d32, size: 0.9, height: 1.4, costCoins: 200, costElixir: 0, clearTime: 0, gemChance: 0.15 },
  rock: { id: 'obstacle_rock', kindId: 'rock', name: '石头', color: 0x757575, size: 0.8, height: 0.6, costCoins: 0, costElixir: 200, clearTime: 0, gemChance: 0.2 },
}

/** 单个障碍物实例（Actor + 类型 + 格子坐标） */
interface ObstacleEntry {
  actor: GenericActor
  kind: ObstacleKind
  gx: number
  gz: number
}

/** GameMode 侧障碍物仓库（挂 GameMode 实例字段，EndPlay 清空） */
const obstacleStore = new WeakMap<FishBaseGameMode, ObstacleEntry[]>()

/** 基地障碍物数量上限 */
const MAX_OBSTACLES = 5

/** 障碍物 id（清除队列 targetId 与查找键）：`${kindId}_${gx}_${gz}` */
function entryId(e: { kind: ObstacleKind, gx: number, gz: number }): string {
  return `${e.kind.kindId}_${e.gx}_${e.gz}`
}

/** 生成障碍物（基地 BeginPlay 调用；每次进基地补撒至上限-1 个） */
export function spawnObstaclesForBase(mode: FishBaseGameMode): void {
  const world = mode.world
  if (!world) return
  const list = obstacleStore.get(mode) ?? []
  if (list.length > 0) return // 幂等：同一次基地会话只撒一次
  obstacleStore.set(mode, list)
  const quota = MAX_OBSTACLES - 1
  let tries = 0
  while (list.length < quota && tries < 60) {
    tries++
    const gx = Math.floor(Math.random() * 17) - 8
    const gz = Math.floor(Math.random() * 17) - 8
    // 出生点保护（大本营在原点附近）：|gx|,|gz| ≤ 2 跳过
    if (Math.abs(gx) <= 2 && Math.abs(gz) <= 2) continue
    placeObstacle(mode, Math.random() < 0.6 ? 'tree' : 'rock', gx, gz)
  }
  logger.info(`[Obstacle] 障碍物已生成: ${list.length} 个（树/石头随机分布，避开出生点）`)
}

/** 放置单个障碍物（占格走 GameMode 障碍物占用表，与建筑放置校验共用格子） */
export function placeObstacle(mode: FishBaseGameMode, kindId: 'tree' | 'rock', gx: number, gz: number): boolean {
  const world = mode.world
  const kind = OBSTACLE_KINDS[kindId]
  if (!world || !kind) return false
  if (!mode.isGridFree(gx, gz)) return false

  const actor = new GenericActor(`Obstacle_${kind.name}_${gx}_${gz}`)
  const geo = createBoxGeometry(kind.size, kind.height, kind.size)
  const mat = createMeshStandardMaterial({ color: kind.color })
  const mesh = createMesh(geo, mat)
  const comp = new BoxMeshComponent(actor, mesh, 'ObstacleMesh')
  mesh.object.position.y = kind.height / 2
  actor.addComponent(comp)
  // 点击清除
  const clickable = new ClickableComponent(actor)
  clickable.clickCooldown = 300
  const id = `${kindId}_${gx}_${gz}`
  clickable.onClick = () => {
    logger.info(`[Obstacle] ${kind.name} @ (${gx},${gz}) 被点击（清除入口）`)
    mode.clearObstacle(id)
  }
  actor.addComponent(clickable)
  actor.setPosition(gx, 0, gz)
  spawnActor(actor)
  mode.occupyObstacleGrid(gx, gz)
  const list = obstacleStore.get(mode) ?? []
  list.push({ actor, kind, gx, gz })
  obstacleStore.set(mode, list)
  logger.info(`[Obstacle] 放置 ${kind.name} @ (${gx},${gz})`)
  return true
}

/** 按 id 找条目 */
function findEntry(mode: FishBaseGameMode, id: string): ObstacleEntry | null {
  const list = obstacleStore.get(mode) ?? []
  return list.find((e) => entryId(e) === id) ?? null
}

/**
 * 发起清除（点击入口）：即时扣费（当前配置树/石头均为即时清除），完成回调走 finishObstacleClear。
 * 耗时清除走 ProductionService.clearQueue（finishAt 时间戳，离线结算天然支持）。
 */
export function clearObstacleReward(mode: FishBaseGameMode, id: string): boolean {
  const inst = mode.gameInstance
  const entry = findEntry(mode, id)
  if (!entry || !inst) return false
  const kind = entry.kind
  // 已有清除进行中 → 忽略重复点击
  if (inst.production.getClearing()) return false
  const ok = inst.production.startObstacleClear(id, kind.costCoins, kind.costElixir, kind.clearTime)
  if (!ok) return false
  logger.info(`[Obstacle] 清除已受理: ${kind.name}（费用 ${kind.costCoins}金/${kind.costElixir}水）`)
  // 即时清除（clearTime=0）直接完成
  if (kind.clearTime <= 0) finishObstacleClear(mode, id)
  return true
}

/** 清除完成：移除 Actor + 释放占格 + 宝石掉落判定 */
export function finishObstacleClear(mode: FishBaseGameMode, id: string): void {
  const list = obstacleStore.get(mode) ?? []
  const idx = list.findIndex((e) => entryId(e) === id)
  if (idx < 0) return
  const entry = list[idx]
  list.splice(idx, 1)
  entry.actor.destroy()
  mode.freeObstacleGrid(entry.gx, entry.gz)
  // 宝石掉落判定（统一走 GemService 对账）
  const inst = mode.gameInstance
  if (inst && Math.random() < entry.kind.gemChance) {
    const drop = 1 + Math.floor(Math.random() * 3)
    inst.production.addGems(`障碍物掉落-${entry.kind.name}`, drop)
    logger.info(`[Obstacle] 💎 宝石掉落: +${drop}（${entry.kind.name}）`)
  }
  // 统计上报（每日任务 clearObstacles）
  inst?.progression.report('clearObstacles', 1)
  logger.info(`[Obstacle] 清除完成: ${entry.kind.name} @ (${entry.gx},${entry.gz})，剩 ${list.length} 个`)
}

/** 当前障碍物数量（GM 命令/调试桥用） */
export function obstacleCount(mode: FishBaseGameMode): number {
  return (obstacleStore.get(mode) ?? []).length
}

/** GM 批量清除（clearObstacles 命令用；无掉落，直接清空） */
export function gmClearAllObstacles(mode: FishBaseGameMode): number {
  const list = obstacleStore.get(mode) ?? []
  for (const e of [...list]) {
    e.actor.destroy()
    mode.freeObstacleGrid(e.gx, e.gz)
  }
  obstacleStore.set(mode, [])
  logger.info(`[Obstacle] GM 清空障碍物: ${list.length} 个`)
  return list.length
}
