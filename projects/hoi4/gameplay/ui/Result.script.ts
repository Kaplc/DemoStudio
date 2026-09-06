/**
 * ResultScript — 胜负结算面板
 */
import { BehaviourScript } from '@/engine'
import { hoi4Mode, findText, TextBinder } from './uiCommon'

export default class ResultScript extends BehaviourScript {
  private binder = new TextBinder()
  private filled = false

  override onUpdate(): void {
    if (this.filled) return
    const mode = hoi4Mode()
    if (!mode?.coreState?.result) return
    this.filled = true
    const result = mode.coreState.result
    const tag = mode.coreState.playerTag
    const name = tag ? mode.getTables().countries[tag]?.name ?? tag : ''
    this.binder.set(
      findText(this.actor, 'Title'),
      result === 'victory' ? '胜 利' : '战 败',
    )
    this.binder.set(
      findText(this.actor, 'Desc'),
      result === 'victory'
        ? `${name} 的所有敌人已放下武器。历史由胜利者书写。`
        : `${name} 已失去全部胜利点，政府流亡。战争结束了。`,
    )
  }
}
