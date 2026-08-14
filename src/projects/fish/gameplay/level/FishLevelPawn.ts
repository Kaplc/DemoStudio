/**
 * FishLevelPawn — 关卡阶段玩家 Pawn
 *
 * 关卡是空壳占位场景（无玩法逻辑），此 Pawn 作为占位标记，
 * 被 FishLevelPlayerController 占据以保持引擎输入管线的一致性。
 */
import { Pawn } from '@/engine'

export class FishLevelPawn extends Pawn {
  constructor() {
    super('FishLevelPawn')
  }
}
