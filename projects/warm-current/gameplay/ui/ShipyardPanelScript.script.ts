/**
 * ShipyardPanelScript — 船坞造船面板 widget 行为脚本（shipyard_panel.widget.json 根节点）
 *
 * 职责（数据由 GameMode.shipyardSel + shipyardSelHull/shipyardSelModules/shipyardSelSlot 驱动，本脚本只做差分呈现）：
 *  - 星图点船坞 → GameMode.openShipyardPanel(dockId) → vm.shipyard 非空 → 面板展开
 *  - 面板内 ✕ / 点空地 → GameMode.closeShipyardPanel() → vm.shipyard 为 null → 收起
 *  - 造船三步流（2026-09-17 堆叠式装配台改版，选择态权威在 GameMode，与火箭设计工坊同源）：
 *      ① 选船型（HullList 动态生成 ship_hull_cell，ship_hull 表驱动；点击 → mode.setShipyardHull）
 *      ② 堆叠式装配台（StackList 垂直堆叠行池：已装实例行 + 末尾单一加号行，justify=end 从底部往上堆；
 *         加号行点击 → mode.openShipyardAddMenu() 弹出部位选择小面板（AddMenu：荷载/燃料/引擎）；
 *         选部位 → mode.pickShipyardAddPart(type) = selectShipyardSlot 定位空实例；
 *         已装行点击 → mode.selectShipyardSlot(type, idx) 换装/卸下；
 *         ModuleList 出该槽型多档部件：点击 → mode.pickShipyardSlotModule 换装/卸下）
 *      ③ 总价（船体 + Σ模块 × 船坞折扣）入队（transport.tryBuildShip(hull, modules, dockId)）
 *  - 试航卡（TrialText：三星口径吞吐/净赚/轮时 + 线路反推「补缺口需 N 艘」）
 *  - 一键推荐配置（mode.recommendShipDesign → 应用到选择态）
 *  - 设计模板（存为模板 / 点击载入 / 删除所选）
 *  - 造船队列逐船一卡：容器 ShipCardList 挂 UILayout（vertical），卡片池随队列长度增删
 *  - 8Hz 差分同步；在建船坞只显示建造进度，无造船按钮
 */
import { BehaviourScript, logger } from '@/engine'
import type { Actor } from '@/engine'
import { shipBuildPrice, shipHullDefOf, shipModuleDefOf } from '../core/helpers'
import { ColorBinder, TextBinder, VisBinder, findButton, findChild, findText, wcMode } from './uiCommon'

/** 船坞造船面板 widget 资产路径（HudScript 生成入口） */
export const SHIPYARD_PANEL_WIDGET = 'asset/blueprints/ui/shipyard_panel.widget.json'
/** 造船队列卡片 / 船型格 / 模块格子 widget 资产路径（动态生成） */
export const SHIP_BUILD_CARD_WIDGET = 'asset/blueprints/ui/ship_build_card.widget.json'
export const SHIP_HULL_CELL_WIDGET = 'asset/blueprints/ui/ship_hull_cell.widget.json'
export const SHIP_MODULE_CELL_WIDGET = 'asset/blueprints/ui/ship_module_cell.widget.json'
/** 堆叠行 / 加号行 widget 资产路径（2026-09-17 堆叠式装配台，与火箭设计工坊共用） */
export const SHIP_STACK_ROW_WIDGET = 'asset/blueprints/ui/ship_stack_row.widget.json'
export const SHIP_STACK_ADD_WIDGET = 'asset/blueprints/ui/ship_stack_add.widget.json'

/** 卡片池容量上限（与飞船上限同量级取整；超出提示走 HUD 口径，不无限生成） */
const MAX_CARDS = 12
/** 堆叠行池容量上限（船型最大槽位数 = hauler 4；含箭体行 + 加号行取整防扩展溢出） */
const STACK_ROW_CAP = 12

export default class ShipyardPanelScript extends BehaviourScript {
  private binder = new TextBinder()
  private colors = new ColorBinder()
  private vis = new VisBinder()
  private acc = 1
  /** 卡片 Actor 池（与队列前 N 项一一对应，随队列长度增删） */
  private cards: Actor[] = []
  /** 各卡片文本差分缓存（Actor → 上次文案） */
  private cardTexts = new Map<Actor, string>()
  /** 船型/部位选件/模板格 Actor 池（表键序） */
  private hullCells: Actor[] = []
  private optionCells: Actor[] = []
  private designCells: Actor[] = []
  /** 格子 → 条目 id 实时映射（每帧随内容刷新；点击闭包只持 idx，杜绝捕获陈旧 viewmodel） */
  private hullIds: string[] = []
  private optionIds: string[] = []
  private designIdxs: number[] = []
  /** 槽位格 → (槽型, 实例序)（点击 selectShipyardSlot 用；随 VM 刷新） */
  private stackRowDefs: Array<{ type: string; idx: number }> = []
  private stackAddDefs: Array<{ type: string; idx: number }> = []
  /** 堆叠行池（2026-09-17 堆叠式装配台；行 VM 序驱动，只增不毁） */
  private stackRowCells: Actor[] = []
  private stackAddCells: Actor[] = []
  /** 选中态差分（按 Actor 实例做键；写原生 btn.checked，stateColors.checked 承载视觉） */
  private checkedMap = new Map<Actor, boolean>()
  /** 可点态差分（按 Actor 实例做键；disabled 置灰） */
  private enabledMap = new Map<Actor, boolean>()
  /** 格子整体显隐差分（按 Actor 实例做键） */
  private visMap = new Map<Actor, boolean>()
  /** 最近载入的模板下标（删除按钮目标；null = 删最后一个） */
  private lastLoadedDesign: number | null = null

  /** 面板当前是否展开（HudScript 居中互斥读取；唯一权威 = GameMode.shipyardSel） */
  get isOpen(): boolean {
    return wcMode()?.shipyardSel != null
  }

  override onStart(): void {
    const bind = (name: string, fn: () => void): void => {
      const btn = findButton(this.actor, name)
      if (btn) btn.onClick = fn
    }
    // 面板内 ✕ 关闭 = 清空 GameMode.shipyardSel（点空地同链路）
    bind('Btn_yd_close', () => wcMode()?.closeShipyardPanel())
    // 「造船」按钮：按当前船型+模块整单入队（cap/槽位校验/计费在 TransportComponent，失败 hint）
    bind('Btn_yd_build', () => {
      const mode = wcMode()
      if (mode?.shipyardSel != null) mode.transport.tryBuildShip(mode.shipyardSelHull, mode.shipyardSelModules, mode.shipyardSel)
    })
    // 一键推荐配置（《火箭工坊》兜底：能过关但非最优）
    bind('Btn_yd_recommend', () => wcMode()?.applyShipyardRecommend())
    // 「+ 加号」部位选择小面板（三轮口径：点 + → 用户选荷载/燃料/引擎）
    bind('Btn_add_payload', () => wcMode()?.pickShipyardAddPart('payload'))
    bind('Btn_add_fuel', () => wcMode()?.pickShipyardAddPart('fuel'))
    bind('Btn_add_engine', () => wcMode()?.pickShipyardAddPart('engine'))
    // 设计模板：存 / 删
    bind('Btn_yd_save', () => wcMode()?.saveShipDesign())
    bind('Btn_yd_ddel', () => {
      const mode = wcMode()
      if (!mode) return
      const designs = mode.simState.state.shipDesigns
      if (designs.length === 0) return
      const idx = this.lastLoadedDesign != null && this.lastLoadedDesign < designs.length
        ? this.lastLoadedDesign
        : designs.length - 1
      mode.deleteShipDesign(idx)
      this.lastLoadedDesign = null
    })
    // 默认收起（脚本置位，先于首帧渲染；禁 active=false 种子——显隐一律走脚本）
    this.vis.set(this.actor, 'ShipyardBody', false)
    this.vis.set(this.actor, 'AddMenu', false)
    logger.info('[ShipyardPanelScript] 船坞造船面板就绪（堆叠式装配台 + 试航卡 + 设计模板，默认收起）')
  }

  override onUpdate(dt: number): void {
    const mode = wcMode()
    if (!mode) return
    this.acc += dt
    if (this.acc < 0.12) return
    this.acc = 0
    const yd = mode.buildViewModel().shipyard
    this.vis.set(this.actor, 'ShipyardBody', !!yd)
    if (!yd) {
      this.syncCards(0)
      return
    }

    // 标题 + 船坞状态行
    this.binder.set(findText(this.actor, 'TitleText'), `${yd.name} · ${yd.anchorName}`)
    if (!yd.built) {
      // 在建船坞：只显示建造进度，无造船按钮
      this.binder.set(findText(this.actor, 'StatusText'), `建造中 ${yd.progressPct}%`)
      this.vis.set(this.actor, 'Btn_yd_build', false)
      this.syncCards(yd.queue.length)
      return
    }

    // ─── 三步流：船型格 / 堆叠装配台 + 选件清单 / 总价 ───
    this.syncHullCells(yd)
    this.syncStackRows(yd)
    this.syncAddMenu(yd.addMenu)
    this.syncSlotOptions(yd)
    this.syncDesignCells(yd)
    const price = Math.round(shipBuildPrice(mode.shipyardSelHull, mode.shipyardSelModules) * yd.costMult)
    const hullDef = shipHullDefOf(mode.shipyardSelHull)
    const hullPrice = Math.round((hullDef?.cost ?? 0) * yd.costMult)
    const hullName = hullDef?.name ?? mode.shipyardSelHull
    const modNames = mode.shipyardSelModules.map((id) => shipModuleDefOf(id)?.name ?? id)
    const modPrice = mode.shipyardSelModules.reduce((sum, id) => sum + (shipModuleDefOf(id)?.cost ?? 0), 0)
    const orderLines = [
      `船体：${hullName} · ${hullPrice} H3`,
      `插件：${modNames.length ? modNames.join('、') : '未选配'}${modPrice ? ` · ${Math.round(modPrice * yd.costMult)} H3` : ''}`,
      `整单：${price} H3（船坞价 ×${yd.costMult.toFixed(2)}）`,
      yd.canQueue ? '船坞空闲，可下水' : '⚠ 船队上限已满',
    ]
    this.binder.set(findText(this.actor, 'OrderText'), orderLines.join('\n'))
    this.vis.set(this.actor, 'Btn_yd_build', true)
    this.binder.set(findText(this.actor, 'BtnLabel'), yd.canQueue ? `下水 · ${price} H3` : `上限已满 · ${price} H3`)

    // 试航卡（三星口径 + 线路反推；补缺口口径 = 当前需求 − 满负荷供应）
    const trialLines: string[] = ['—— 试航预估 ——']
    for (const t of yd.trials) {
      if (!t.unlocked) {
        trialLines.push(`${t.starName}：第 ${t.unlockAct} 幕解锁`)
        continue
      }
      const gapNote = t.shipsForGap > 0 ? ` · 补缺口需 ${t.shipsForGap} 艘` : t.shipsForGap === 0 ? ' · 缺口已满足' : ''
      trialLines.push(`${t.starName}：${t.throughput}/s · 净 ${t.net}t · ${t.cycleS}s${gapNote}`)
    }
    this.binder.set(findText(this.actor, 'TrialText'), trialLines.join('\n'))

    const fleetLine = `船队 ${yd.fleetShips + yd.queueCount}/${yd.cap}`
    this.binder.set(findText(this.actor, 'StatusText'), fleetLine)

    // 造船队列：逐船一卡（队首建造中带倒计时，排队卡显示「排队中」）
    this.syncCards(yd.queue.length)
    for (let i = 0; i < this.cards.length; i++) {
      const q = yd.queue[i]
      const card = this.cards[i]
      if (!q) break
      const text = q.idx === 0
        ? `建造中 · ${Math.max(1, q.remainS)}s`
        : `排队中 · ${Math.max(1, q.remainS)}s`
      const last = this.cardTexts.get(card)
      if (last !== text) {
        this.cardTexts.set(card, text)
        const t = findText(card, 'CardText')
        if (t) t.text = text
      }
    }
  }

  /** 船型格池同步（ship_hull 表键序；点击 = mode.setShipyardHull，槽位校验在 GameMode） */
  private syncHullCells(yd: { hulls: Array<{ id: string; name: string; desc: string; cost: number }>; costMult: number }): void {
    const world = this.world
    const list = findChild(this.actor, 'HullList')
    const mode = wcMode()
    if (!world || !list || !mode) return
    this.hullIds = yd.hulls.map((h) => h.id)
    while (this.hullCells.length < yd.hulls.length) {
      const idx = this.hullCells.length
      const cell = world.ui.spawnUIActor(SHIP_HULL_CELL_WIDGET, list)
      if (!cell) { logger.warn('[ShipyardPanelScript] 船型格生成失败'); break }
      const btn = findButton(cell, 'Btn_cell')
      if (btn) btn.onClick = () => { mode.setShipyardHull(this.hullIds[idx] ?? 'standard') }
      this.hullCells.push(cell)
    }
    for (let i = 0; i < this.hullCells.length; i++) {
      const h = yd.hulls[i]
      // 池格只增不毁（销毁留幽灵）；表行不足时隐藏
      this.setCellVisible(this.hullCells[i], !!h)
      if (!h) continue
      this.setCellText(this.hullCells[i], 'CellName', h.name)
      this.setCellText(this.hullCells[i], 'CellDesc', h.desc)
      this.setCellText(this.hullCells[i], 'CellCost', `${Math.round(h.cost * yd.costMult)} H3`)
      // 选中态 = 引擎原生 checked（stateColors.checked 承载视觉，:checked 编译映射）
      this.setCellChecked(this.hullCells[i], mode.shipyardSelHull === h.id)
    }
  }

  /**
   * 装配台堆叠行池差分（2026-09-17 堆叠式装配台，与火箭设计工坊同源同构；
   * 箭体行/实例行 = ship_stack_row，加号行 = ship_stack_add；点击 = selectShipyardSlot）
   */
  private syncStackRows(yd: { stackRows: Array<{ rowId: string; kind: string; type: string; typeName: string; idx: number; moduleName: string; filled: boolean; sel: boolean; addable: boolean; removable: boolean; hint: string }> }): void {
    const world = this.world
    const list = findChild(this.actor, 'StackList')
    const mode = wcMode()
    if (!world || !list || !mode) return
    const moduleRows = yd.stackRows.filter((r) => r.kind !== 'add')
    const addRows = yd.stackRows.filter((r) => r.kind === 'add')
    // 实例行池（箭体行 + 部位实例行）
    this.stackRowDefs = moduleRows.map((r) => ({ type: r.type, idx: r.idx }))
    while (this.stackRowCells.length < moduleRows.length && this.stackRowCells.length < STACK_ROW_CAP) {
      const idx = this.stackRowCells.length
      const cell = world.ui.spawnUIActor(SHIP_STACK_ROW_WIDGET, list)
      if (!cell) { logger.warn('[ShipyardPanelScript] 堆叠行生成失败'); break }
      const btn = findButton(cell, 'Btn_stack_row')
      if (btn) {
        btn.onClick = () => {
          const def = this.stackRowDefs[idx]
          if (def && def.type) mode.selectShipyardSlot(def.type, def.idx)
        }
      }
      this.stackRowCells.push(cell)
    }
    for (let i = 0; i < this.stackRowCells.length; i++) {
      const cell = this.stackRowCells[i]
      const r = moduleRows[i]
      this.setCellVisible(cell, !!r)
      if (!r) continue
      this.setCellText(cell, 'RowType', r.typeName)
      this.setCellText(cell, 'RowModule', r.moduleName || r.hint)
      this.setCellText(cell, 'RowRemoveMark', r.removable ? '−' : '')
      this.setSelfChecked(cell, r.sel)
    }
    // 加号行池（每部位尾行；点击 = 定位下一空实例）
    this.stackAddDefs = addRows.map((r) => ({ type: r.type, idx: r.idx }))
    while (this.stackAddCells.length < addRows.length && this.stackAddCells.length < STACK_ROW_CAP) {
      const idx = this.stackAddCells.length
      const cell = world.ui.spawnUIActor(SHIP_STACK_ADD_WIDGET, list)
      if (!cell) { logger.warn('[ShipyardPanelScript] 加号行生成失败'); break }
      const btn = findButton(cell, 'Btn_stack_add')
      if (btn) {
        btn.onClick = () => mode.openShipyardAddMenu()
      }
      this.stackAddCells.push(cell)
    }
    for (let i = 0; i < this.stackAddCells.length; i++) {
      const cell = this.stackAddCells[i]
      const r = addRows[i]
      this.setCellVisible(cell, !!r)
      if (!r) continue
      this.setCellText(cell, 'RowAddMark', r.addable ? '+' : '')
      this.setCellText(cell, 'RowAddLabel', r.addable ? '添加模块' : `${r.typeName}已满`)
      const btn = findButton(cell, 'Btn_stack_add')
      if (btn) btn.state = r.addable ? 'normal' : 'disabled'
    }
  }

  /** 「+ 加号」部位选择小面板（AddMenu 显隐 + 三按钮可用态；open 权威 = GameMode.shipyardAddMenuOpen） */
  private syncAddMenu(menu: { open: boolean; parts: Array<{ type: string; name: string; empty: boolean }> }): void {
    this.vis.set(this.actor, 'AddMenu', menu.open)
    if (!menu.open) return
    for (const p of menu.parts) {
      const btn = findButton(this.actor, `Btn_add_${p.type}`)
      if (btn) btn.state = p.empty ? 'normal' : 'disabled'
      const label = findText(this.actor, `Label_add_${p.type}`)
      if (label) this.binder.set(label, p.empty ? p.name : `${p.name}（已满）`)
    }
  }

  /** 部位选件格池（上下文清单：selSlot 槽型过滤；勾选 = 已装本实例；点击 = pickShipyardSlotModule） */
  private syncSlotOptions(yd: {
    selSlot: { type: string; typeName: string; idx: number; used: number; cap: number } | null
    slotOptions: Array<{ id: string; name: string; desc: string; cost: number; allowed: boolean; here?: boolean }>
    costMult: number
  }): void {
    const world = this.world
    const list = findChild(this.actor, 'ModuleList')
    const mode = wcMode()
    if (!world || !list || !mode) return
    const sel = yd.selSlot
    // 荷载槽口径（2026-09-14）：清单只出玩家保存的荷载设计，空清单 = 引导去工坊合成
    const emptyPayload = !!sel && sel.type === 'payload' && yd.slotOptions.length === 0
    this.binder.set(findText(this.actor, 'ModuleTitle'), sel
      ? `② 本船插件 · ${sel.typeName}（${sel.used}/${sel.cap}）${emptyPayload ? ' · 尚无设计，去「荷载设计」合成一件' : ''}`
      : '② 本船插件（点部位选件 · 可不配）')
    this.optionIds = yd.slotOptions.map((o) => o.id)
    while (this.optionCells.length < yd.slotOptions.length) {
      const idx = this.optionCells.length
      const cell = world.ui.spawnUIActor(SHIP_MODULE_CELL_WIDGET, list)
      if (!cell) { logger.warn('[ShipyardPanelScript] 部件格生成失败'); break }
      const btn = findButton(cell, 'Btn_cell')
      if (btn) {
        btn.onClick = () => {
          const id = this.optionIds[idx]
          if (id && mode.shipyardSelSlot) mode.pickShipyardSlotModule(mode.shipyardSelSlot.type, mode.shipyardSelSlot.idx, id)
        }
      }
      this.optionCells.push(cell)
    }
    for (let i = 0; i < this.optionCells.length; i++) {
      const cell = this.optionCells[i]
      const o = yd.slotOptions[i]
      this.setCellVisible(cell, !!o)
      if (!o) continue
      this.setCellText(cell, 'CellName', o.name)
      this.setCellText(cell, 'CellDesc', o.here ? `${o.desc}（本部位已装）` : o.desc)
      this.setCellText(cell, 'CellCost', `${Math.round(o.cost * yd.costMult)} H3`)
      this.setCellChecked(cell, !!o.here)
      this.setCellEnabled(cell, o.allowed)
    }
  }

  /** 设计模板格池同步（shipDesigns 键序；点击 = 载入，记录 lastLoadedDesign 供删除按钮） */
  private syncDesignCells(yd: { designs: Array<{ idx: number; name: string; hullName: string; modules: string }>; costMult: number }): void {
    const world = this.world
    const list = findChild(this.actor, 'DesignList')
    const mode = wcMode()
    if (!world || !list || !mode) return
    this.designIdxs = yd.designs.map((d) => d.idx)
    while (this.designCells.length < yd.designs.length) {
      const idx = this.designCells.length
      const cell = world.ui.spawnUIActor(SHIP_HULL_CELL_WIDGET, list)
      if (!cell) { logger.warn('[ShipyardPanelScript] 模板格生成失败'); break }
      const btn = findButton(cell, 'Btn_cell')
      if (btn) {
        btn.onClick = () => {
          const di = this.designIdxs[idx]
          if (di != null && mode.loadShipDesign(di)) this.lastLoadedDesign = di
        }
      }
      this.designCells.push(cell)
    }
    for (let i = 0; i < this.designCells.length; i++) {
      const cell = this.designCells[i]
      const d = yd.designs[i]
      this.setCellVisible(cell, !!d)
      if (!d) continue
      this.setCellText(cell, 'CellName', d.name)
      this.setCellText(cell, 'CellDesc', `${d.hullName}${d.modules ? ` + ${d.modules}` : ''}`)
      this.setCellText(cell, 'CellCost', '载入')
      this.setCellChecked(cell, this.lastLoadedDesign === d.idx)
    }
  }

  private setCellText(cell: Actor, name: string, text: string): void {
    const t = findText(cell, name)
    if (t) this.binder.set(t, text)
  }

  /** 选中态差分（按 Actor 实例做键，同名子节点互不干扰；引擎原生 checked 态承载视觉） */
  private setCellChecked(cell: Actor, on: boolean): void {
    if (this.checkedMap.get(cell) === on) return
    this.checkedMap.set(cell, on)
    const btn = findButton(cell, 'Btn_cell')
    if (btn) btn.checked = on
  }

  /** 选中态写堆叠行按钮（按钮在子节点 Btn_stack_row 上；getComponent 只查自身不递归，必须 findButton） */
  private setSelfChecked(cell: Actor, on: boolean): void {
    if (this.checkedMap.get(cell) === on) return
    this.checkedMap.set(cell, on)
    const btn = findButton(cell, 'Btn_stack_row')
    if (btn) btn.checked = on
  }

  /** 可点态差分（满槽/不兼容置灰：按钮 state='disabled' 承载视觉） */
  private setCellEnabled(cell: Actor, on: boolean): void {
    if (this.enabledMap.get(cell) === on) return
    this.enabledMap.set(cell, on)
    const btn = findButton(cell, 'Btn_cell')
    if (btn) btn.state = on ? 'normal' : 'disabled'
  }

  /** 格子整体显隐差分（超编池格隐藏不销毁：UI Actor 销毁延迟提交/不彻底会留幽灵格参与渲染） */
  private setCellVisible(cell: Actor, on: boolean): void {
    if (this.visMap.get(cell) === on) return
    this.visMap.set(cell, on)
    // 统一走 bActive：与面板显隐机制一致（直接写 visible 会被 bActive 的
    // applyActiveTree 从父链重算时覆盖）
    cell.bActive = on
  }

  /** 卡片池同步：不足补生成（挂 ShipCardList，UILayout 自动横排），多余隐藏不销毁（销毁留幽灵格） */
  private syncCards(count: number): void {
    const world = this.world
    const list = this.findInChildren('ShipCardList')
    if (!world || !list) return
    const n = Math.min(count, MAX_CARDS)
    while (this.cards.length < n) {
      const card = world.ui.spawnUIActor(SHIP_BUILD_CARD_WIDGET, list)
      if (!card) {
        logger.warn(`[ShipyardPanelScript] 造船卡片生成失败（${SHIP_BUILD_CARD_WIDGET}）`)
        break
      }
      this.cards.push(card)
      this.cardTexts.set(card, '')
    }
    for (let i = 0; i < this.cards.length; i++) {
      this.setCellVisible(this.cards[i], i < n)
    }
  }

  override onDestroy(): void {
    this.cards.length = 0
    this.cardTexts.clear()
    this.hullCells.length = 0
    this.optionCells.length = 0
    this.designCells.length = 0
    this.hullIds.length = 0
    this.optionIds.length = 0
    this.designIdxs.length = 0
    this.stackRowCells.length = 0
    this.stackAddCells.length = 0
    this.stackRowDefs.length = 0
    this.stackAddDefs.length = 0
    this.checkedMap.clear()
    this.enabledMap.clear()
    this.visMap.clear()
  }
}
