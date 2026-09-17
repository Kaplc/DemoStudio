/**
 * FishPlayerController — 鼠标瞄准 + 按住连射；滚轮/键盘 1/2/3 切换炮等级。
 */
import * as THREE from 'three'
import { PlayerController, logger } from '@/engine'
import type { Pawn } from '@/engine'
import { FishCannon } from './FishCannon'

export class FishPlayerController extends PlayerController {
  protected override OnPossess(pawn: Pawn) {
    if (!(pawn instanceof FishCannon)) return
    const c = pawn
    // 键盘 1~最大等级 切炮
    this.inputComponent.BindAction('Cannon1', '1', 'pressed', () => c.SetLevel(1))
    this.inputComponent.BindAction('Cannon2', '2', 'pressed', () => c.SetLevel(2))
    this.inputComponent.BindAction('Cannon3', '3', 'pressed', () => c.SetLevel(3))
    this.inputComponent.BindAction('Cannon4', '4', 'pressed', () => c.SetLevel(4))
    this.inputComponent.BindAction('Cannon5', '5', 'pressed', () => c.SetLevel(5))
    logger.info(`[Fish] PlayerController 已绑定（鼠标瞄准 + 滚轮/1-5 切炮）`)
  }

  override OnPointerMove(world: THREE.Vector3) {
    if (this.pawn instanceof FishCannon) this.pawn.SetAimTarget(world)
  }

  override OnPointerDown(_world: THREE.Vector3) {
    if (this.pawn instanceof FishCannon) this.pawn.SetFiring(true)
  }

  override OnPointerUp(_world: THREE.Vector3) {
    if (this.pawn instanceof FishCannon) this.pawn.SetFiring(false)
  }

  /** 滚轮切换炮等级 */
  override OnScroll(delta: number) {
    if (!(this.pawn instanceof FishCannon)) return
    const current = this.pawn.level
    const maxLvl = 5
    let next: number
    if (delta > 0) {
      // 向下滚 → 降级
      next = current > 1 ? current - 1 : maxLvl
    } else {
      // 向上滚 → 升级
      next = current < maxLvl ? current + 1 : 1
    }
    this.pawn.SetLevel(next)
  }
}
