/**
 * FishSaveAdapter — ClashMaster 存档编解码适配层
 *
 * 集中定义存档 schema（KV 键名 / 版本 / 类型）与转换纯函数，
 * 使 ResourcesComponent / TrainingComponent / FishBaseGameMode 完全不知道存档的存在，
 * 转换逻辑只落在 GameInstance 一处（本文件）+ 少量接线（FishGameInstance）。
 *
 * 手动存档模型：游戏过程所有变化只写内存 KV（零 IO），玩家在存档菜单
 * （Esc → save_menu.widget.json）点"保存存档"才整表落盘、"读取存档"整表回读。
 *
 * 存档文件：src/projects/fish/data/save.json（SaveSlotComponent 经
 * readJsonFile/writeJsonFile IPC 落盘；扁平 KV 键，某键缺失退回该项默认值）。
 *
 * KV Schema v2（v1 → v2 迁移：补 gem/等级/战绩/成就新键，v1 旧值保留）：
 *   v               : 2                              —— 版本号，不符则整表作废重开
 *   savedAt         : ISO 时间戳                     —— 仅诊断展示
 *   resources       : { coins, elixir, gems }        —— 整钱包快照
 *   army            : { 兵种id: 数量 }                —— 已训练完成的军队
 *   queue           : [{ troopId, remaining }]       —— 训练队列（最小字段，恢复时查表补全）
 *   baseBuildings   : [{ id, gx, gz }]               —— 基地建筑布局（锚点格）
 *   buildingLevels  : { buildingId: level }          —— 建筑等级（缺省 = 1）
 *   upgradeQueue    : [{ targetId, finishAt }]       —— 建筑升级队列（0/1 项）
 *   troopLevels     : { troopId: level }             —— 兵种研究等级（缺省 = 1）
 *   researchQueue   : [{ targetId, finishAt }]       —— 研究队列（0/1 项）
 *   clearQueue      : [{ targetId, finishAt }]       —— 障碍物清除队列
 *   productionState : { lastTickAt, stored }         —— 金矿/水库积压
 *   levelRecords    : { levelId: { bestStars, bestDestroyRate } } —— 关卡战绩
 *   achievementProgress / achievementsClaimed       —— 成就进度/已领取
 *   dailyTasks      : { date, tasks }                —— 每日任务
 *   clearedLevels   : string[]                       —— 通关记录（现阶段只写不读）
 *
 * 纪律：SaveSlotComponent.get<T> 返回内部对象的活引用——所有写回一律传新建对象。
 */
import { SaveSlotComponent, logger } from '@/engine'
import { CLASH_BUILDING_TYPES } from '../base/ClashBuildingTypes'
import { PLACE_HALF } from '../base/ClashBaseBuilder'
import { INITIAL_COINS } from './types'
import type { TroopType } from './types'
import type { FishGameInstance } from '../FishGameInstance'

/** 存档文件路径（相对仓库根；IPC 强制 .json 后缀 + 仓库根内路径） */
export const FISH_SAVE_FILE = 'src/projects/fish/data/save.json'
/** 存档 schema 版本（不符 → 整表作废走全新开局，下次 flush 自愈覆盖） */
export const FISH_SAVE_VERSION = 2

/** 单栋建筑的持久化条目：类型 id + 锚点格子坐标 */
export interface SavedBuilding {
  id: string
  gx: number
  gz: number
}

/** 训练队列的持久化条目：兵种 id + 剩余秒数（name/housing/total 恢复时按兵种表重建） */
export interface SavedQueueItem {
  troopId: string
  remaining: number
}

// ════════════════════════════════════════════
//  运行时 → KV（内存随手写，磁盘择机刷）
// ════════════════════════════════════════════

/**
 * 把运行时状态拍平写入 KV（resources/army/queue/savedAt）。
 * 挂在资源/训练组件的变化监听器上随手调用——只改内存标脏；
 * 手动存档模型下唯一落盘入口是 FishGameInstance.saveGame()（菜单"保存存档"）
 * 与 GM resetSave 的强制 flush。baseBuildings 不在此处（由布局事件单独同步）。
 */
export function syncRuntimeKeys(inst: FishGameInstance): void {
  const save = inst.save
  save.set('resources', {
    coins: inst.resources.get('coins'),
    elixir: inst.resources.get('elixir'),
    gems: inst.resources.get('gems'),
  })
  // 新建对象快照（组件返回值可能是活引用，直接存会绕过 dirty 纪律）
  save.set('army', inst.training.getArmySnapshot())
  save.set('queue', inst.training.getQueueSnapshot().map((t) => ({ ...t })))
}

/** 写入版本号与落盘时间戳（每次落盘边界调用一次即可） */
export function writeMetaKeys(inst: FishGameInstance): void {
  inst.save.set('v', FISH_SAVE_VERSION)
  inst.save.set('savedAt', new Date().toISOString())
}

// ════════════════════════════════════════════
//  KV → 运行时（load 后回填）
// ════════════════════════════════════════════

/**
 * 存档校验 + 回填运行时组件（load 完成后、进场景前调用）：
 *  - 版本不符/缺失 → clear 整表，之后按首次运行路径走默认值（自愈式迁移）
 *  - resources 缺键补默认（避免 HUD 显示 NaN/空）
 *  - army 过滤未知兵种与非法数量后整体替换
 *  - queue 按兵种表重建（未知兵种跳过，remaining clamp 到 [0, total]）
 */
export function applyRuntime(inst: FishGameInstance): void {
  const save = inst.save

  const v = save.get<number>('v')
  if (!save.has('v') || v !== FISH_SAVE_VERSION) {
    // v1 → v2 迁移：资源键结构未变（gems 缺省补 0），等级/战绩等新键缺省即默认值，
    // 只需把版本号写为新值即可保留旧进度；更老版本/未知版本仍作废重开。
    if (v === 1) {
      logger.info('[Fish] 存档 v1 → v2 迁移：保留资源/军队/布局，等级/战绩/成就从默认开始')
      save.set('v', FISH_SAVE_VERSION)
    } else {
      if (save.has('v')) logger.warn(`[Fish] 存档版本不匹配(${String(v ?? '无')} ≠ ${FISH_SAVE_VERSION})，作废重开`)
      save.clear()
      return
    }
  }

  // 资源钱包：保证三键存在再整体 set（缺省补 INITIAL_COINS/0/0）
  const res = (save.get('resources') ?? null) as Partial<Record<string, unknown>> | null
  const resObj = res != null && typeof res === 'object' ? res : {}
  inst.resources.set('coins', toNonNegInt(resObj.coins, INITIAL_COINS))
  inst.resources.set('elixir', toNonNegInt(resObj.elixir, 0))
  inst.resources.set('gems', toNonNegInt(resObj.gems, 0))

  // 军队：按兵种表过滤未知 id 与非法数量
  const armyRaw = (save.get('army') ?? null) as Partial<Record<string, unknown>> | null
  const armyObj = armyRaw != null && typeof armyRaw === 'object' ? armyRaw : {}
  const troopTable = inst.getTroopTable()
  const army: Record<string, number> = {}
  for (const [tid, raw] of Object.entries(armyObj)) {
    if (troopTable && !troopTable.getRow(tid)) continue
    const count = toNonNegInt(raw, 0)
    if (count > 0) army[tid] = count
  }
  inst.training.setArmySnapshot(army)

  // 训练队列：交给组件恢复（内部同样按表过滤 + clamp），不做离线追时
  const queueRaw: unknown = save.get('queue')
  if (Array.isArray(queueRaw)) {
    inst.training.setQueueSnapshot(sanitizeQueue(queueRaw), (id: string): TroopType | undefined => inst.getTroop(id))
  }
}

/** 队列条目消毒：字段类型不对的条目丢弃（值级 clamp 在 TrainingComponent 内做） */
function sanitizeQueue(raw: unknown[]): SavedQueueItem[] {
  const out: SavedQueueItem[] = []
  for (const item of raw) {
    if (item == null || typeof item !== 'object') continue
    const it = item as Record<string, unknown>
    if (typeof it.troopId !== 'string' || typeof it.remaining !== 'number') continue
    out.push({ troopId: it.troopId, remaining: it.remaining })
  }
  return out
}

/** 建筑条目消毒：id ∈ 类型表、坐标为 |gx|,|gz| ≤ PLACE_HALF 的整数 */
export function sanitizeBuildings(raw: unknown): SavedBuilding[] {
  if (!Array.isArray(raw)) return []
  const ids = new Set(CLASH_BUILDING_TYPES.map((t) => t.id))
  const out: SavedBuilding[] = []
  for (const item of raw) {
    if (item == null || typeof item !== 'object') continue
    const b = item as Record<string, unknown>
    if (typeof b.id !== 'string' || !ids.has(b.id)) continue
    const gx = Number(b.gx)
    const gz = Number(b.gz)
    if (!Number.isInteger(gx) || !Number.isInteger(gz)) continue
    if (Math.abs(gx) > PLACE_HALF || Math.abs(gz) > PLACE_HALF) continue
    out.push({ id: b.id, gx, gz })
  }
  return out
}

// ════════════════════════════════════════════
//  重置（GM resetSave 用）
// ════════════════════════════════════════════

/**
 * 清除存档并重置运行时为全新开局（金币=INITIAL_COINS、药水=0、宝石=0、军队/队列清空、
 * baseBuildings 键删除）。资源回调会把默认钱包重新写回 KV 并带上新版本号；
 * 若正处于基地阶段由调用方（FishGameInstance.resetSave）负责清掉场景中的既有布局。
 */
export function resetRuntimeAndKeys(inst: FishGameInstance): void {
  inst.save.clear()
  inst.resources.set('coins', INITIAL_COINS)
  inst.resources.set('elixir', 0)
  inst.resources.set('gems', 0)
  inst.training.resetAll()
  deleteClearedLevels(inst.save)
  writeMetaKeys(inst)
  void inst.save.flush(true)
}

// ════════════════════════════════════════════
//  关卡通关记录（现阶段只写不读）
// ════════════════════════════════════════════

/** 记录一条通关关卡 id（幂等去重；直接落在 KV 键 clearedLevels 上） */
export function addClearedLevel(save: SaveSlotComponent, levelId: string): void {
  const prev = save.get<string[]>('clearedLevels')
  const list = Array.isArray(prev) ? prev.filter((x): x is string => typeof x === 'string') : []
  if (!list.includes(levelId)) {
    list.push(levelId)
    save.set('clearedLevels', list)
  }
}

/** 删除通关记录键（重置用） */
export function deleteClearedLevels(save: SaveSlotComponent): void {
  save.delete('clearedLevels')
}

/** 非负整数化（NaN/undefined/负数/小数 → fallback） */
function toNonNegInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : NaN
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.floor(n)
}
