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
    // 键盘 1/2/3 切炮等级
    this.inputComponent.BindAction('Cannon1', '1', 'pressed', () => c.SetLevel(1))
    this.inputComponent.BindAction('Cannon2', '2', 'pressed', () => c.SetLevel(2))
    this.inputComponent.BindAction('Cannon3', '3', 'pressed', () => c.SetLevel(3))
    logger.info('[Fish] PlayerController 已绑定（鼠标瞄准 + 滚轮/1/2/3 切炮）')
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
    let next: 1 | 2 | 3
    if (delta > 0) {
      // 向下滚 → 降级
      next = current > 1 ? (current - 1) as 1 | 2 | 3 : 3
    } else {
      // 向上滚 → 升级
      next = current < 3 ? (current + 1) as 1 | 2 | 3 : 1
    }
    this.pawn.SetLevel(next)
  }
}
