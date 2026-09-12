/**
 * StatsPanelScript — H3 收支统计面板 widget 行为脚本（stats_panel.widget.json 根节点）
 *
 * 职责：
 *  - 默认隐藏（widget 种子不得带 active=false——bActive 级联会整树隐藏子树，
 *    显隐唯一权威是脚本 root.visible），HudScript 顶栏「📊 收支统计」经居中互斥
 *    toggleCenterPanel 调 open()/close()
 *  - 打开时 8Hz 差分同步 GameMode.buildViewModel().ledger（九项收支 + 收入/支出/净结余合计）
 *  - ✕ 关闭按钮 → close()
 */
import { BehaviourScript, logger } from '@/engine'
import { ColorBinder, TextBinder, findButton, findText, wcMode } from './uiCommon'

/** 收支统计 widget 资产路径（HudScript 生成入口） */
export const STATS_PANEL_WIDGET = 'asset/blueprints/ui/stats_panel.widget.json'

/** 账本数值行（与 widget HTML 的 data-name 一一对应） */
const LEDGER_ROWS: Array<{ node: string; pick: (l: import('../core/types').SimLedger) => number }> = [
  { node: 'Val_unload', pick: (l) => l.unload },
  { node: 'Val_refund', pick: (l) => l.demolishRefund },
  { node: 'Val_mining', pick: (l) => l.mining },
  { node: 'Val_ring', pick: (l) => l.ringBurn },
  { node: 'Val_ringbuild', pick: (l) => l.ringBuild },
  { node: 'Val_research', pick: (l) => l.research },
  { node: 'Val_maint', pick: (l) => l.fleetMaint },
  { node: 'Val_orbit', pick: (l) => l.orbitBuild },
  { node: 'Val_minebuild', pick: (l) => l.mineBuild },
  { node: 'Val_build', pick: (l) => l.shipBuild },
  { node: 'Val_rebuild', pick: (l) => l.shipRebuild },
  { node: 'Val_rfuel', pick: (l) => l.reverseFuel },
  { node: 'Val_mat', pick: (l) => l.materials },
]

/** 账本数值格式化（吨；累计值带 1 位小数，千位以上取整；负号用 ASCII 连字符防字形缺字） */
function fmtH3(v: number, signed: boolean): string {
  const abs = Math.abs(v)
  const num = abs >= 1000 ? Math.round(abs).toString() : abs.toFixed(1)
  const sign = signed ? (v > 0 ? '+' : v < 0 ? '-' : '') : v < 0 ? '-' : ''
  return `${sign}${num} t`
}

export default class StatsPanelScript extends BehaviourScript {
  private binder = new TextBinder()
  private colors = new ColorBinder()
  private acc = 1
  private openState = false

  /** 面板当前是否打开（HudScript 居中互斥读取） */
  get isOpen(): boolean { return this.openState }

  override onStart(): void {
    // 默认隐藏（种子无 active，脚本侧单保险收起；显隐唯一权威 = root.visible）
    this.actor.root.visible = false
    const btn = findButton(this.actor, 'Btn_close')
    if (btn) btn.onClick = () => this.close()
    logger.info('[StatsPanelScript] 收支统计面板就绪（默认隐藏）')
  }

  /** 打开面板（HudScript 居中互斥调用；打开其它居中面板时本面板会被 close） */
  open(): void {
    if (this.openState) return
    this.openState = true
    this.actor.root.visible = true
    logger.info('[StatsPanelScript] 收支统计面板打开')
  }

  /** 关闭面板 */
  close(): void {
    if (!this.openState) return
    this.openState = false
    this.actor.root.visible = false
    logger.info('[StatsPanelScript] 收支统计面板关闭')
  }

  override onUpdate(dt: number): void {
    if (!this.openState) return
    this.acc += dt
    if (this.acc < 0.12) return
    this.acc = 0
    const mode = wcMode()
    if (!mode) return
    const led = mode.buildViewModel().ledger

    for (const row of LEDGER_ROWS) {
      this.binder.set(findText(this.actor, row.node), fmtH3(row.pick(led), false))
    }
    this.binder.set(findText(this.actor, 'Val_income'), fmtH3(led.income, true))
    this.binder.set(findText(this.actor, 'Val_expense'), fmtH3(led.expense, true))
    this.binder.set(findText(this.actor, 'Val_net'), fmtH3(led.net, true))
    this.colors.set(findText(this.actor, 'Val_net'), led.net >= 0 ? '#ffe9a8' : '#ff5a4a')
  }
}
