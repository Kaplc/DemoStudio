/**
 * WarmCurrent 存档领域逻辑（三槽位，纯函数，无 IO）
 *
 * 模型对齐引擎 SaveSlotComponent 的 KV 约定：
 *  每个槽位一个 JSON 文件（projects/warm-current/data/slot{1..3}.json），
 *    文件内容 = { [SAVE_KEY]: SaveSlotPayload }
 *  - 游戏状态以 SimState 深快照整体进 payload（SimStateComponent.snapshot/restore 同源）
 *  - 读档恢复 rng：SimState.seed 落在状态里，mulberry32(seed) 重放
 * 纯函数无引擎类依赖（除 KVValue 类型），单测可脱离 World 直接覆盖。
 */
import type { KVValue } from '@/engine'
import { B } from './balance'
import { deepSnapshot, freshLedger, mulberry32 } from './helpers'
import type { SimBuilding, SimShip, SimState } from './types'

/** 存档格式版本（payload 结构变更时 +1，读档兼容处理依据）。
 *  v2：SimState.stations（旧补给站）→ SimState.buildings（自由放置建筑，无法映射，旧档站点丢弃）。
 *  v3：研究点数制（超频下线）——SimState.research[].points 新增（旧档补 0）、
 *      SimLedger.overclock 改名 research（旧档缺失字段按 0 兜底）。
 *  v4：海克斯弹卡暂停（2026-09-08 拍板）——hexHiddenAt/自动收纳下线（旧档读入时清字段）。
 *  v5：聚能环建设脱离科研（2026-09-08）——ringBuild/ringBuildProgress 新增（旧档补默认 1 点/0 进度）、
 *      SimLedger.ringBuild 计费项新增（freshLedger 合并兜底）。
 *  v6：环线移除（2026-09-08）——科研 5 线 → 4 线，旧档 research 残留环线行读入时过滤。
 *  v7：堆心温度（2026-09-08 用户拍板：无燃料不再是倒计时）——continuity/bufferLeft/bufferTotal
 *      下线，改 coreTemp（旧档按 ring 映射：运转满温、断环按缓冲剩余折算温度）；
 *      mods.bufferAdd/recoverMult 字段删除（旧档残留读入时清）。
 *  v8：建筑入轨（2026-09-08 用户拍板：建筑放置后绕最近行星公转）——SimBuilding 新增
 *      anchor/orbitR/orbitA0（纯增量字段：旧档缺失 = 静态建筑，读入无需迁移；新档旧代码读入
 *      多余字段亦无害）。
 *  v9：近地轨道建筑（2026-09-09 用户需求：点行星 → 轨道建设 → 建筑绕行星均布公转）——
 *      SimState.orbitBuildings 新增（旧档补空数组）、SimLedger.orbitBuild 计费项新增
 *      （freshLedger 合并兜底）、SimEvent.orbit_building_built 事件新增。
 *  v10：船坞独立造船面板（2026-09-09 用户需求：点船坞开独立面板，逐船一卡排队）——
 *      SimState.buildQueue 从剩余秒数组 number[] 升级为 SimShipBuild[]（{remain, total, dockId}），
 *      旧档读入时逐项映射 {remain: 原值, total: 原值, dockId: 0}（GM 无船坞归属口径）。
 *  v11：聚能环槽位化 + 玩家设计权扩展（2026-09-11 两案合并迁移）——
 *      ① 环槽位化：SimState.nodes（12 交点）→ ringSlots（25 槽位，round((n−1)×24/11)+1 等比映射）、
 *      ringBuildings 新增全空（老档不送建筑，玩家重新构筑）、ringDemolish 补 null；
 *      ② 船型模块：SimShip 增 hull='standard'/modules=[]（初始标准型裸船）、SimShipBuild 补
 *      hull/modules；③ 建筑强化：SimBuilding 补 upgrade=null；④ 船耀斑订单 order/shelter 为
 *      可选字段随 ships 序列化顺带保存（旧档缺失即未决策）；⑤ ledger 增 ringInstall/buildingUpgrade
 *      （freshLedger 合并兜底）。 */
export const SAVE_FORMAT_VERSION = 11

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
  /** 已建成环段槽位数（v11 槽位制；旧档按等比映射折算） */
  slots: number
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
    // v11 槽位制：新档直读 ringSlots；旧档（nodes 残留）按等比映射折算展示
    slots: typeof s.ringSlots === 'number'
      ? s.ringSlots
      : legacyNodesToSlots(typeof s.nodes === 'number' ? s.nodes : 1),
    outcome: (s.outcome === 'victory' || s.outcome === 'defeat' ? s.outcome : 'playing') as SaveSlotMeta['outcome'],
    sandbox: s.sandbox === true,
  }
}

/** 旧 12 交点数 → 新 25 槽位数等比映射（1→1、12→25；与 restoreSimState 迁移同式） */
function legacyNodesToSlots(nodes: number): number {
  return Math.min(25, Math.max(1, Math.round((nodes - 1) * 24 / 11) + 1))
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
  // v5→v6 兼容（环线移除）：旧档残留环线行 → 过滤（环线职责已并入聚能环建设流）
  if (Array.isArray(sim.research)) {
    sim.research = sim.research.filter((l) => (l.id as string) !== 'ring')
    for (const line of sim.research) {
      if (typeof line.points !== 'number' || !Number.isFinite(line.points)) line.points = 0
    }
  }
  // v3→v4 兼容（弹卡暂停）：hexHiddenAt/自动收纳机制下线 → 清旧档残留字段；
  // pendingCard.since（自动收纳倒计时基准）同批删除，弹窗不再有超时概念
  delete (sim as unknown as Record<string, unknown>).hexHiddenAt
  if (sim.pendingCard && typeof sim.pendingCard === 'object') {
    delete (sim.pendingCard as unknown as Record<string, unknown>).since
  }
  // v4→v5 兼容（聚能环建设脱离科研）：旧档无 ringBuild/ringBuildProgress → 补默认点数/0 进度
  const rb = (sim as Partial<SimState>).ringBuild
  if (!rb || typeof rb !== 'object' || typeof (rb as { points?: number }).points !== 'number') {
    sim.ringBuild = { points: B.ringBuild.defaultPoints }
  }
  if (typeof (sim as Partial<SimState>).ringBuildProgress !== 'number') sim.ringBuildProgress = 0
  // v8→v9 兼容（近地轨道建筑）：旧档无 orbitBuildings → 补空数组（纯增量字段，无迁移语义）
  if (!Array.isArray((sim as Partial<SimState>).orbitBuildings)) sim.orbitBuildings = []
  // v9→v10 兼容（船坞独立造船面板）：buildQueue 剩余秒数组 → 逐船结构
  // （{remain, total, dockId}；旧档无船坞归属 → dockId=0、total=remain（进度从当前剩余继续），
  //  同 GM/桥无参路径口径）
  if (Array.isArray(sim.buildQueue)) {
    sim.buildQueue = sim.buildQueue.map((x) =>
      typeof x === 'number'
        ? { remain: x, total: x, dockId: 0, hull: 'standard', modules: [] }
        : {
            remain: typeof x?.remain === 'number' ? x.remain : 0,
            total: typeof x?.total === 'number' && x.total > 0 ? x.total : (typeof x?.remain === 'number' ? x.remain : 0),
            dockId: typeof x?.dockId === 'number' ? x.dockId : 0,
            hull: typeof (x as { hull?: string })?.hull === 'string' ? (x as { hull: string }).hull : 'standard',
            modules: Array.isArray((x as { modules?: string[] })?.modules) ? (x as { modules: string[] }).modules : [],
          },
    )
  } else {
    sim.buildQueue = []
  }
  // v10→v11 兼容（聚能环槽位化 + 玩家设计权扩展，2026-09-11 两案合并）：
  // ① 12 交点 → 25 槽位等比映射（round((n−1)×24/11)+1；1→1、12→25），建设进度原样保留
  if (typeof (sim as Partial<SimState>).ringSlots !== 'number') {
    const legacyNodes = typeof (sim as unknown as Record<string, unknown>).nodes === 'number'
      ? ((sim as unknown as Record<string, unknown>).nodes as number)
      : 1
    ;(sim as Partial<SimState>).ringSlots = Math.min(25, Math.max(1, Math.round((legacyNodes - 1) * 24 / 11) + 1))
  }
  delete (sim as unknown as Record<string, unknown>).nodes
  // ② 环段建筑装入表：迁移初始全空（老档不送建筑，玩家重新构筑）+ 拆除目标补 null
  if (!Array.isArray((sim as Partial<SimState>).ringBuildings)) {
    ;(sim as Partial<SimState>).ringBuildings = Array.from({ length: Math.max(1, B.ringSlots) }, () => null)
  }
  const rd = (sim as Partial<SimState>).ringDemolish
  if (!rd || typeof rd !== 'object' || typeof rd.slot !== 'number') sim.ringDemolish = null
  else if (typeof rd.progress !== 'number' || rd.progress < 0) rd.progress = 0
  // ③ 船型模块：存量船补标准型裸船（船的身份字段，建成后不可改装）
  if (Array.isArray(sim.ships)) {
    for (const ship of sim.ships) {
      if (typeof (ship as Partial<SimShip>).hull !== 'string') (ship as Partial<SimShip>).hull = 'standard'
      if (!Array.isArray((ship as Partial<SimShip>).modules)) (ship as Partial<SimShip>).modules = []
    }
  }
  // ④ 建筑强化：存量建筑补 null（一槽二选一，未强化）
  if (Array.isArray(sim.buildings)) {
    for (const b of sim.buildings) {
      if ((b as Partial<SimBuilding>).upgrade === undefined) (b as Partial<SimBuilding>).upgrade = null
    }
  }
  // 旧档无 ledger（H3 收支账本为后续新增）→ 零账本兜底（统计从读档时刻重新累计）；
  // 旧档账本缺新字段（如 overclock→research 改名后的 research）→ 按零账本补齐缺失键
  sim.ledger = { ...freshLedger(), ...(typeof sim.ledger === 'object' && sim.ledger !== null ? sim.ledger : {}) }
  // v6→v7 兼容（堆心温度）：旧档 continuity/bufferLeft/bufferTotal 下线 →
  // coreTemp 按旧字段折算（运转满温；断环取缓冲剩余比例），旧字段删除
  const legacy = sim as unknown as Record<string, unknown>
  if (typeof (sim as Partial<SimState>).coreTemp !== 'number') {
    const bufferLeft = typeof legacy.bufferLeft === 'number' ? legacy.bufferLeft : 0
    const bufferTotal = typeof legacy.bufferTotal === 'number' && legacy.bufferTotal > 0 ? legacy.bufferTotal : 1
    sim.coreTemp = legacy.ring === 'decaying' ? Math.max(0, Math.min(100, (bufferLeft / bufferTotal) * 100)) : 100
  }
  delete legacy.continuity
  delete legacy.bufferLeft
  delete legacy.bufferTotal
  // v6→v7 兼容：mods 里已删除的字段（bufferAdd/recoverMult）从旧档清除
  if (sim.mods && typeof sim.mods === 'object') {
    delete (sim.mods as unknown as Record<string, unknown>).bufferAdd
    delete (sim.mods as unknown as Record<string, unknown>).recoverMult
  }
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
