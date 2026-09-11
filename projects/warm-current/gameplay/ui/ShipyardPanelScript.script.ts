/**
 * ShipyardPanelScript — 船坞造船面板 widget 行为脚本（shipyard_panel.widget.json 根节点）
 *
 * 职责（数据由 GameMode.shipyardSel 驱动，本脚本只做差分呈现）：
 *  - 星图点船坞 → GameMode.openShipyardPanel(dockId) → vm.shipyard 非空 → 面板展开
 *  - 面板内 ✕ / 点空地 → GameMode.closeShipyardPanel() → vm.shipyard 为 null → 收起
 *  - 造船三步流（2026-09-11 船型模块改版，玩家设计权扩展）：
 *      ① 选船型（HullList 动态生成 ship_hull_cell，ship_hull 表驱动）
 *      ② 选配模块（ModuleList 动态生成 ship_module_cell，ship_module 表驱动；
 *         不兼容当前船型的模块置灰——ship_hull.allowed 清单）
 *      ③ 总价（船体 + Σ模块 × 船坞折扣）入队（transport.tryBuildShip(hull, modules, dockId)）
 *  - 造船队列逐船一卡：容器 ShipCardList 挂 UILayout（vertical），卡片池随队列长度增删
 *  - 8Hz 差分同步；在建船坞只显示建造进度，无造船按钮
 */
import { BehaviourScript, UIImageComponent, logger } from '@/engine'
import type { Actor } from '@/engine'
import { hullAllowsModule, shipBuildPrice, shipHullDefOf, shipModuleDefOf } from '../core/helpers'
import { TextBinder, VisBinder, findButton, findChild, findText, wcMode } from './uiCommon'

/** 船坞造船面板 widget 资产路径（HudScript 生成入口） */
export const SHIPYARD_PANEL_WIDGET = 'asset/blueprints/ui/shipyard_panel.widget.json'
/** 造船队列卡片 / 船型格 / 模块格子 widget 资产路径（动态生成） */
export const SHIP_BUILD_CARD_WIDGET = 'asset/blueprints/ui/ship_build_card.widget.json'
export const SHIP_HULL_CELL_WIDGET = 'asset/blueprints/ui/ship_hull_cell.widget.json'
export const SHIP_MODULE_CELL_WIDGET = 'asset/blueprints/ui/ship_module_cell.widget.json'

/** 卡片池容量上限（与飞船上限同量级取整；超出提示走 HUD 口径，不无限生成） */
const MAX_CARDS = 12

/** 船型/模块格选中标记色（底色差分：选中 = 亮金 / 未选 = 常态） */
const CELL_SELECTED = '#3a5a2a'
const CELL_NORMAL_HULL = '#1d3a52'
const CELL_NORMAL_MODULE = '#16323f'
const CELL_DISABLED = '#20303a'

export default class ShipyardPanelScript extends BehaviourScript {
  private binder = new TextBinder()
  private vis = new VisBinder()
  private colors = new Map<Actor, string>()
  private acc = 1
  /** 卡片 Actor 池（与队列前 N 项一一对应，随队列长度增删） */
  private cards: Actor[] = []
  /** 各卡片文本差分缓存（Actor → 上次文案） */
  private cardTexts = new Map<Actor, string>()
  /** 船型/模块格 Actor 池（表键序） */
  private hullCells: Actor[] = []
  private moduleCells: Actor[] = []
  /** 三步流选择状态（本地面板态；入队时随 tryBuildShip 提交） */
  private selHull = 'standard'
  private selModules: string[] = []

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
    // 「造船」按钮：按当前船型+模块整单入队（cap 校验/计费在 TransportComponent，失败 hint）
    bind('Btn_yd_build', () => {
      const mode = wcMode()
      if (mode?.shipyardSel != null) mode.transport.tryBuildShip(this.selHull, this.selModules, mode.shipyardSel)
    })
    // 默认收起（脚本置位，先于首帧渲染；禁 active=false 种子——显隐一律走脚本）
    this.vis.set(this.actor, 'ShipyardBody', false)
    logger.info('[ShipyardPanelScript] 船坞造船面板就绪（三步流，默认收起）')
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

    // ─── 三步流：船型格 / 模块格 / 总价 ───
    this.syncHullCells(yd)
    this.syncModuleCells(yd)
    // 兼容性收敛：切船型后保留的模块若不兼容则剔除（就地修正，UI 提示随格置灰）
    this.selModules = this.selModules.filter((id) => hullAllowsModule(this.selHull, id))
    const price = Math.round(shipBuildPrice(this.selHull, this.selModules) * yd.costMult)
    const hullName = shipHullDefOf(this.selHull)?.name ?? this.selHull
    const modNames = this.selModules.map((id) => shipModuleDefOf(id)?.name ?? id).join('+')
    this.binder.set(findText(this.actor, 'OrderText'),
      `已选：${hullName}${modNames ? ` + ${modNames}` : '（裸船）'} · 整单 ${price} H3${yd.canQueue ? '' : ' · 上限已满'}`)
    this.vis.set(this.actor, 'Btn_yd_build', yd.canQueue)
    this.binder.set(findText(this.actor, 'BtnLabel'), `下水 · ${price} H3`)

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

  /** 船型格池同步（ship_hull 表键序；点击 = 选中船型，不兼容模块自动剔除） */
  private syncHullCells(yd: { hulls: Array<{ id: string; name: string; desc: string; cost: number }>; costMult: number }): void {
    const world = this.world
    const list = findChild(this.actor, 'HullList')
    if (!world || !list) return
    while (this.hullCells.length < yd.hulls.length) {
      const idx = this.hullCells.length
      const cell = world.ui.spawnUIActor(SHIP_HULL_CELL_WIDGET, list)
      if (!cell) { logger.warn('[ShipyardPanelScript] 船型格生成失败'); break }
      const btn = findButton(cell, 'Btn_cell')
      if (btn) btn.onClick = () => { this.selHull = yd.hulls[idx]?.id ?? 'standard' }
      this.hullCells.push(cell)
    }
    while (this.hullCells.length > yd.hulls.length) {
      const cell = this.hullCells.pop()
      if (cell) world.actorMgr.DestroyActor(cell)
    }
    for (let i = 0; i < this.hullCells.length; i++) {
      const h = yd.hulls[i]
      if (!h) break
      this.setCellText(this.hullCells[i], 'CellName', h.name)
      this.setCellText(this.hullCells[i], 'CellDesc', h.desc)
      this.setCellText(this.hullCells[i], 'CellCost', `${Math.round(h.cost * yd.costMult)} H3`)
      this.setCellColor(this.hullCells[i], this.selHull === h.id ? CELL_SELECTED : CELL_NORMAL_HULL)
    }
  }

  /** 模块格池同步（ship_module 表键序；不兼容当前船型置灰，点击 = 勾选/取消，单船一件） */
  private syncModuleCells(yd: { modules: Array<{ id: string; name: string; desc: string; cost: number }>; costMult: number }): void {
    const world = this.world
    const list = findChild(this.actor, 'ModuleList')
    if (!world || !list) return
    while (this.moduleCells.length < yd.modules.length) {
      const idx = this.moduleCells.length
      const cell = world.ui.spawnUIActor(SHIP_MODULE_CELL_WIDGET, list)
      if (!cell) { logger.warn('[ShipyardPanelScript] 模块格生成失败'); break }
      const btn = findButton(cell, 'Btn_cell')
      if (btn) {
        btn.onClick = () => {
          const id = yd.modules[idx]?.id
          if (!id || !hullAllowsModule(this.selHull, id)) return
          const at = this.selModules.indexOf(id)
          if (at >= 0) this.selModules.splice(at, 1)
          else this.selModules.push(id)
        }
      }
      this.moduleCells.push(cell)
    }
    while (this.moduleCells.length > yd.modules.length) {
      const cell = this.moduleCells.pop()
      if (cell) world.actorMgr.DestroyActor(cell)
    }
    for (let i = 0; i < this.moduleCells.length; i++) {
      const m = yd.modules[i]
      if (!m) break
      const allowed = hullAllowsModule(this.selHull, m.id)
      this.setCellText(this.moduleCells[i], 'CellName', m.name)
      this.setCellText(this.moduleCells[i], 'CellDesc', m.desc)
      this.setCellText(this.moduleCells[i], 'CellCost', `${Math.round(m.cost * yd.costMult)}`)
      const picked = this.selModules.includes(m.id)
      this.setCellColor(this.moduleCells[i], !allowed ? CELL_DISABLED : picked ? CELL_SELECTED : CELL_NORMAL_MODULE)
      const name = findText(this.moduleCells[i], 'CellName')
      if (name) this.binder.set(name, `${picked ? '✔ ' : ''}${m.name}`)
    }
  }

  private setCellText(cell: Actor, name: string, text: string): void {
    const t = findText(cell, name)
    if (t) this.binder.set(t, text)
  }

  /** 格子底色差分（选中/禁用态视觉；按钮自身 Image 承载） */
  private setCellColor(cell: Actor, color: string): void {
    if (this.colors.get(cell) === color) return
    this.colors.set(cell, color)
    const img = findChild(cell, 'Btn_cell')?.getComponent(UIImageComponent)
    if (img) img.color = color
  }

  /** 卡片池同步：不足补生成（挂 ShipCardList，UILayout 自动纵排），多余销毁 */
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
    while (this.cards.length > n) {
      const card = this.cards.pop()
      if (!card) break
      this.cardTexts.delete(card)
      world.actorMgr.DestroyActor(card)
    }
  }

  override onDestroy(): void {
    this.cards.length = 0
    this.cardTexts.clear()
    this.hullCells.length = 0
    this.moduleCells.length = 0
    this.colors.clear()
  }
}
