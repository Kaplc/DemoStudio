/**
 * ShipDesignScript — 火箭设计工坊 widget 行为脚本（ship_design.widget.json 根节点）
 *
 * 职责（数据由 GameMode.designOpen 驱动，本脚本只做差分呈现）：
 *  - 底部 HUD「火箭设计」→ GameMode.openShipDesign() → vm.shipDesign 非空 → 面板展开
 *  - 《火箭工坊》部位选件制三步流（2026-09-13）：
 *      ① 左 船型清单（HullList，点击 → mode.setShipyardHull）+ 设计模板
 *      ② 左下 部件选择（上下文清单：装配台点部位 → vm.slotOptions 出该槽型多档部件，
 *         点击 → mode.pickShipyardSlotModule 换装/卸下；未选部位 = 引导文案）
 *      ③ 中 装配台（6 静态槽位格按钮池：槽型名 + 已装模块名，点击 → mode.selectShipyardSlot，
 *         选中描边高亮、填充态模块名换绿）
 *      ④ 右 性能卡（试航三星 + 线路反推 / 一键推荐 / 订单与下水按钮池）
 *  - 选择态权威在 GameMode（shipyardSelHull/shipyardSelModules/shipyardSelSlot，与船坞面板共享船型与模块选择）
 *  - 下水：每建成船坞一枚按钮（orderFromDesign(dockId)，校验/计费在 TransportComponent）；
 *    无坞 → 空态文案引导近地轨道建设
 *  - 设计模板：存为模板 / 点击载入 / 删除所选（GameMode.saveShipDesign 等，随存档走）
 *  - 8Hz 差分同步
 */
import { BehaviourScript, UIButtonComponent, logger } from '@/engine'
import type { Actor } from '@/engine'
import { shipHullDefOf, shipModuleDefOf } from '../core/helpers'
import type { HudShipDesign } from '../base/WarmCurrentGameMode'
import { ColorBinder, TextBinder, VisBinder, findButton, findChild, findText, wcMode } from './uiCommon'
import { SHIP_HULL_CELL_WIDGET, SHIP_MODULE_CELL_WIDGET } from './ShipyardPanelScript.script'

/** 火箭设计面板 widget 资产路径（HudScript 生成入口） */
export const SHIP_DESIGN_WIDGET = 'asset/blueprints/ui/ship_design.widget.json'

/** 静态槽位格池容量（船型最大槽位数 = hauler 4；6 取整防扩展溢出） */
const SLOT_CELLS = 6
/** 下水按钮池容量（同型船坞上限 orbit_build.maxPerType = 3） */
const DOCK_BTNS = 3

export default class ShipDesignScript extends BehaviourScript {
  private binder = new TextBinder()
  private colors = new ColorBinder()
  private vis = new VisBinder()
  private acc = 1
  /** 船型/部位选件/模板格 Actor 池（表键序，只增不毁） */
  private hullCells: Actor[] = []
  private optionCells: Actor[] = []
  private designCells: Actor[] = []
  /** 格子 → 条目映射（点击闭包只持 idx，杜绝捕获陈旧 viewmodel） */
  private hullIds: string[] = []
  private optionIds: string[] = []
  private designIdxs: number[] = []
  /** 槽位格 → (槽型, 实例序)（点击 selectShipyardSlot 用；随 VM 刷新） */
  private slotCellDefs: Array<{ type: string; idx: number } | null> = new Array(SLOT_CELLS).fill(null)
  /** 选中态/可点态/显隐差分（按 Actor 实例做键） */
  private checkedMap = new Map<Actor, boolean>()
  private enabledMap = new Map<Actor, boolean>()
  private visMap = new Map<Actor, boolean>()
  /** 槽位格填充态差分（Actor 实例 → 上次 filled） */
  private slotFilledMap = new Map<Actor, boolean>()
  /** 槽位格选中态差分（Actor 实例 → 上次 filled+sel 组合键） */
  private slotSelMap = new Map<Actor, string>()
  /** 最近载入的模板下标（删除按钮目标；null = 删最后一个） */
  private lastLoadedDesign: number | null = null

  /** 面板当前是否展开（HudScript 居中互斥读取；唯一权威 = GameMode.designOpen） */
  get isOpen(): boolean {
    return wcMode()?.designOpen === true
  }

  override onStart(): void {
    const bind = (name: string, fn: () => void): void => {
      const btn = findButton(this.actor, name)
      if (btn) btn.onClick = fn
    }
    bind('Btn_dsn_close', () => wcMode()?.closeShipDesign())
    // 荷载设计工坊入口（2026-09-13 火箭三部位改版：荷载单独设计，与本面板互斥开合）
    bind('Btn_dsn_payload', () => wcMode()?.openPayloadDesign())
    bind('Btn_dsn_recommend', () => wcMode()?.applyShipyardRecommend())
    bind('Btn_dsn_save', () => wcMode()?.saveShipDesign())
    bind('Btn_dsn_ddel', () => {
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
    // 装配台槽位格按钮池（点击 = 选中部位 → ② 区出该槽型部件清单）
    for (let i = 0; i < SLOT_CELLS; i++) {
      bind(`SlotCell_${i}`, () => {
        const def = this.slotCellDefs[i]
        if (def) wcMode()?.selectShipyardSlot(def.type, def.idx)
      })
    }
    // 下水按钮池（每 dock 一枚；rowDockIds 由 onUpdate 刷新）
    this.rowDockIds = new Array(DOCK_BTNS).fill(-1)
    for (let i = 0; i < DOCK_BTNS; i++) {
      bind(`DockOrderBtn_${i}`, () => {
        const id = this.rowDockIds[i]
        if (id >= 0) wcMode()?.orderFromDesign(id)
      })
    }
    // 默认收起（脚本置位，先于首帧渲染）
    this.vis.set(this.actor, 'DesignBody', false)
    logger.info('[ShipDesignScript] 火箭设计工坊就绪（部位选件制三步流，默认收起）')
  }

  /** 下水按钮池当前绑定的船坞 id（-1 = 空槽） */
  private rowDockIds: number[] = []

  override onUpdate(dt: number): void {
    const mode = wcMode()
    if (!mode) return
    this.acc += dt
    if (this.acc < 0.12) return
    this.acc = 0
    const vm = mode.buildViewModel().shipDesign
    this.vis.set(this.actor, 'DesignBody', !!vm)
    if (!vm) return

    this.binder.set(findText(this.actor, 'TitleText'), '🚀 火箭设计工坊')
    this.binder.set(findText(this.actor, 'StatusText'),
      `船队 ${vm.fleetShips + vm.queueCount}/${vm.cap} · ${vm.docks.length ? `${vm.docks.length} 座船坞可下水` : '未建船坞（仅设计）'}`)

    // ─── 左：① 船型 + ② 部位选件清单 ───
    this.syncHullCells(vm)
    this.syncSlotOptions(vm)

    // ─── 中：装配台 ───
    const hullDef = shipHullDefOf(mode.shipyardSelHull)
    this.binder.set(findText(this.actor, 'ShipNameText'), hullDef?.name ?? mode.shipyardSelHull)
    this.syncSlotCells(vm)
    const slotLine = vm.slotRows.map((r) => `${r.name} ${r.used}/${r.cap}`).join(' · ')
    this.binder.set(findText(this.actor, 'SlotRowText'), slotLine ? `槽位占用：${slotLine}` : '槽位：无（仅兼容约束）')
    this.syncDesignCells(vm)

    // ─── 右：性能卡 ───
    const trialLines: string[] = []
    for (const t of vm.trials) {
      if (!t.unlocked) {
        trialLines.push(`${t.starName}：第 ${t.unlockAct} 幕解锁`)
        continue
      }
      const gapNote = t.shipsForGap > 0 ? ` · 补缺口需 ${t.shipsForGap} 艘` : t.shipsForGap === 0 ? ' · 缺口已满足' : ''
      trialLines.push(`${t.starName}：吞吐 ${t.throughput}/s · 单趟净 ${t.net}t（载 ${t.load} − 油 ${t.fuel}）· 往返 ${t.cycleS}s${gapNote}`)
    }
    this.binder.set(findText(this.actor, 'TrialText'), trialLines.join('\n'))
    const modNames = mode.shipyardSelModules.map((id) => shipModuleDefOf(id)?.name ?? id)
    const orderLines = [
      `方案：${hullDef?.name ?? mode.shipyardSelHull}${modNames.length ? ` + ${modNames.join('、')}` : '（裸船）'}`,
      `整单：${vm.price} H3${vm.docks[0] && vm.docks[0].costMult !== 1 ? `（船坞价 ×${vm.docks[0].costMult.toFixed(2)}）` : ''}`,
    ]
    this.binder.set(findText(this.actor, 'OrderText'), orderLines.join('\n'))
    this.syncDockButtons(vm)
  }

  /** 船型格池（点击 = mode.setShipyardHull） */
  private syncHullCells(vm: HudShipDesign): void {
    const world = this.world
    const list = findChild(this.actor, 'HullList')
    const mode = wcMode()
    if (!world || !list || !mode) return
    this.hullIds = vm.hulls.map((h) => h.id)
    while (this.hullCells.length < vm.hulls.length) {
      const idx = this.hullCells.length
      const cell = world.ui.spawnUIActor(SHIP_HULL_CELL_WIDGET, list)
      if (!cell) { logger.warn('[ShipDesignScript] 船型格生成失败'); break }
      const btn = findButton(cell, 'Btn_cell')
      if (btn) btn.onClick = () => { mode.setShipyardHull(this.hullIds[idx] ?? 'standard') }
      this.hullCells.push(cell)
    }
    for (let i = 0; i < this.hullCells.length; i++) {
      const h = vm.hulls[i]
      this.setCellVisible(this.hullCells[i], !!h)
      if (!h) continue
      this.setCellText(this.hullCells[i], 'CellName', h.name)
      this.setCellText(this.hullCells[i], 'CellDesc', h.desc)
      this.setCellText(this.hullCells[i], 'CellCost', `${h.cost} H3`)
      this.setCellChecked(this.hullCells[i], mode.shipyardSelHull === h.id)
    }
  }

  /** 部位选件格池（上下文清单：selSlot 槽型过滤；勾选 = 已装本实例；点击 = pickShipyardSlotModule） */
  private syncSlotOptions(vm: HudShipDesign): void {
    const world = this.world
    const list = findChild(this.actor, 'ModuleList')
    const mode = wcMode()
    if (!world || !list || !mode) return
    const sel = vm.selSlot
    this.binder.set(findText(this.actor, 'ModuleTitle'), sel
      ? `② 部件选择 · ${sel.typeName}（${sel.used}/${sel.cap}）`
      : '② 部件选择（点击装配台部位）')
    this.optionIds = vm.slotOptions.map((o) => o.id)
    while (this.optionCells.length < vm.slotOptions.length) {
      const idx = this.optionCells.length
      const cell = world.ui.spawnUIActor(SHIP_MODULE_CELL_WIDGET, list)
      if (!cell) { logger.warn('[ShipDesignScript] 部件格生成失败'); break }
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
      const o = vm.slotOptions[i]
      this.setCellVisible(cell, !!o)
      if (!o) continue
      this.setCellText(cell, 'CellName', o.name)
      this.setCellText(cell, 'CellDesc', o.here ? `${o.desc}（本部位已装）` : o.desc)
      this.setCellText(cell, 'CellCost', `${o.cost} H3`)
      this.setCellChecked(cell, !!o.here)
      this.setCellEnabled(cell, o.allowed)
    }
  }

  /** 装配台静态槽位格差分（6 格按钮池：槽型名 + 已装模块名；选中描边、填充态模块名换绿） */
  private syncSlotCells(vm: HudShipDesign): void {
    for (let i = 0; i < SLOT_CELLS; i++) {
      const cell = findChild(this.actor, `SlotCell_${i}`)
      if (!cell) continue
      const data = vm.slotCells[i]
      // VisBinder.set 的查找起点必须是面板根（传 cell 自身会在其子树里找同名节点 → 永远找不到 → 空池格永不隐藏）
      this.vis.set(this.actor, `SlotCell_${i}`, !!data)
      this.slotCellDefs[i] = data ? { type: data.type, idx: data.slotIdx } : null
      if (!data) continue
      this.binder.set(findText(cell, `SlotTypeName_${i}`), data.typeName)
      this.binder.set(findText(cell, `SlotModuleName_${i}`), data.module || '（空）')
      const filled = data.filled
      if (this.slotFilledMap.get(cell) !== filled) {
        this.slotFilledMap.set(cell, filled)
        // 填充态反馈 = 模块名换绿（格底色编译期固化，运行时改文字色是安全口径）
        this.colors.set(findText(cell, `SlotModuleName_${i}`), filled ? '#7fe8a8' : '#6f9ab0')
      }
      // 选中部位反馈：:checked 底色（编译期）+ 槽型名提亮（运行时文字色差分）
      const selKey = `${filled ? 1 : 0}${data.sel ? 1 : 0}`
      if (this.slotSelMap.get(cell) !== selKey) {
        this.slotSelMap.set(cell, selKey)
        this.colors.set(findText(cell, `SlotTypeName_${i}`), data.sel ? '#4fd8ff' : '#6f9ab0')
      }
      this.setSelfChecked(cell, data.sel)
    }
  }

  /** 设计模板格池（点击 = 载入） */
  private syncDesignCells(vm: HudShipDesign): void {
    const world = this.world
    const list = findChild(this.actor, 'DesignList')
    const mode = wcMode()
    if (!world || !list || !mode) return
    this.designIdxs = vm.designs.map((d) => d.idx)
    while (this.designCells.length < vm.designs.length) {
      const idx = this.designCells.length
      const cell = world.ui.spawnUIActor(SHIP_HULL_CELL_WIDGET, list)
      if (!cell) { logger.warn('[ShipDesignScript] 模板格生成失败'); break }
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
      const d = vm.designs[i]
      this.setCellVisible(cell, !!d)
      if (!d) continue
      this.setCellText(cell, 'CellName', d.name)
      this.setCellText(cell, 'CellDesc', `${d.hullName}${d.modules ? ` + ${d.modules}` : ''}`)
      this.setCellText(cell, 'CellCost', '载入')
      this.setCellChecked(cell, this.lastLoadedDesign === d.idx)
    }
  }

  /** 下水按钮池差分（每建成船坞一枚；无坞显示空态引导） */
  private syncDockButtons(vm: HudShipDesign): void {
    for (let i = 0; i < DOCK_BTNS; i++) {
      const dock = vm.docks[i]
      this.vis.set(this.actor, `DockOrderBtn_${i}`, !!dock)
      this.rowDockIds[i] = dock?.id ?? -1
      if (!dock) continue
      const label = findText(this.actor, `DockOrderLabel_${i}`)
      this.binder.set(label, dock.canOrder ? `下水 → ${dock.name}·${dock.anchorName}` : `${dock.name} · 上限满`)
      const btn = findButton(this.actor, `DockOrderBtn_${i}`)
      if (btn) btn.state = dock.canOrder ? 'normal' : 'disabled'
    }
    this.vis.set(this.actor, 'DockEmptyText', vm.docks.length === 0)
    if (vm.docks.length === 0) {
      this.binder.set(findText(this.actor, 'DockEmptyText'),
        '尚无船坞可下水 · 点星球 →「近地轨道建设」造一座船坞')
    }
  }

  private setCellText(cell: Actor, name: string, text: string): void {
    const t = findText(cell, name)
    if (t) this.binder.set(t, text)
  }

  private setCellChecked(cell: Actor, on: boolean): void {
    if (this.checkedMap.get(cell) === on) return
    this.checkedMap.set(cell, on)
    const btn = findButton(cell, 'Btn_cell')
    if (btn) btn.checked = on
  }

  /** 选中态写格子自身按钮（SlotCell 按钮即格根，无内层 Btn_cell） */
  private setSelfChecked(cell: Actor, on: boolean): void {
    if (this.checkedMap.get(cell) === on) return
    this.checkedMap.set(cell, on)
    const btn = cell.getComponent(UIButtonComponent)
    if (btn) btn.checked = on
  }

  private setCellEnabled(cell: Actor, on: boolean): void {
    if (this.enabledMap.get(cell) === on) return
    this.enabledMap.set(cell, on)
    const btn = findButton(cell, 'Btn_cell')
    if (btn) btn.state = on ? 'normal' : 'disabled'
  }

  private setCellVisible(cell: Actor, on: boolean): void {
    if (this.visMap.get(cell) === on) return
    this.visMap.set(cell, on)
    cell.root.visible = on
  }

  override onDestroy(): void {
    this.hullCells.length = 0
    this.optionCells.length = 0
    this.designCells.length = 0
    this.hullIds.length = 0
    this.optionIds.length = 0
    this.designIdxs.length = 0
    this.slotCellDefs.length = 0
    this.checkedMap.clear()
    this.enabledMap.clear()
    this.visMap.clear()
    this.slotFilledMap.clear()
    this.slotSelMap.clear()
  }
}
