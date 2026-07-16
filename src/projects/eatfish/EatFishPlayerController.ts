/**
 * EatFishPlayerController — 大鱼吃小鱼输入控制
 * WASD / 方向键控制鱼游动
 */
import { PlayerController, logger } from '@/engine'
import { EatFishPawn } from './EatFishPawn'
import { InputComponent } from '@/engine'

export class EatFishPlayerController extends PlayerController {
  private _pawn: EatFishPawn | null = null
  private keysDown = new Set<string>()

  constructor() {
    super()
  }

  protected override OnPossess(pawn: any) {
    if (!(pawn instanceof EatFishPawn)) return
    this._pawn = pawn
    this.keysDown.clear()

    logger.info(`EatFishPlayerController.OnPossess: ${pawn.name}`)

    // 方向键 / WASD 绑定
    const bindAction = (action: string, key: string) => {
      this.inputComponent.BindAction(action, key, 'pressed', () => {
        this.keysDown.add(key)
      })
    }

    bindAction('TurnLeft', 'ArrowLeft')
    bindAction('TurnLeft', 'a')
    bindAction('TurnLeft', 'A')
    bindAction('TurnRight', 'ArrowRight')
    bindAction('TurnRight', 'd')
    bindAction('TurnRight', 'D')
    bindAction('SpeedUp', 'ArrowUp')
    bindAction('SpeedUp', 'w')
    bindAction('SpeedUp', 'W')
    bindAction('SpeedDown', 'ArrowDown')
    bindAction('SpeedDown', 's')
    bindAction('SpeedDown', 'S')

    logger.info('EatFish 控制: ←/A 左转, →/D 右转, ↑/W 加速, ↓/S 减速')
  }

  protected override OnUnpossess(pawn: any) {
    this.keysDown.clear()
    this._pawn = null
    super.OnUnpossess(pawn)
  }

  /** 覆盖 ProcessInput 以支持按下/释放 */
  override ProcessInput(key: string, eventType: 'pressed' | 'released'): boolean {
    if (!this._pawn) return false

    if (eventType === 'released') {
      // 单字母键同时删大小写，避免 Shift 状态变化导致按键卡住
      if (key.length === 1) {
        this.keysDown.delete(key.toLowerCase())
        this.keysDown.delete(key.toUpperCase())
      } else {
        this.keysDown.delete(key)
      }
      return true
    }

    // pressed 事件：通过 InputComponent 绑定
    return this.inputComponent.ProcessInput(key, eventType)
  }

  /** 每帧处理按键状态（由 GameInstance.tick 调用） */
  ProcessKeys(dt: number) {
    if (!this._pawn) return

    const left = this.keysDown.has('ArrowLeft') || this.keysDown.has('a') || this.keysDown.has('A')
    const right = this.keysDown.has('ArrowRight') || this.keysDown.has('d') || this.keysDown.has('D')
    const up = this.keysDown.has('ArrowUp') || this.keysDown.has('w') || this.keysDown.has('W')
    const down = this.keysDown.has('ArrowDown') || this.keysDown.has('s') || this.keysDown.has('S')

    if (left) this._pawn.TurnLeft(dt)
    if (right) this._pawn.TurnRight(dt)
    if (up) this._pawn.SpeedUp()
    else if (down) this._pawn.SpeedDown()
    else this._pawn.ResetSpeed()
  }
}
