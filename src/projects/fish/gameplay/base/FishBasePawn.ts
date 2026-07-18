/**
 * FishBasePawn — 基地阶段玩家 Pawn
 *
 * 在基地中玩家没有物理化身，此 Pawn 作为占位标记，
 * 被 FishBasePlayerController 占据以保持引擎输入管线的一致性。
 */
import { Pawn } from '@/engine'

export class FishBasePawn extends Pawn {
  constructor() {
    super('FishBasePawn')
  }
}
