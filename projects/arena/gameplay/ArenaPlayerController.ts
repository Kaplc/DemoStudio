/**
 * ArenaPlayerController — 竞技场玩家控制器
 *
 * 输入绑定（pressed/released 配对维护移动轴，B1 真实映射前的代码级约定）：
 *  - WASD（大小写）→ Pawn.MoveForward/MoveRight（相机相对，控制器组件内换算）
 *  - Space → 跳跃；Shift → 翻滚（无敌帧窗口内 Health 授予短暂无敌）
 *  - J / 鼠标左键 → 三段连击
 */
import { PlayerController } from '@/engine'
import { audioSys } from '@/engine/audio/AudioSys'
import type { ArenaPlayerPawn } from './ArenaPlayerPawn'

export class ArenaPlayerController extends PlayerController {
  override OnPossess(pawn: import('@/engine').Pawn): void {
    super.OnPossess(pawn)
    this._bindActions(pawn as ArenaPlayerPawn)
  }

  private _bindActions(pawn: ArenaPlayerPawn): void {
    // WASD（大小写都绑：InputSys 归一化保留大小写）
    const bindAxis = (key: string, axis: 'f' | 'r', value: number) => {
      const apply = () => {
        if (axis === 'f') pawn.MoveForward(value)
        else pawn.MoveRight(value)
      }
      this.inputComponent.BindAction(axis + key, key, 'pressed', apply)
    }
    bindAxis('w', 'f', 1)
    bindAxis('W', 'f', 1)
    bindAxis('s', 'f', -1)
    bindAxis('S', 'f', -1)
    bindAxis('d', 'r', 1)
    bindAxis('D', 'r', 1)
    bindAxis('a', 'r', -1)
    bindAxis('A', 'r', -1)
    for (const k of ['w', 'W', 's', 'S', 'a', 'A', 'd', 'D']) {
      this.inputComponent.BindAction('Stop', k, 'released', () => {
        pawn.MoveForward(0)
        pawn.MoveRight(0)
      })
    }

    // 跳跃 / 翻滚
    this.inputComponent.BindAction('Jump', ' ', 'pressed', () => pawn.Jump())
    this.inputComponent.BindAction('Jump', 'Space', 'pressed', () => pawn.Jump())
    const dodge = () => {
      if (pawn.charCtrl.dodge()) {
        pawn.health.grantInvulnerability(pawn.charCtrl.dodgeDuration + 0.05) // 翻滚无敌帧
        audioSys.play('dodge', { volume: 0.7 })
      }
    }
    this.inputComponent.BindAction('Dodge', 'Shift', 'pressed', dodge)
    this.inputComponent.BindAction('Dodge', 'shift', 'pressed', dodge)

    // 攻击（J 键 / 鼠标左键）
    this.inputComponent.BindAction('Attack', 'j', 'pressed', () => pawn.combat.attack())
    this.inputComponent.BindAction('Attack', 'J', 'pressed', () => pawn.combat.attack())
    this.inputComponent.BindMouseButton((button, eventType) => {
      if (button === 0 && eventType === 'pressed') pawn.combat.attack()
    })
  }
}
