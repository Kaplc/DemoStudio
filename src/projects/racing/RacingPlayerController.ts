/**
 * RacingPlayerController — 赛车输入控制
 * WASD / 方向键控制油门、刹车、转向
 */
import { PlayerController, logger } from '@/engine'
import { RacingCarPawn } from './RacingCarPawn'

export class RacingPlayerController extends PlayerController {
  private _pawn: RacingCarPawn | null = null
  private keysDown = new Set<string>()

  constructor() {
    super()
  }

  protected override OnPossess(pawn: any) {
    if (!(pawn instanceof RacingCarPawn)) return
    this._pawn = pawn
    this.keysDown.clear()

    logger.info(`RacingPlayerController.OnPossess: ${pawn.name}`)

    const bindAction = (action: string, key: string) => {
      this.inputComponent.BindAction(action, key, 'pressed', () => {
        this.keysDown.add(key)
      })
    }

    // 油门
    bindAction('Throttle', 'ArrowUp')
    bindAction('Throttle', 'w')
    bindAction('Throttle', 'W')
    // 刹车/倒车
    bindAction('Brake', 'ArrowDown')
    bindAction('Brake', 's')
    bindAction('Brake', 'S')
    // 左转
    bindAction('SteerLeft', 'ArrowLeft')
    bindAction('SteerLeft', 'a')
    bindAction('SteerLeft', 'A')
    // 右转
    bindAction('SteerRight', 'ArrowRight')
    bindAction('SteerRight', 'd')
    bindAction('SteerRight', 'D')

    // 空格 = 手刹（急刹车）
    bindAction('Handbrake', ' ')

    logger.info('Racing 控制: ↑/W 油门, ↓/S 刹车, ←/A 左转, →/D 右转, 空格 手刹')
  }

  protected override OnUnpossess(pawn: any) {
    this.keysDown.clear()
    this._pawn = null
    super.OnUnpossess(pawn)
  }

  override ProcessInput(key: string, eventType: 'pressed' | 'released'): boolean {
    if (!this._pawn) return false

    if (eventType === 'released') {
      if (key.length === 1) {
        this.keysDown.delete(key.toLowerCase())
        this.keysDown.delete(key.toUpperCase())
      } else {
        this.keysDown.delete(key)
      }
      return true
    }

    return this.inputComponent.ProcessInput(key, eventType)
  }

  /** 每帧处理按键状态，映射为赛车输入 */
  ProcessKeys(dt: number) {
    if (!this._pawn) return

    const up = this.keysDown.has('ArrowUp') || this.keysDown.has('w') || this.keysDown.has('W')
    const down = this.keysDown.has('ArrowDown') || this.keysDown.has('s') || this.keysDown.has('S')
    const left = this.keysDown.has('ArrowLeft') || this.keysDown.has('a') || this.keysDown.has('A')
    const right = this.keysDown.has('ArrowRight') || this.keysDown.has('d') || this.keysDown.has('D')
    const handbrake = this.keysDown.has(' ')

    this._pawn.throttleInput = up ? 1 : 0
    this._pawn.brakeInput = down ? 1 : (handbrake ? 0.8 : 0)

    if (left && !right) {
      this._pawn.steerInput = -1
    } else if (right && !left) {
      this._pawn.steerInput = 1
    } else {
      this._pawn.steerInput = 0
    }
  }
}
