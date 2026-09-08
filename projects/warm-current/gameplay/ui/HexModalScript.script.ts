/**
 * HexModalScript — 海克斯三选一弹窗行为脚本（hex_modal.widget.json 根节点）
 *
 * 由 HudScript 一次性生成；每帧消费 buildViewModel().pending 驱动可见性，
 * 权威判定：sim 端 pendingCard（弹卡即暂停仿真，选卡前弹窗恒可见，无超时收纳），
 * 填充三张卡（名/得/失），按钮回调 mode.chooseCardByIndex(i)，选卡即恢复运行。
 */
import { BehaviourScript, logger } from '@/engine'
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
    logger.info('[HexModalScript] 三选一弹窗就绪（弹卡即暂停仿真，选卡恢复）')
  }

  override onUpdate(_dt: number): void {
    const mode = wcMode()
    if (!mode) return
    const s = mode.simState.state
    const vm = mode.buildViewModel()
    // 可见性 = 有待选卡（弹卡即暂停且不再自动收纳，pendingCard 存在即弹窗恒可见）
    const want = !!vm.pending
    if (want !== this.shown) {
      this.shown = want
      this.actor.root.visible = want
      logger.info(want
        ? `[HexModalScript] 弹窗显示：「${vm.pending!.lineName}」三选一（仿真暂停）`
        : '[HexModalScript] 选卡完成，弹窗关闭（仿真恢复）')
    }
    if (s.pendingCard !== this.lastPend) {
      this.lastPend = s.pendingCard
      if (s.pendingCard) logger.info(`[HexModalScript] 新待选卡（${s.pendingCard.choices.length} 张）`)
    }
    if (!vm.pending) return
    this.binder.set(findText(this.actor, 'HexTitle'), `「${vm.pending.lineName}」交点达成 · 三选一`)
    this.binder.set(findText(this.actor, 'HexHint'), '仿真已暂停 · 三选一后恢复运行')
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
