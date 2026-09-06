/**
 * EventPopupScript — 事件弹窗（模态；一次显示一条，选完自动检查队列）
 *
 * 选项按钮固定两枚（Btn_opt0/opt1），不足两选项时第二枚隐藏（按钮禁用+文案置空）。
 */
import { BehaviourScript, logger } from '@/engine'
import { hoi4Mode, findButton, findText, TextBinder } from './uiCommon'

export default class EventPopupScript extends BehaviourScript {
  private binder = new TextBinder()
  private eventId: string | null = null

  override onStart(): void {
    const mode = hoi4Mode()
    if (!mode) {
      logger.warn('[EventPopupScript] GameMode 未就绪')
      return
    }
    for (let i = 0; i < 2; i++) {
      const btn = findButton(this.actor, `Btn_opt${i}`)
      if (btn) {
        btn.onClick = () => {
          const m = hoi4Mode()
          if (!m?.coreState || !this.eventId) return
          m.cmdResolveEvent(this.eventId, i)
          // 队列还有 → 显示下一条；否则关窗
          const next = m.coreState.pendingEvents[0]
          if (next) this.show(next.eventId)
          else this.world?.ui.destroyUIActor(this.actor)
        }
      }
    }
  }

  override onUpdate(): void {
    const mode = hoi4Mode()
    if (!mode?.coreState) return
    const pending = mode.coreState.pendingEvents[0]
    if (!pending) {
      this.world?.ui.destroyUIActor(this.actor)
      return
    }
    this.show(pending.eventId)
  }

  private show(eventId: string): void {
    if (this.eventId === eventId) return
    const mode = hoi4Mode()
    if (!mode) return
    const def = mode.getTables().events[eventId]
    if (!def) return
    this.eventId = eventId
    this.binder.set(findText(this.actor, 'Title'), def.name)
    this.binder.set(findText(this.actor, 'Desc'), def.desc)
    for (let i = 0; i < 2; i++) {
      const label = findText(this.actor, `Label_opt${i}`)
      this.binder.set(label, def.options[i]?.name ?? '')
      const btn = findButton(this.actor, `Btn_opt${i}`)
      if (btn && !def.options[i]) {
        btn.onClick = () => { /* 无效选项 */ }
      }
    }
    logger.info(`[EventPopup] 事件: ${def.name}`)
  }
}
