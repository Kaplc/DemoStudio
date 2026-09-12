/**
 * ShipyardPanelScript — 船坞造船面板 widget 行为脚本（shipyard_panel.widget.json 根节点）
 *
 * 职责（数据由 GameMode.shipyardSel 驱动，本脚本只做差分呈现）：
 *  - 星图点船坞 → GameMode.openShipyardPanel(dockId) → vm.shipyard 非空 → 面板展开
 *  - 面板内 ✕ / 点空地 → GameMode.closeShipyardPanel() → vm.shipyard 为 null → 收起
 *  - 造船三步流（2026-09-11 船型模块改版，玩家设计权扩展）：
 *      ① 选船型（HullList 动态生成 ship_hull_cell，ship_hull 表驱动）
 *      ② 选配插件（ModuleList 动态生成 ship_module_cell；只列当前船型 allowed 清单——
 *         每个船自己的插件，配置表驱动；切船型自动换列）
 *      ③ 总价（船体 + Σ插件 × 船坞折扣）入队（transport.tryBuildShip(hull, modules, dockId)）
 *  - 造船队列逐船一卡：容器 ShipCardList 挂 UILayout（vertical），卡片池随队列长度增删
 *  - 8Hz 差分同步；在建船坞只显示建造进度，无造船按钮
 */
import { BehaviourScript, logger } from '@/engine'
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

export default class ShipyardPanelScript extends BehaviourScript {
  private binder = new TextBinder()
  private vis = new VisBinder()
  private acc = 1
  /** 卡片 Actor 池（与队列前 N 项一一对应，随队列长度增删） */
  private cards: Actor[] = []
  /** 各卡片文本差分缓存（Actor → 上次文案） */
  private cardTexts = new Map<Actor, string>()
  /** 船型/模块格 Actor 池（表键序） */
  private hullCells: Actor[] = []
  private moduleCells: Actor[] = []
  /** 格子 → 条目 id 实时映射（每帧随内容刷新；点击闭包只持 idx，杜绝捕获陈旧 viewmodel） */
  private hullIds: string[] = []
  private moduleIds: string[] = []
  /** 选中态差分（按 Actor 实例做键；写原生 btn.checked，stateColors.checked 承载视觉） */
  private checkedMap = new Map<Actor, boolean>()
  /** 格子整体显隐差分（按 Actor 实例做键） */
  private visMap = new Map<Actor, boolean>()
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
    // 兼容性收敛：切船型后保留的模块若不兼容则剔除（就地修正；面板只列本船型 allowed 清单）
    this.selModules = this.selModules.filter((id) => hullAllowsModule(this.selHull, id))
    const price = Math.round(shipBuildPrice(this.selHull, this.selModules) * yd.costMult)
    const hullDef = shipHullDefOf(this.selHull)
    const hullPrice = Math.round((hullDef?.cost ?? 0) * yd.costMult)
    const hullName = hullDef?.name ?? this.selHull
    const modNames = this.selModules.map((id) => shipModuleDefOf(id)?.name ?? id)
    const modPrice = this.selModules.reduce((sum, id) => sum + (shipModuleDefOf(id)?.cost ?? 0), 0)
    const orderLines = [
      `船体：${hullName} · ${hullPrice} H3`,
      `插件：${modNames.length ? modNames.join('、') : '未选配'}${modPrice ? ` · ${Math.round(modPrice * yd.costMult)} H3` : ''}`,
      `整单：${price} H3（船坞价 ×${yd.costMult.toFixed(2)}）`,
      yd.canQueue ? '船坞空闲，可下水' : '⚠ 船队上限已满',
    ]
    this.binder.set(findText(this.actor, 'OrderText'), orderLines.join('\n'))
    this.vis.set(this.actor, 'Btn_yd_build', true)
    this.binder.set(findText(this.actor, 'BtnLabel'), yd.canQueue ? `下水 · ${price} H3` : `上限已满 · ${price} H3`)

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
    this.hullIds = yd.hulls.map((h) => h.id)
    while (this.hullCells.length < yd.hulls.length) {
      const idx = this.hullCells.length
      const cell = world.ui.spawnUIActor(SHIP_HULL_CELL_WIDGET, list)
      if (!cell) { logger.warn('[ShipyardPanelScript] 船型格生成失败'); break }
      const btn = findButton(cell, 'Btn_cell')
      if (btn) btn.onClick = () => { this.selHull = this.hullIds[idx] ?? 'standard' }
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
      this.setCellChecked(this.hullCells[i], this.selHull === h.id)
    }
  }

  /**
   * 模块格池同步（只列当前船型 allowed 清单——每个船自己的插件，配置表驱动；点击 = 勾选/取消，单船一件）。
   * 池按全表容量只增不毁：销毁是延迟提交，切船型高频增删会留下继续参与渲染的幽灵格，
   * 与新生代交替上屏（表现即面板闪烁）；超编格子一律隐藏。
   */
  private syncModuleCells(yd: { modules: Array<{ id: string; name: string; desc: string; cost: number }>; costMult: number }): void {
    const world = this.world
    const list = findChild(this.actor, 'ModuleList')
    if (!world || !list) return
    const avail = yd.modules.filter((m) => hullAllowsModule(this.selHull, m.id))
    this.moduleIds = avail.map((m) => m.id)
    while (this.moduleCells.length < yd.modules.length) {
      const idx = this.moduleCells.length
      const cell = world.ui.spawnUIActor(SHIP_MODULE_CELL_WIDGET, list)
      if (!cell) { logger.warn('[ShipyardPanelScript] 模块格生成失败'); break }
      const btn = findButton(cell, 'Btn_cell')
      if (btn) {
        btn.onClick = () => {
          const id = this.moduleIds[idx]
          if (!id) return
          const at = this.selModules.indexOf(id)
          if (at >= 0) this.selModules.splice(at, 1)
          else this.selModules.push(id)
        }
      }
      this.moduleCells.push(cell)
    }
    for (let i = 0; i < this.moduleCells.length; i++) {
      const cell = this.moduleCells[i]
      const m = avail[i]
      // 超编格隐藏（visible 差分见 setCellVisible；UILayout 检测激活态变化会自动重排）
      this.setCellVisible(cell, !!m)
      if (!m) continue
      this.setCellText(cell, 'CellName', m.name)
      this.setCellText(cell, 'CellDesc', m.desc)
      this.setCellText(cell, 'CellCost', `${Math.round(m.cost * yd.costMult)}`)
      // 选中态只由 checked 底色表达（不再叠 ✔ 前缀，避免勾选切换的文本重排）
      this.setCellChecked(cell, this.selModules.includes(m.id))
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

  /** 格子整体显隐差分（超编池格隐藏不销毁：UI Actor 销毁延迟提交/不彻底会留幽灵格参与渲染） */
  private setCellVisible(cell: Actor, on: boolean): void {
    if (this.visMap.get(cell) === on) return
    this.visMap.set(cell, on)
    cell.root.visible = on
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
    this.moduleCells.length = 0
    this.hullIds.length = 0
    this.moduleIds.length = 0
    this.checkedMap.clear()
    this.visMap.clear()
  }
}
