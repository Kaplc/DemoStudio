/**
 * HexModalScript — 海克斯三选一弹窗行为脚本（hex_modal.widget.json 根节点）
 *
 * 由 HudScript 一次性生成；自身每帧观察 pendingCard 驱动可见性，
 * 填充三张卡（名/得/失），按钮回调 mode.chooseCardByIndex(i)。
 */
import { BehaviourScript, logger } from '@/engine'
import { TextBinder, VisBinder, findButton, findChild, findText, wcMode } from './uiCommon'

export default class HexModalScript extends BehaviourScript {
  private binder = new TextBinder()
  private vis = new VisBinder()
  private shown = false

  override onStart(): void {
    this.actor.root.visible = false
    for (let i = 0; i < 3; i++) {
      const btn = findButton(this.actor, `Btn_card${i}`)
      if (btn) btn.onClick = () => wcMode()?.chooseCardByIndex(i)
    }
    logger.info('[HexModalScript] 三选一弹窗就绪')
  }

  override onUpdate(_dt: number): void {
    const mode = wcMode()
    const pend = mode?.simState.state.pendingCard ?? null
    const want = !!pend
    if (want !== this.shown) {
      this.shown = want
      this.actor.root.visible = want
    }
    if (!pend || !mode) return
    const vm = mode.buildViewModel()
    if (!vm.pending) return
    this.binder.set(findText(this.actor, 'HexTitle'), `「${vm.pending.lineName}」交点达成 · 三选一`)
    for (let i = 0; i < 3; i++) {
      const def = vm.pending.cards[i]
      this.vis.set(this.actor, `CardWrap${i}`, !!def)
      if (!def) continue
      this.binder.set(findText(this.actor, `CardName${i}`), def.name)
      this.binder.set(findText(this.actor, `CardGain${i}`), `得：${def.gain}`)
      this.binder.set(findText(this.actor, `CardCost${i}`), `失：${def.cost}`)
    }
  }
}
