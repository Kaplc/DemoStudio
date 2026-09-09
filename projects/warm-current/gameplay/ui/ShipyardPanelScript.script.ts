/**
 * ShipyardPanelScript — 船坞造船面板 widget 行为脚本（shipyard_panel.widget.json 根节点）
 *
 * 职责（数据由 GameMode.shipyardSel 驱动，本脚本只做差分呈现）：
 *  - 星图点船坞 → GameMode.openShipyardPanel(dockId) → vm.shipyard 非空 → 面板展开
 *  - 面板内 ✕ / 点空地 → GameMode.closeShipyardPanel() → vm.shipyard 为 null → 收起
 *  - 「造船 N H3」按钮 → transport.tryBuildShip(dockId)：多次点击逐艘入队
 *  - 造船队列逐船一卡（2026-09-09 用户需求）：容器 ShipCardList 挂 UILayout（vertical），
 *    每艘在造船 spawn 一张 ship_build_card 卡片 Widget，多次造船可见卡片依次排队；
 *    卡片池随队列长度增删（文本差分刷新），船坞销毁/读档后重建
 *  - 8Hz 差分同步；在建船坞只显示建造进度，无造船按钮
 */
import { BehaviourScript, logger } from '@/engine'
import type { Actor } from '@/engine'
import { TextBinder, VisBinder, findButton, findText, wcMode } from './uiCommon'

/** 船坞造船面板 widget 资产路径（HudScript 生成入口） */
export const SHIPYARD_PANEL_WIDGET = 'asset/blueprints/ui/shipyard_panel.widget.json'
/** 造船队列卡片 widget 资产路径（逐船一卡，动态生成到 ShipCardList） */
export const SHIP_BUILD_CARD_WIDGET = 'asset/blueprints/ui/ship_build_card.widget.json'

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
    // 「造船」按钮：多次点击逐艘入队（cap 校验/计费在 TransportComponent，失败 hint）
    bind('Btn_yd_build', () => {
      const mode = wcMode()
      if (mode?.shipyardSel != null) mode.transport.tryBuildShip(mode.shipyardSel)
    })
    // 默认收起（脚本置位，先于首帧渲染；禁 active=false 种子——显隐一律走脚本）
    this.vis.set(this.actor, 'ShipyardBody', false)
    logger.info('[ShipyardPanelScript] 船坞造船面板就绪（默认收起）')
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
    } else {
      const fleetLine = `船队 ${yd.fleetShips + yd.queueCount}/${yd.cap}`
      this.binder.set(findText(this.actor, 'StatusText'),
        `${fleetLine} · 造船 ${yd.shipCost} H3${yd.canQueue ? '' : ' · 上限已满'}`)
      this.vis.set(this.actor, 'Btn_yd_build', yd.canQueue)
      this.binder.set(findText(this.actor, 'BtnLabel'), `造船 ${yd.shipCost}`)
    }

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
  }
}
