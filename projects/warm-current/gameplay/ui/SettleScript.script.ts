/**
 * SettleScript — 胜负结算弹窗行为脚本（settle.widget.json 根节点）
 *
 * 由 HudScript 一次性生成；自身每帧观察 outcome 驱动可见性。
 * 胜利：进沙盒 / 重开；失败：重试本幕（有幕入口快照时）/ 重开。
 */
import { BehaviourScript, logger } from '@/engine'
import { TextBinder, VisBinder, findButton, findText, fmtTime, wcMode } from './uiCommon'

export default class SettleScript extends BehaviourScript {
  private binder = new TextBinder()
  private vis = new VisBinder()
  private shown: 'victory' | 'defeat' | null = null

  override onStart(): void {
    this.actor.root.visible = false
    const bind = (name: string, fn: () => void): void => {
      const btn = findButton(this.actor, name)
      if (btn) btn.onClick = fn
    }
    bind('Btn_retry', () => {
      const m = wcMode()
      if (m?.simState.retryAct()) this.shown = null // 立即收起（下帧重驱动）
    })
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
      this.actor.root.visible = want !== null
    }
    if (!want) return
    const vm = mode.buildViewModel()
    if (want === 'victory') {
      this.binder.set(findText(this.actor, 'SettleTitle'), '环网建成')
      this.binder.set(findText(this.actor, 'SettleSub'), vm.sandbox
        ? '沙盒续行中：无失败压力，自由扩建环网'
        : '第 12 交点点亮，地球重获暖流')
    } else {
      this.binder.set(findText(this.actor, 'SettleTitle'), '环已熄灭')
      this.binder.set(findText(this.actor, 'SettleSub'), '延续度归零 —— 人类文明失去最后的热源')
    }
    this.binder.set(findText(this.actor, 'SettleStats'),
      `存活 ${fmtTime(vm.time)} · 第${['一', '二', '三'][vm.act - 1]}幕 · 交点 ${vm.nodes}/12\n`
      + `累计送达 ${Math.round(vm.stats.delivered)}t · 冻毁 ${vm.stats.frozen} 艘\n`
      + `建站 ${vm.stats.stations} 座 · 解锁节点卡 ${vm.stats.cards} 张`)
    // 重试本幕：仅当存在幕入口快照（第一幕失败只能重开）
    const hasSnap = s.act === 3 ? !!s.actSnapshots.act3 : s.act === 2 ? !!s.actSnapshots.act2 : false
    this.vis.set(this.actor, 'Btn_retry', want === 'defeat' && hasSnap)
    this.vis.set(this.actor, 'Btn_sandbox', want === 'victory' && !s.sandbox)
  }
}
