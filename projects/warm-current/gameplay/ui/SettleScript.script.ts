/**
 * SettleScript — 胜利结算弹窗行为脚本（settle.widget.json 根节点）
 *
 * 由 HudScript 一次性生成；自身每帧观察 outcome 驱动可见性。
 * 胜利：进沙盒 / 重开。
 * 2026-09-30 环熄灭失败线下线：失败分支（环已熄灭/重试本幕）已移除，只剩胜利结算。
 */
import { BehaviourScript, logger } from '@/engine'
import { TextBinder, VisBinder, findButton, findText, fmtGameDur, wcMode } from './uiCommon'

export default class SettleScript extends BehaviourScript {
  private binder = new TextBinder()
  private vis = new VisBinder()
  private shown: 'victory' | null = null

  override onStart(): void {
    // 面板根显隐统一走 bActive（理由同 HexModalScript）
    this.actor.bActive = false
    const bind = (name: string, fn: () => void): void => {
      const btn = findButton(this.actor, name)
      if (btn) btn.onClick = fn
    }
    bind('Btn_sandbox', () => wcMode()?.simState.enterSandbox())
    bind('Btn_restart', () => wcMode()?.restart())
    logger.info('[SettleScript] 结算弹窗就绪')
  }

  override onUpdate(_dt: number): void {
    const mode = wcMode()
    if (!mode) return
    const s = mode.simState.state
    const want = s.outcome === 'playing' ? null : s.outcome
    if (want !== this.shown) {
      this.shown = want
      this.actor.bActive = want !== null
    }
    if (!want) return
    const vm = mode.buildViewModel()
    this.binder.set(findText(this.actor, 'SettleTitle'), '环网建成')
    this.binder.set(findText(this.actor, 'SettleSub'), vm.sandbox
      ? '沙盒续行中：自由扩建环网'
      : '火星聚能模块运回，地球重获暖流')
    this.binder.set(findText(this.actor, 'SettleStats'),
      `存活 ${fmtGameDur(vm.time)} · 第${['一', '二', '三'][vm.act - 1]}幕 · 环段 ${vm.ringSlots}/${vm.ringSlotsTotal}\n`
      + `累计送达 ${Math.round(vm.stats.delivered)}t · 冻毁 ${vm.stats.frozen} 艘\n`
      + `建筑 ${vm.stats.buildings} 座 · 解锁节点卡 ${vm.stats.cards} 张`)
    this.vis.set(this.actor, 'Btn_sandbox', want === 'victory' && !s.sandbox)
  }
}
