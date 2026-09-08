/**
 * ResearchPanelScript — 科研二级面板 widget 行为脚本（research_panel.widget.json 根节点）
 *
 * 职责（入口按钮在主 HUD 底部 bar，本脚本只管面板本体）：
 *  - 面板内「✕ 关闭」收起（open/close 自驱动显隐，open 由 HudScript 底部入口调用）
 *  - 研究点数分配：五线各一对 +/− 按钮（可用点 = 聚能环等级 − 已分配）
 *  - 8Hz 差分同步：船队明细、可用点与五线点数、每线实时 H3 消耗速率、造船按钮态
 */
import { BehaviourScript, logger } from '@/engine'
import { ColorBinder, TextBinder, VisBinder, findButton, findText, wcMode } from './uiCommon'

/** 科研面板 widget 资产路径（HudScript 生成入口） */
export const RESEARCH_PANEL_WIDGET = 'asset/blueprints/ui/research_panel.widget.json'

const LINES = ['engine', 'cargo', 'ring', 'infra', 'expand'] as const

const RATE_ACTIVE_COLOR = '#ffd9a8'
const RATE_IDLE_COLOR = '#5a707f'
const POINTS_HAVE_COLOR = '#ffd9a8'
const POINTS_SPENT_COLOR = '#9fc4d8'

export default class ResearchPanelScript extends BehaviourScript {
  private binder = new TextBinder()
  private colors = new ColorBinder()
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
    // 研究点分配：+ 分配 / − 回收（无可用点时组件内 hint 提示）
    for (const id of LINES) {
      bind(`Btn_inc_${id}`, () => wcMode()?.research.allocateResearch(id, 1))
      bind(`Btn_dec_${id}`, () => wcMode()?.research.allocateResearch(id, -1))
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

    // 可用研究点行（有可用点高亮提示可分配；研究耗 = 五线计费合计）
    const pointsText = findText(this.actor, 'PointsText')
    this.binder.set(pointsText,
      `◆ 可用研究点 ${vm.researchUnspent} · 研究耗 ${vm.researchCost.toFixed(1)}/s`)
    this.colors.set(pointsText, vm.researchUnspent > 0 ? POINTS_HAVE_COLOR : POINTS_SPENT_COLOR)

    // 船队明细行（面板展开时可见）
    this.binder.set(findText(this.actor, 'FleetText'),
      `船队 ${vm.fleet.total}（空闲 ${vm.fleet.idle} · 在途 ${vm.fleet.flying} · 冻毁 ${vm.fleet.frozen}）`
      + (vm.fleet.building > 0 ? ` · 建造中 ${vm.fleet.buildRemain}s` : '')
      + ` · 维护 ${vm.fleet.maintPerS}/s`)
    // 五线：进度 / 已分配点数 / 实时 H3 消耗速率（计费中琥珀色，未计费灰）
    for (const line of vm.research) {
      this.binder.set(findText(this.actor, `Line_${line.id}`),
        `${line.name} ${(line.progress * 100).toFixed(0)}%`)
      this.binder.set(findText(this.actor, `Pts_${line.id}`), `${line.points}点`)
      const rateText = findText(this.actor, `Rate_${line.id}`)
      this.binder.set(rateText, `${line.rate.toFixed(1)}/s`)
      this.colors.set(rateText, line.rate > 0 ? RATE_ACTIVE_COLOR : RATE_IDLE_COLOR)
    }
    // 造船按钮态
    this.vis.set(this.actor, 'Btn_ship', vm.outcome === 'playing' && !vm.pending)
  }
}
