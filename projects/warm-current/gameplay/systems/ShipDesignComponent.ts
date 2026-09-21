/**
 * ShipDesignComponent — 船队设计流组件（GameMode 上的组件位；2026-09-20 自 WarmCurrentGameMode 下沉）
 *
 * 职责（原 WarmCurrentGameMode 船坞/设计工坊方法原样迁入）：
 *  - 设计选择态权威：shipyardSelHull/shipyardSelModules/shipyardSelSlot/shipyardAddMenuOpen
 *    （船坞面板与火箭设计工坊共享同一套选择态）；
 *  - 装配台槽位投影：槽位格/堆叠行/加号小面板/部位选件清单（两面板同源共用）；
 *  - 船坞造船面板 VM（buildShipyardVM）与火箭设计面板 VM（buildShipDesignVM）；
 *  - 船型设计模板存/删/载 + 一键推荐配装 + 下单（orderFromDesign → transport.tryBuildShip）。
 *  兼容：GameMode 保留同名薄转发门面，UI 脚本与 e2e 调用点不变。
 */
import { audioSys, BObjectComponent, logger } from '@/engine'
import { B } from '../core/balance'
import {
  hullAllowsModule, hullHasSlotFor, hullSlotCapacity, isDynamicShipModule, modulesSlotUsage,
  ringModsOf, shipBuildPrice, shipHullDefOf, shipModuleDefOf, shipModuleEntries, shipTrialOf,
  shipsNeededFor, SLOT_TYPE_NAMES, supplyRateOf,
} from '../core/helpers'
import { isShipyardType, orbitBuildingDefOf } from './OrbitBuildComponent'
import { PLANET_NAMES } from '../core/planetNames'
import type {
  HudDesignRow, HudDesignSlotCell, HudHullRow, HudModuleRow, HudShipAddMenu,
  HudShipDesign, HudShipyard, HudStackRow, HudTrialRow,
} from './ViewModelComponent'
import type { OrbitBuilding, StarId } from '../core/types'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

export class ShipDesignComponent extends BObjectComponent<WarmCurrentGameMode> {
  /** 船坞面板三步流选择（2026-09-13 从面板脚本迁入：试航卡/槽位校验需要权威读态） */
  shipyardSelHull = 'standard'
  shipyardSelModules: string[] = []
  /** 设计工坊当前选中的装配台部位（槽型 + 同型实例序；null = 未选，② 区不出部件清单） */
  shipyardSelSlot: { type: string; idx: number } | null = null
  /** 装配台「+ 加号」部位选择小面板（点 + → 用户选荷载/燃料/引擎；false = 收起） */
  shipyardAddMenuOpen = false

  constructor(owner: WarmCurrentGameMode) {
    super(owner)
    this.name = 'ShipDesignComponent'
  }

  /** 面板打开复位（openShipyardPanel：船型回默认、清空选择与加号小面板） */
  resetSelection(): void {
    this.shipyardSelHull = 'standard'
    this.shipyardSelModules = []
    this.shipyardSelSlot = null
    this.shipyardAddMenuOpen = false
  }

  /** 槽位制选择收敛（船坞面板/设计面板共用：切船型后不兼容/满槽模块剔除） */
  private normalizeShipyardSelection(): { usage: Record<string, number>; capacity: Record<string, number> } {
    this.shipyardSelModules = this.shipyardSelModules.filter((id) =>
      hullHasSlotFor(this.shipyardSelHull, this.shipyardSelModules.filter((x) => x !== id), id))
    const usage = modulesSlotUsage(this.shipyardSelHull, this.shipyardSelModules)
    const capacity = hullSlotCapacity(this.shipyardSelHull)
    return { usage, capacity }
  }

  /** 可下单船坞清单（建成船坞，id 升序；下单入口在设计面板/船坞面板） */
  private availableDocks(): OrbitBuilding[] {
    const s = this.owner.simState.state
    return s.orbitBuildings
      .filter((x) => x.built && isShipyardType(x.type))
      .sort((a, b) => a.id - b.id)
  }

  /** 装配台槽位格 + 选中部位（设计/船坞两面板共用；切船型后槽型表失配 = 视为未选） */
  private buildSlotCells(
    usage: Record<string, number>,
    capacity: Record<string, number>,
  ): {
    sel: { type: string; typeName: string; idx: number; used: number; cap: number } | null
    slotCells: HudDesignSlotCell[]
  } {
    const raw = this.shipyardSelSlot
    const sel = raw && (capacity[raw.type] ?? 0) > raw.idx ? raw : null
    // 装配台槽位格（ship_hull.slots 表序展开；每格 = 槽型 + 同型实例序 + 已装模块名 + 选中态）
    const slotCells: HudDesignSlotCell[] = []
    for (const [type, cap] of Object.entries(capacity)) {
      const typeMods = this.shipyardSelModules.filter((id) => shipModuleDefOf(id)?.slotType === type)
      for (let i = 0; i < cap; i++) {
        const mid = typeMods[i]
        slotCells.push({
          type,
          typeName: SLOT_TYPE_NAMES[type] ?? type,
          slotIdx: i,
          module: mid ? shipModuleDefOf(mid)?.name ?? mid : '',
          filled: !!mid,
          sel: !!sel && sel.type === type && sel.idx === i,
        })
      }
    }
    const selSlot = sel
      ? {
          type: sel.type,
          typeName: SLOT_TYPE_NAMES[sel.type] ?? sel.type,
          idx: sel.idx,
          used: usage[sel.type] ?? 0,
          cap: capacity[sel.type] ?? 0,
        }
      : null
    return { sel: selSlot, slotCells }
  }

  /**
   * 装配台堆叠行（2026-09-17 二轮反馈精简：缺氧火箭「从底部往上堆」口径）：
   *  - 不再展开预定空槽位行，只列「已装实例行」——玩家看到的就是装了的东西；
   *  - 全装配台只有一枚加号行（固定在末尾，始终可点）：点击 = 顺序定位第一个
   *    有空位的部位（荷载→燃料→引擎），② 区出该部位部件清单；满员 = 提示船型已满；
   *  - 已装行点击 = 选中该实例换装/卸下（原口径不变）。
   * 设计面板/船坞面板同源共用此投影，选择态权威仍在 shipyardSelSlot/shipyardSelModules。
   */
  private buildStackRows(
    usage: Record<string, number>,
    capacity: Record<string, number>,
  ): HudStackRow[] {
    const rows: HudStackRow[] = []
    for (const [type, cap] of Object.entries(capacity)) {
      const typeName = SLOT_TYPE_NAMES[type] ?? type
      const typeMods = this.shipyardSelModules.filter((id) => shipModuleDefOf(id)?.slotType === type)
      for (let i = 0; i < typeMods.length; i++) {
        const mid = typeMods[i]
        rows.push({
          rowId: `${type}#${i}`,
          kind: 'module',
          type,
          typeName,
          idx: i,
          moduleName: mid ? shipModuleDefOf(mid)?.name ?? mid : '',
          filled: true,
          sel: !!this.shipyardSelSlot && this.shipyardSelSlot.type === type && this.shipyardSelSlot.idx === i,
          addable: false,
          removable: true,
          hint: '',
        })
      }
    }
    // 单一加号行：点击 = 弹出部位选择小面板（用户指定装什么，不默认荷载）
    const types = Object.keys(capacity)
    const firstOpen = types.find((t) => (usage[t] ?? 0) < (capacity[t] ?? 0)) ?? ''
    const addType = firstOpen || types[0] || ''
    const used = usage[addType] ?? 0
    rows.push({
      rowId: '__add__',
      kind: 'add',
      type: addType,
      typeName: SLOT_TYPE_NAMES[addType] ?? addType,
      idx: used,
      moduleName: '',
      filled: false,
      sel: false,
      addable: !!firstOpen,
      removable: false,
      hint: firstOpen ? '选择要加装的部位' : `${shipHullDefOf(this.shipyardSelHull)?.name ?? this.shipyardSelHull}槽位已满`,
    })
    return rows
  }

  /** 「+ 加号」部位选择小面板投影（船型槽型表键序；empty = 该部位无空位置灰） */
  private buildAddMenu(
    usage: Record<string, number>,
    capacity: Record<string, number>,
  ): HudShipAddMenu {
    const parts = Object.keys(capacity).map((type) => ({
      type,
      name: SLOT_TYPE_NAMES[type] ?? type,
      empty: (usage[type] ?? 0) < (capacity[type] ?? 0),
    }))
    return { open: this.shipyardAddMenuOpen, parts }
  }

  /** 部位选件清单（选中槽型的 ship_module 行，表序 = 低档在前；here = 本实例当前所装件） */
  private buildSlotOptions(
    sel: { type: string; idx: number } | null,
    usage: Record<string, number>,
    capacity: Record<string, number>,
  ): HudModuleRow[] {
    if (!sel) return []
    const hereId = this.shipyardSelModules
      .filter((id) => shipModuleDefOf(id)?.slotType === sel.type)[sel.idx]
    // 静态表 + 自定义设计注册表合成条目（部位选件清单：现货件在前，玩家设计追加在后）
    // 三部位统一收口（2026-09-14 用户口径：部位清单显示玩家保存后的设计）：
    // payload/fuel/engine 槽现货档位件（货舱/油箱/引擎档/泵/加热器/舱内附件）不再直接可选装——
    // 它们是设计工坊的合成原料，清单只出玩家保存的设计（payloadDesigns 投影，键序）；
    // 无设计 = 空清单（面板出引导文案）。
    // 谓词：动态设计件恒放行；现货件无任何部位角色（chassis/attachment）才放行——
    // 现存 16 件现货件全部带角色，第二析取支是给未来"无角色新件"留的安全阀。
    return shipModuleEntries()
      .filter(([, m]) => m.slotType === sel.type)
      .filter(([id, m]) => sel.type === 'payload' || sel.type === 'fuel' || sel.type === 'engine' ? isDynamicShipModule(id) || (m.payloadRole !== 'chassis' && m.payloadRole !== 'attachment' && m.fuelRole !== 'chassis' && m.engineRole !== 'chassis') : true)
      .map(([id, m]) => ({
        id,
        name: m.name,
        desc: m.desc,
        cost: m.cost,
        allowed: hullAllowsModule(this.shipyardSelHull, id),
        slotType: m.slotType ?? null,
        // 部位选件制无「满槽置灰」：同槽异件 = 原位换装，选择校验在 pickShipyardSlotModule
        slotFull: false,
        slotLabel: `${SLOT_TYPE_NAMES[sel.type] ?? sel.type} ${usage[sel.type] ?? 0}/${capacity[sel.type] ?? 0}`,
        here: hereId === id,
      }))
  }

  buildShipDesignVM(): HudShipDesign {
    const s = this.owner.simState.state
    const { usage, capacity } = this.normalizeShipyardSelection()
    const hulls: HudHullRow[] = Object.entries(B.shipHulls).map(([id, h]) => ({
      id, name: h.name, desc: h.desc, cost: h.cost,
    }))
    const { sel: selSlot, slotCells } = this.buildSlotCells(usage, capacity)
    const stackRows = this.buildStackRows(usage, capacity)
    const addMenu = this.buildAddMenu(usage, capacity)
    const slotOptions = this.buildSlotOptions(selSlot, usage, capacity)
    const slotRows = Object.entries(capacity).map(([type, cap]) => ({
      name: SLOT_TYPE_NAMES[type] ?? type,
      used: usage[type] ?? 0,
      cap,
    }))
    // 试航行 + 反推（与船坞面板同口径）
    const gap = Math.max(0, this.owner.simState.demand - supplyRateOf(s))
    const trials: HudTrialRow[] = (['moon', 'europa', 'mars'] as StarId[]).map((star) => {
      const trial = shipTrialOf(s, this.shipyardSelHull, this.shipyardSelModules, star, ringModsOf(s))
      const unlocked = this.owner.transport.starUnlocked(star)
      return {
        star,
        starName: B.stars[star].name,
        unlocked,
        unlockAct: B.stars[star].unlockAct,
        load: Math.round(trial?.load ?? 0),
        cycleS: Math.round(trial?.cycleS ?? 0),
        fuel: Math.round(trial?.fuel ?? 0),
        net: Math.round(trial?.net ?? 0),
        throughput: Math.round((trial?.throughput ?? 0) * 10) / 10,
        shipsForGap: unlocked ? shipsNeededFor(trial, gap) : -1,
      }
    })
    const designs: HudDesignRow[] = s.shipDesigns.map((d, idx) => ({
      idx,
      name: d.name,
      hullName: shipHullDefOf(d.hull)?.name ?? d.hull,
      modules: d.modules.map((id) => shipModuleDefOf(id)?.name ?? id).join('、'),
    }))
    // 可下单船坞（价格乘区取首坞；无坞 = 只能设计不能下水）
    const docks = this.availableDocks().map((d) => {
      const def = orbitBuildingDefOf(d.type)
      return {
        id: d.id,
        name: def?.name ?? d.type,
        anchorName: PLANET_NAMES[d.anchor] ?? B.stars[d.anchor as StarId]?.name ?? d.anchor,
        costMult: def?.shipBuildCostMult ?? 1,
        canOrder: s.ships.length + s.buildQueue.length < this.owner.simState.shipCap
          && (s.outcome === 'playing' || s.sandbox) && s.flare.phase !== 'active',
      }
    })
    const priceMult = docks[0]?.costMult ?? 1
    const price = Math.round(shipBuildPrice(this.shipyardSelHull, this.shipyardSelModules) * priceMult)
    return {
      hulls,
      selSlot,
      slotOptions,
      slotCells,
      stackRows,
      addMenu,
      slotRows,
      trials,
      designs,
      canSaveDesign: true,
      docks,
      price,
      fleetShips: s.ships.length,
      queueCount: s.buildQueue.length,
      cap: this.owner.simState.shipCap,
      canQueue: docks.some((d) => d.canOrder),
    }
  }

  /** 设计面板下单（指定承接船坞；校验/计费口径在 transport.tryBuildShip） */
  orderFromDesign(dockId: number): boolean {
    return this.owner.transport.tryBuildShip(this.shipyardSelHull, this.shipyardSelModules, dockId)
  }

  /** 船坞造船面板数据装配（shipyardSel → HudShipyard；船型/模块表行 + 槽位占用 + 三星试航 + 设计模板 + 逐船一卡队列） */
  buildShipyardVM(dockId: number): HudShipyard | null {
    const s = this.owner.simState.state
    const dock = s.orbitBuildings.find((x) => x.id === dockId)
    if (!dock) return null
    const def = orbitBuildingDefOf(dock.type)
    const yard = dock.built && isShipyardType(dock.type)
    const costMult = def?.shipBuildCostMult ?? 1
    const playable = (s.outcome === 'playing' || s.sandbox) && s.flare.phase !== 'active'
    const total = s.ships.length + s.buildQueue.length
    const hulls: HudHullRow[] = Object.entries(B.shipHulls).map(([id, h]) => ({
      id,
      name: h.name,
      desc: h.desc,
      cost: h.cost,
    }))
    // 槽位口径：切换船型后不兼容/满槽模块剔除（就地修正，与面板显示一致）
    this.shipyardSelModules = this.shipyardSelModules.filter((id) => hullHasSlotFor(this.shipyardSelHull, this.shipyardSelModules.filter((x) => x !== id), id))
    const usage = modulesSlotUsage(this.shipyardSelHull, this.shipyardSelModules)
    const capacity = hullSlotCapacity(this.shipyardSelHull)
    // 部位选件制（2026-09-13）：与设计面板同源——点槽位格出该槽型多档部件
    const { sel: selSlot, slotCells } = this.buildSlotCells(usage, capacity)
    const stackRows = this.buildStackRows(usage, capacity)
    const addMenu = this.buildAddMenu(usage, capacity)
    const slotOptions = this.buildSlotOptions(selSlot, usage, capacity)
    // 槽位占用行（ship_hull.slots 表键序）
    const slotRows = Object.entries(capacity).map(([type, cap]) => ({
      name: SLOT_TYPE_NAMES[type] ?? type,
      used: usage[type] ?? 0,
      cap,
    }))
    // 试航行（三星口径）+ 线路反推（补当前供应缺口）
    const gap = Math.max(0, this.owner.simState.demand - supplyRateOf(s))
    const trials: HudTrialRow[] = (['moon', 'europa', 'mars'] as StarId[]).map((star) => {
      const trial = shipTrialOf(s, this.shipyardSelHull, this.shipyardSelModules, star, ringModsOf(s))
      const unlocked = this.owner.transport.starUnlocked(star)
      return {
        star,
        starName: B.stars[star].name,
        unlocked,
        unlockAct: B.stars[star].unlockAct,
        load: Math.round(trial?.load ?? 0),
        cycleS: Math.round(trial?.cycleS ?? 0),
        fuel: Math.round(trial?.fuel ?? 0),
        net: Math.round(trial?.net ?? 0),
        throughput: Math.round((trial?.throughput ?? 0) * 10) / 10,
        shipsForGap: unlocked ? shipsNeededFor(trial, gap) : -1,
      }
    })
    const designs: HudDesignRow[] = s.shipDesigns.map((d, idx) => ({
      idx,
      name: d.name,
      hullName: shipHullDefOf(d.hull)?.name ?? d.hull,
      modules: d.modules.map((id) => shipModuleDefOf(id)?.name ?? id).join('、'),
    }))
    return {
      dockId,
      name: def?.name ?? dock.type,
      anchor: dock.anchor,
      anchorName: PLANET_NAMES[dock.anchor] ?? B.stars[dock.anchor as StarId]?.name ?? dock.anchor,
      built: dock.built,
      progressPct: Math.round(dock.progress * 100),
      canBuildShip: yard,
      costMult,
      hulls,
      selSlot,
      slotOptions,
      slotCells,
      stackRows,
      addMenu,
      slotRows,
      trials,
      designs,
      canSaveDesign: yard,
      queue: s.buildQueue.map((q, i) => ({
        idx: i,
        remainS: Math.ceil(q.remain),
        totalS: q.total,
        progressPct: Math.round(Math.max(0, Math.min(1, 1 - q.remain / Math.max(0.01, q.total))) * 100),
      })),
      fleetShips: s.ships.length,
      queueCount: s.buildQueue.length,
      cap: this.owner.simState.shipCap,
      canQueue: yard && playable && total < this.owner.simState.shipCap,
    }
  }

  // ─── 船型设计模板 + 一键推荐（2026-09-13 船队设计工坊；面板按钮调用） ───

  /** 船坞面板：选船型（不兼容/满槽模块自动剔除；槽型表随船型变 → 部位选中失效） */
  setShipyardHull(hullId: string): void {
    if (!shipHullDefOf(hullId)) return
    this.shipyardSelHull = hullId
    this.shipyardSelModules = this.shipyardSelModules.filter((id) => hullAllowsModule(hullId, id))
    this.shipyardSelSlot = null
    this.shipyardAddMenuOpen = false
  }

  /** 船坞面板：勾选/取消模块（槽位校验：hullHasSlotFor 单一口径；单船同模块一件） */
  toggleShipyardModule(moduleId: string): void {
    if (!shipModuleDefOf(moduleId)) return
    const mods = this.shipyardSelModules
    const at = mods.indexOf(moduleId)
    if (at >= 0) {
      mods.splice(at, 1)
      return
    }
    if (!hullHasSlotFor(this.shipyardSelHull, mods, moduleId)) {
      this.owner.simState.hint(`${shipModuleDefOf(moduleId)!.name}槽位已满（${shipHullDefOf(this.shipyardSelHull)?.name ?? this.shipyardSelHull}）`)
      return
    }
    mods.push(moduleId)
  }

  // ─── 部位选件制（2026-09-13 设计工坊：点部位 → 同功能多档部件挑数值） ───

  /** 装配台点部位（槽型 + 同型实例序；② 区据选出该槽型部件清单） */
  selectShipyardSlot(type: string, idx: number): void {
    const cap = hullSlotCapacity(this.shipyardSelHull)[type] ?? 0
    if (idx < 0 || idx >= cap) return
    this.shipyardSelSlot = { type, idx }
  }

  /**
   * 装配台点「+ 加号」（2026-09-17 三轮口径：用户指定部位，不默认荷载）：
   * 打开装配台内的小面板让用户选「荷载 / 燃料 / 引擎」；选了部位 =
   * selectShipyardSlot(type, 该部位下一空实例)。船型无任何空位时按钮置灰本就进不来。
   */
  openShipyardAddMenu(): void {
    const cap = hullSlotCapacity(this.shipyardSelHull)
    const usage = modulesSlotUsage(this.shipyardSelHull, this.shipyardSelModules)
    const open = Object.keys(cap).filter((t) => (usage[t] ?? 0) < (cap[t] ?? 0))
    if (open.length === 0) return
    this.shipyardAddMenuOpen = true
    logger.info(`[WarmCurrent] 装配台加号 → 部位选择（空位部位：${open.join('/')}）`)
  }

  /** 部位选择小面板：选部位（type 非法/该部位无空位忽略；选定即关面板） */
  pickShipyardAddPart(type: string): void {
    if (!this.shipyardAddMenuOpen) return
    this.shipyardAddMenuOpen = false
    const cap = hullSlotCapacity(this.shipyardSelHull)[type] ?? 0
    if (cap <= 0) return
    const used = this.shipyardSelModules.filter((id) => shipModuleDefOf(id)?.slotType === type).length
    if (used >= cap) return
    this.selectShipyardSlot(type, used)
    audioSys.play('wc.draw', { volume: 0.25 })
  }

  /** 部位选择小面板：关闭（再点加号行 = 重开） */
  closeShipyardAddMenu(): void {
    this.shipyardAddMenuOpen = false
  }

  /**
   * 部位选件（(type, idx) 定位实例；模块清单点击入口）：
   *  再点已装本实例的件 = 卸下；本实例已有他件 = 原位换装（其余实例不动）；
   *  目标件已装同级另一实例 = 两实例对调；空实例 = 装入（单船同模块一件约束保留）。
   *  实例 ↔ 模块的对应由 shipyardSelModules 表序派生（同槽型过滤后按下标），无需独立存储；
   *  卸下后同型实例左移补位（模块清单是唯一权威，同类槽位互换、聚合数值不变）。
   */
  pickShipyardSlotModule(type: string, idx: number, moduleId: string): void {
    const def = shipModuleDefOf(moduleId)
    if (!def || def.slotType !== type) return
    if (!hullAllowsModule(this.shipyardSelHull, moduleId)) {
      this.owner.simState.hint(`${def.name}与${shipHullDefOf(this.shipyardSelHull)?.name ?? this.shipyardSelHull}不兼容`)
      return
    }
    const mods = this.shipyardSelModules
    const typeIdxs = mods
      .map((id, i) => (shipModuleDefOf(id)?.slotType === type ? i : -1))
      .filter((i) => i >= 0)
    const hereAt = typeIdxs[idx] ?? -1
    if (hereAt >= 0) {
      if (mods[hereAt] === moduleId) {
        mods.splice(hereAt, 1) // 再点 = 卸下
        return
      }
      const otherAt = mods.indexOf(moduleId)
      if (otherAt >= 0 && otherAt !== hereAt) {
        // 目标件已装同级另一实例 → 两实例互换（单船同模块一件口径不破）
        const moved = mods[hereAt]
        mods[hereAt] = moduleId
        mods[otherAt] = moved
        this.owner.simState.hint(`已对调：${def.name} ↔ ${shipModuleDefOf(moved)?.name ?? moved}`)
        return
      }
      const old = mods[hereAt]
      mods[hereAt] = moduleId // 原位换装
      this.owner.simState.hint(`已换装：${shipModuleDefOf(old)?.name ?? old} → ${def.name}`)
      return
    }
    if (mods.includes(moduleId)) {
      mods.splice(mods.indexOf(moduleId), 1) // 同模块单件：该件在别的实例上 → 点选 = 卸下
      return
    }
    const used = mods.filter((id) => shipModuleDefOf(id)?.slotType === type).length
    const cap = hullSlotCapacity(this.shipyardSelHull)[type] ?? 0
    if (used >= cap) return // 防御（空实例时 used < cap 恒成立）
    mods.push(moduleId)
  }

  /** 保存当前面板选择为设计模板（名字自动编号；存进 SimState 随档走） */
  saveShipDesign(): boolean {
    const s = this.owner.simState.state
    const name = `配置 ${s.shipDesigns.length + 1}`
    s.shipDesigns.push({ name, hull: this.shipyardSelHull, modules: [...this.shipyardSelModules] })
    this.owner.simState.hint(`已保存「${name}」（${shipHullDefOf(this.shipyardSelHull)?.name ?? this.shipyardSelHull}）`)
    return true
  }

  /** 删除设计模板 */
  deleteShipDesign(idx: number): boolean {
    const s = this.owner.simState.state
    if (idx < 0 || idx >= s.shipDesigns.length) return false
    const [gone] = s.shipDesigns.splice(idx, 1)
    this.owner.simState.hint(`已删除「${gone.name}」`)
    return true
  }

  /** 载入设计模板 → 面板选择（返回是否成功；script 据此刷新勾选态） */
  loadShipDesign(idx: number): boolean {
    const s = this.owner.simState.state
    const d = s.shipDesigns[idx]
    if (!d || !shipHullDefOf(d.hull)) return false
    this.shipyardSelHull = d.hull
    this.shipyardSelModules = d.modules.filter((id) => hullAllowsModule(d.hull, id))
    this.shipyardSelSlot = null
    this.shipyardAddMenuOpen = false
    this.owner.simState.hint(`已载入「${d.name}」`)
    return true
  }

  /**
   * 一键推荐配置（能过关但非最优——《火箭工坊》同款兜底）：
   * 启发式 = 重载型双货舱 + 货泵（当级性价比最高的运量配置）；耀斑期倾向防务型防冻。
   * 2026-09-14 荷载口径收口：现货舱内件不可直接选装后，推荐不再含泵——货泵类效果
   * 走荷载设计工坊合成（自产合成件 id 因人而异，推荐只落静态表通用件）。
   */
  recommendShipDesign(): { hull: string; modules: string[] } {
    const flareRisk = this.owner.simState.state.flare.phase !== 'idle'
    if (flareRisk) return { hull: 'guardian', modules: ['cargo_hold'] }
    return { hull: 'hauler', modules: ['cargo_hold'] }
  }

  /** 一键推荐并应用到面板选择（shipyard_panel「⚙ 一键推荐配置」按钮） */
  applyShipyardRecommend(): void {
    const rec = this.recommendShipDesign()
    this.setShipyardHull(rec.hull)
    this.shipyardSelModules = []
    for (const id of rec.modules) this.toggleShipyardModule(id)
    this.owner.simState.hint('已填入推荐配置（能过关但非最优，按需微调；货舱为现货件，不在「荷载」部位清单展示）')
  }

}
