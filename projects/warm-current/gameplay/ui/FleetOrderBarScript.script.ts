/**
 * FleetOrderBarScript — 耀斑决策条行为脚本（fleet_order_bar.widget.json 根节点）
 *
 * 职责（玩家设计权扩展：耀斑预警期框选飞船直接指挥）：
 *  - 预警期（需事件预警卡）+ 框选船非空 → 决策条上屏；其余收起
 *  - 照跑 / 就近靠站 / 原地待命（在途船置灰）→ GameMode.orderSelectedShips(order)
 *  - 爆发 = 通讯中断决策锁定（条收起，orderWindowOpen=false）；耀斑结束决策清空
 *  - 8Hz 差分同步
 */
import { BehaviourScript, logger } from '@/engine'
import { TextBinder, VisBinder, findButton, findText, wcMode } from './uiCommon'

/** 决策条 widget 资产路径（HudScript 生成入口） */
export const FLEET_ORDER_BAR_WIDGET = 'asset/blueprints/ui/fleet_order_bar.widget.json'

export default class FleetOrderBarScript extends BehaviourScript {
  private binder = new TextBinder()
  private vis = new VisBinder()
  private acc = 1

  override onStart(): void {
    const bind = (name: string, fn: () => void): void => {
      const btn = findButton(this.actor, name)
      if (btn) btn.onClick = fn
    }
    bind('Btn_order_run', () => wcMode()?.orderSelectedShips('run'))
    bind('Btn_order_shelter', () => wcMode()?.orderSelectedShips('shelter'))
    bind('Btn_order_hold', () => wcMode()?.orderSelectedShips('hold'))
    bind('Btn_order_clear', () => wcMode()?.clearShipSelection())
    this.vis.set(this.actor, 'Bar', false)
    logger.info('[FleetOrderBarScript] 耀斑决策条就绪（默认收起）')
  }

  override onUpdate(dt: number): void {
    const mode = wcMode()
    if (!mode) return
    this.acc += dt
    if (this.acc < 0.12) return
    this.acc = 0
    const fo = mode.buildViewModel().fleetOrders
    const show = fo.windowOpen && fo.selectedCount > 0
    this.vis.set(this.actor, 'Bar', show)
    if (!show) return
    this.binder.set(findText(this.actor, 'SelText'), `已选 ${fo.selectedCount} 艘`)
    // 原地待命：仅未出发（装货中）的船可选，在途置灰
    this.vis.set(this.actor, 'Btn_order_hold', fo.canHold)
  }
}
