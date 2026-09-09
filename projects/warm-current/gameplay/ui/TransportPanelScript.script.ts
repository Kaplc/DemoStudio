/**
 * TransportPanelScript — 运输二级面板 widget 行为脚本（transport_panel.widget.json 根节点）
 *
 * 职责（入口按钮在主 HUD 底部 bar，本脚本只管面板本体）：
 *  - 面板内「✕ 关闭」收起（open/close 自驱动显隐，open 由 HudScript 底部入口调用）
 *  - 造船（tryBuildShip，造价标签配置表驱动）+ 船队明细（VM.shipRows 行池，冻毁可重建）
 *  - 8Hz 差分同步：船队摘要/储量/行池文案与重建按钮可用性
 */
import { BehaviourScript, logger } from '@/engine'
import { TextBinder, VisBinder, findButton, findText, wcMode } from './uiCommon'

/** 运输面板 widget 资产路径（HudScript 生成入口） */
export const TRANSPORT_PANEL_WIDGET = 'asset/blueprints/ui/transport_panel.widget.json'

/** 船行池容量（与 widget HTML 的 ShipText_0..9 / Btn_rebuild_0..9 对应） */
const SHIP_ROWS = 10

export default class TransportPanelScript extends BehaviourScript {
  private binder = new TextBinder()
  private vis = new VisBinder()
  private acc = 1
  /** 面板开合状态（默认收起，HudScript 底部入口读取 isOpen 决定 open/close） */
  private openState = false

  /** 面板当前是否展开（HudScript 底部入口按钮读取） */
  get isOpen(): boolean { return this.openState }

  override onStart(): void {
    const bind = (name: string, fn: () => void): void => {
      const btn = findButton(this.actor, name)
      if (btn) btn.onClick = fn
    }
    // 默认收起（脚本置位 + seed json 双保险）
    this.openState = false
    this.applyVisible()
    // 面板内 ✕ 关闭
    bind('Btn_panel_close', () => {
      this.openState = false
      this.applyVisible()
      logger.info('[TransportPanelScript] 运输面板收起（面板内关闭）')
    })
    // 造船（行为口径与 ResearchPanel 的 Btn_ship 一致）
    bind('Btn_ship', () => wcMode()?.transport.tryBuildShip())
    // 行池重建按钮：船 id 从最新 VM 行取（截断行池外的船不给重建入口）
    for (let i = 0; i < SHIP_ROWS; i++) {
      bind(`Btn_rebuild_${i}`, () => {
        const row = wcMode()?.buildViewModel().shipRows[i]
        if (row?.canRebuild) wcMode()?.transport.tryRebuildShip(row.id)
      })
    }
    this.syncNow()
    logger.info('[TransportPanelScript] 运输面板就绪（默认收起）')
  }

  /** 应用显隐：TransportBody 整树开关 */
  private applyVisible(): void {
    this.vis.set(this.actor, 'TransportBody', this.openState)
  }

  /** 打开面板（HudScript 底部入口调用） */
  open(): void {
    if (this.openState) return
    this.openState = true
    this.applyVisible()
    logger.info('[TransportPanelScript] 运输面板打开')
  }

  /** 关闭面板 */
  close(): void {
    if (!this.openState) return
    this.openState = false
    this.applyVisible()
    logger.info('[TransportPanelScript] 运输面板关闭')
  }

  override onUpdate(dt: number): void {
    this.acc += dt
    if (this.acc < 0.12) return
    this.acc = 0
    this.syncNow()
  }

  /** 船队摘要 + 行池文案 + 重建按钮差分同步 */
  private syncNow(): void {
    const mode = wcMode()
    if (!mode) return
    const vm = mode.buildViewModel()
    const playing = vm.outcome === 'playing' && !vm.pending
    this.binder.set(findText(this.actor, 'FleetText'),
      `船队 ${vm.fleet.total}/${vm.fleet.cap}（空闲 ${vm.fleet.idle} · 在途 ${vm.fleet.flying} · 冻毁 ${vm.fleet.frozen}）`
      + (vm.fleet.building > 0 ? ` · 建造中 ${vm.fleet.buildRemain}s` : '')
      + ` · 维护 ${vm.fleet.maintPerS}/s`)
    this.binder.set(findText(this.actor, 'ReserveText'), `储量 ${Math.round(vm.reserve)} t`)
    this.binder.set(findText(this.actor, 'Label_ship'), `造船 ${vm.shipBuildCost}`)
    this.vis.set(this.actor, 'Btn_ship', playing)
    for (let i = 0; i < SHIP_ROWS; i++) {
      const row = vm.shipRows[i]
      let text = ''
      if (row) {
        const load: string[] = []
        if (row.cargo > 0) load.push(`H3 ${row.cargo}`)
        if (row.materials > 0) load.push(`建材 ${row.materials}`)
        text = `${row.name} · ${row.place}` + (load.length > 0 ? ` · ${load.join(' · ')}` : '')
      }
      this.binder.set(findText(this.actor, `ShipText_${i}`), text)
      this.vis.set(this.actor, `Btn_rebuild_${i}`, playing && !!row?.canRebuild)
    }
    const overflow = vm.fleet.total - vm.shipRows.length
    this.binder.set(findText(this.actor, 'MoreText'), overflow > 0 ? `…另有 ${overflow} 艘未列出` : '')
  }
}
