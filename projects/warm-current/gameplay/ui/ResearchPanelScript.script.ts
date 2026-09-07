/**
 * ResearchPanelScript — 科研二级面板 widget 行为脚本（research_panel.widget.json 根节点）
 *
 * 职责（入口按钮在主 HUD 底部 bar，本脚本只管面板本体）：
 *  - 面板内「✕ 关闭」收起（open/close 自驱动显隐，open 由 HudScript 底部入口调用）
 *  - 二级按钮：超频×5 / 造船
 *  - 8Hz 差分同步：船队明细、五线进度与超频可用性、造船按钮态
 */
import { BehaviourScript, logger } from '@/engine'
import { TextBinder, VisBinder, findButton, findChild, findText, wcMode } from './uiCommon'
import { UITextComponent } from '@/engine'

/** 科研面板 widget 资产路径（HudScript 生成入口） */
export const RESEARCH_PANEL_WIDGET = 'asset/blueprints/ui/research_panel.widget.json'

const LINES = ['engine', 'cargo', 'ring', 'infra', 'expand'] as const

export default class ResearchPanelScript extends BehaviourScript {
  private binder = new TextBinder()
  private vis = new VisBinder()
  private acc = 1
  /** 面板开合状态（默认收起，HudScript 底部入口读取 isOpen 决定 open/close） */
  private openState = false

  /** 面板当前是否展开（HudScript 底部入口按钮读取） */
  get isOpen(): boolean { return this.openState }

  override onStart(): void {
    const mode = wcMode()
    if (!mode) {
      logger.warn('[ResearchPanelScript] GameMode 未就绪')
    }
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
      logger.info('[ResearchPanelScript] 科研面板收起（面板内关闭）')
    })
    // 二级业务按钮（行为口径与拆分前一致）
    bind('Btn_ship', () => wcMode()?.transport.tryBuildShip())
    for (const id of LINES) {
      bind(`Btn_oc_${id}`, () => wcMode()?.research.toggleOverclock(id))
    }
    logger.info('[ResearchPanelScript] 科研面板就绪（默认收起）')
  }

  /** 应用显隐：ResearchBody 整树开关 */
  private applyVisible(): void {
    this.vis.set(this.actor, 'ResearchBody', this.openState)
  }

  /** 打开面板（HudScript 底部入口调用） */
  open(): void {
    if (this.openState) return
    this.openState = true
    this.applyVisible()
    logger.info('[ResearchPanelScript] 科研面板打开')
  }

  /** 关闭面板 */
  close(): void {
    if (!this.openState) return
    this.openState = false
    this.applyVisible()
    logger.info('[ResearchPanelScript] 科研面板关闭')
  }

  override onUpdate(dt: number): void {
    const mode = wcMode()
    if (!mode) return
    this.acc += dt
    if (this.acc < 0.12) return
    this.acc = 0
    const vm = mode.buildViewModel()

    // 船队明细行（面板展开时可见）
    this.binder.set(findText(this.actor, 'FleetText'),
      `船队 ${vm.fleet.total}（空闲 ${vm.fleet.idle} · 在途 ${vm.fleet.flying} · 冻毁 ${vm.fleet.frozen}）`
      + (vm.fleet.building > 0 ? ` · 建造中 ${vm.fleet.buildRemain}s` : ''))
    // 五线进度 + 超频可用性（口径不变：运转中且无选卡冻结）
    for (const line of vm.research) {
      this.binder.set(findText(this.actor, `Line_${line.id}`),
        `${line.name} ${(line.progress * 100).toFixed(0)}%${line.oc ? ' ⚡' : ''}`)
      this.vis.set(this.actor, `Btn_oc_${line.id}`, vm.ring === 'running' && !vm.pending && vm.outcome === 'playing')
    }
    // 造船按钮态
    this.vis.set(this.actor, 'Btn_ship', vm.outcome === 'playing' && !vm.pending)
  }
}
