/**
 * FishMainMenuPawn — 主菜单阶段玩家 Pawn
 *
 * 主菜单阶段玩家没有物理化身，此 Pawn 作为占位标记，
 * 被 FishMainMenuPlayerController 占据以保持引擎输入管线的一致性。
 */
import { Pawn } from '@/engine'

export class FishMainMenuPawn extends Pawn {
  constructor() {
    super('FishMainMenuPawn')
  }
}
