/**
 * HexModalScript — 海克斯三选一弹窗行为脚本（hex_modal.widget.json 根节点）
 *
 * 由 HudScript 一次性生成；每帧消费 buildViewModel().pending 驱动可见性（隐藏 ≠ 放弃，
 * 权威判定：sim 端 pendingCard + hexHiddenAt），填充三张卡（名/得/失），
 * 按钮回调 mode.chooseCardByIndex(i)。15 秒未选自动收纳后由 HUD 徽标随时重开，
 * 倒计时以 pendingCard.since 为基准（重开不重置，累计必收）。
 */
import { BehaviourScript, logger } from '@/engine'
import { B } from '../core/balance'
import { TextBinder, VisBinder, findButton, findText, wcMode } from './uiCommon'

export default class HexModalScript extends BehaviourScript {
  private binder = new TextBinder()
  private vis = new VisBinder()
  private shown = false
  /** 上一帧 pendingCard 引用（识别换新卡，仅日志用） */
  private lastPend: unknown = null

  override onStart(): void {
    this.actor.root.visible = false
    for (let i = 0; i < 3; i++) {
      const btn = findButton(this.actor, `Btn_card${i}`)
      if (btn) btn.onClick = () => wcMode()?.chooseCardByIndex(i)
    }
    logger.info('[HexModalScript] 三选一弹窗就绪（15s 未选自动收纳，可由徽标重开）')
  }

  override onUpdate(_dt: number): void {
    const mode = wcMode()
    if (!mode) return
    const s = mode.simState.state
    const vm = mode.buildViewModel()
    // 可见性 = 有待选且未被自动收纳（VM.pending 已折算 hexHiddenAt）
    const want = !!vm.pending
    if (want !== this.shown) {
      this.shown = want
      this.actor.root.visible = want
      logger.info(want
        ? `[HexModalScript] 弹窗显示：「${vm.pending!.lineName}」三选一`
        : s.pendingCard
          ? '[HexModalScript] 15s 未选自动收纳（待选保留，可重开）'
          : '[HexModalScript] 弹窗关闭')
    }
    if (s.pendingCard !== this.lastPend) {
      this.lastPend = s.pendingCard
      if (s.pendingCard) logger.info(`[HexModalScript] 新待选卡（${s.pendingCard.choices.length} 张）`)
    }
    if (!vm.pending) return
    // 倒计时（重开后继续走：since 不重置，累计 hexAutoCloseSeconds 必收）
    const remain = Math.max(0, Math.ceil(B.hexAutoCloseSeconds - (s.time - s.pendingCard!.since)))
    this.binder.set(findText(this.actor, 'HexTitle'), `「${vm.pending.lineName}」交点达成 · 三选一`)
    this.binder.set(findText(this.actor, 'HexHint'), remain > 0
      ? `研究冻结中 · ${remain}s 后自动收纳（待选 +1，稍后可继续）`
      : '研究冻结中 · 即将自动收纳')
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
