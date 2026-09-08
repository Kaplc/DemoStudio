/**
 * WarmCurrent 存档领域逻辑（三槽位，纯函数，无 IO）
 *
 * 模型对齐引擎 SaveSlotComponent 的 KV 约定：
 *  - 每个槽位一个 JSON 文件（projects/warm-current/data/slot{1..3}.json），
 *    文件内容 = { [SAVE_KEY]: SaveSlotPayload }
 *  - 游戏状态以 SimState 深快照整体进 payload（SimStateComponent.snapshot/restore 同源）
 *  - 读档恢复 rng：SimState.seed 落在状态里，mulberry32(seed) 重放
 * 纯函数无引擎类依赖（除 KVValue 类型），单测可脱离 World 直接覆盖。
 */
import type { KVValue } from '@/engine'
import { deepSnapshot, freshLedger, mulberry32 } from './helpers'
import type { SimState } from './types'

/** 存档格式版本（payload 结构变更时 +1，读档兼容处理依据）。
 *  v2：SimState.stations（旧补给站）→ SimState.buildings（自由放置建筑，无法映射，旧档站点丢弃）。
 *  v3：研究点数制（超频下线）——SimState.research[].points 新增（旧档补 0）、
 *      SimLedger.overclock 改名 research（旧档缺失字段按 0 兜底）。 */
export const SAVE_FORMAT_VERSION = 3

/** payload 在 KV 表里的 key（每槽文件只存这一项） */
export const SAVE_KEY = 'warmCurrentSave'

/** 槽位数量与落盘文件路径（相对仓库根，main.ts writeJsonFile 白名单内） */
export const SAVE_SLOT_COUNT = 3
export const SAVE_SLOT_FILES: string[] = [1, 2, 3].map((n) => `projects/warm-current/data/slot${n}.json`)

/** 单个槽位的存档 payload（KV 值，整体 JSON 可序列化） */
export interface SaveSlotPayload {
  v: number
  savedAt: string
  sim: SimState
}

/** 存档槽位摘要（UI 列表渲染用；从 payload 投影，不含完整 SimState） */
export interface SaveSlotMeta {
  slot: number
  savedAt: string | null
  time: number
  act: number
  nodes: number
  outcome: 'playing' | 'victory' | 'defeat'
  sandbox: boolean
}

/**
 * 采集当前状态 → 槽位 payload（深快照，写回一律新建对象——活引用纪律）。
 * @param state 当前仿真状态（游戏侧传 simState.state）
 * @param savedAt 落盘时刻（ISO；由调用方 new Date().toISOString() 注入便于测试）
 */
export function serializeSlot(state: SimState, savedAt: string): SaveSlotPayload {
  return { v: SAVE_FORMAT_VERSION, savedAt, sim: deepSnapshot(state) }
}

/**
 * 从槽位 KV 表读取摘要（UI 列表）。
 * @param kv 槽位文件的整表对象（electronAPI.readJsonFile 的 data，或 SaveSlotComponent.toObject()）
 * @returns 摘要；空档/结构不合法返回 null
 */
export function readSlotMeta(kv: Record<string, KVValue> | null): SaveSlotMeta | null {
  if (!kv || typeof kv !== 'object') return null
  return readSlotMetaFromPayload(kv[SAVE_KEY], 0)
}

/** 带槽位号读取摘要（GameInstance 层从三个槽位组件分发时使用） */
export function readSlotMetaWithSlot(kv: Record<string, KVValue> | null, slot: number): SaveSlotMeta | null {
  const meta = readSlotMeta(kv)
  return meta ? { ...meta, slot } : null
}

/** 槽位文件读取器签名（对齐 electronAPI.readJsonFile 的返回信封） */
export type SaveSlotReader = (path: string) => Promise<{ success: boolean; data?: unknown; error?: string }>

/**
 * 扫描三槽位文件，取 savedAt 最新的槽位摘要（主菜单读档入口的共享口径）。
 * GameInstance.handleMenuAction 与 MainMenuScript.refreshLoadButton 均消费此函数，
 * 避免「扫槽取最近档」两处独立实现将来漂移。
 * @param reader 文件读取器（Electron 环境传 electronAPI.readJsonFile 的包装；测试可注入桩）
 * @returns 最近档摘要；三槽全空/全部不可读返回 null
 */
export async function findLatestSlotMeta(reader: SaveSlotReader): Promise<SaveSlotMeta | null> {
  let best: SaveSlotMeta | null = null
  for (let i = 0; i < SAVE_SLOT_FILES.length; i++) {
    let kv: Record<string, KVValue> | null = null
    try {
      const res = await reader(SAVE_SLOT_FILES[i])
      kv = res.success && res.data && typeof res.data === 'object' ? (res.data as Record<string, KVValue>) : null
    } catch {
      kv = null // 单槽读取失败自愈：按空槽处理，不炸整轮扫描
    }
    const meta = readSlotMetaWithSlot(kv, i + 1)
    if (meta?.savedAt && (!best || (best.savedAt ?? '') < meta.savedAt)) best = meta
  }
  return best
}

/**
 * 从 payload 读取摘要（带槽位号）。结构不合法返回 null（坏档自愈：UI 显示空栏）。
 */
export function readSlotMetaFromPayload(payload: KVValue | null, slot: number): SaveSlotMeta | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const p = payload as Record<string, KVValue>
  const sim = p.sim
  // 宽松校验：SimState 关键数组字段在即可（版本兼容以字段存在性为准）
  if (!sim || typeof sim !== 'object' || Array.isArray(sim)) return null
  const s = sim as Record<string, KVValue>
  if (!Array.isArray(s.ships) || !Array.isArray(s.routes) || typeof s.time !== 'number') return null
  return {
    slot,
    savedAt: typeof p.savedAt === 'string' ? p.savedAt : null,
    time: s.time,
    act: (typeof s.act === 'number' ? s.act : 1) as SaveSlotMeta['act'],
    nodes: typeof s.nodes === 'number' ? s.nodes : 0,
    outcome: (s.outcome === 'victory' || s.outcome === 'defeat' ? s.outcome : 'playing') as SaveSlotMeta['outcome'],
    sandbox: s.sandbox === true,
  }
}

/**
 * 校验并深拷贝待恢复的 SimState（读档恢复入口）。
 * @returns 恢复包（深拷贝状态 + 按 seed 重放的 rng）；结构不合法返回 null（坏档拒绝载入）
 */
export function restoreSimState(
  sim: SimState,
): { state: SimState; rng: () => number } | null {
  if (!sim || typeof sim !== 'object') return null
  if (!Array.isArray(sim.ships) || !Array.isArray(sim.routes) || typeof sim.seed !== 'number') return null
  // v1→v2 兼容：旧档无 buildings 字段（补给站无法映射为自由建筑，置空）；
  // 旧档残留 kind:'station' 航线端点 → endpointPos/buildingByEndpoint 兜底回地球，不炸渲染
  if (!Array.isArray((sim as Partial<SimState>).buildings)) sim.buildings = []
  // v2→v3 兼容（研究点数制）：旧档研究线无 points 字段 → 补 0（未分配任何点数）
  if (Array.isArray(sim.research)) {
    for (const line of sim.research) {
      if (typeof line.points !== 'number' || !Number.isFinite(line.points)) line.points = 0
    }
  }
  // 旧档无 ledger（H3 收支账本为后续新增）→ 零账本兜底（统计从读档时刻重新累计）；
  // 旧档账本缺新字段（如 overclock→research 改名后的 research）→ 按零账本补齐缺失键
  sim.ledger = { ...freshLedger(), ...(typeof sim.ledger === 'object' && sim.ledger !== null ? sim.ledger : {}) }
  return { state: deepSnapshot(sim), rng: mulberry32(sim.seed) }
}

/** 单槽摘要文本（UI 行渲染统一口径） */
export function formatSlotInfo(meta: SaveSlotMeta | null): string {
  if (!meta) return '空栏'
  const at = meta.savedAt
  let time = ''
  if (at) {
    const d = new Date(at)
    time = isNaN(d.getTime()) ? '' : ` · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return `第${['一', '二', '三'][Math.min(Math.max(meta.act, 1), 3) - 1]}幕 · ${Math.floor(meta.time / 60)}分${time}${meta.sandbox ? ' · 沙盒' : ''}`
}
