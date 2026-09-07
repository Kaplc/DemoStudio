/**
 * WarmCurrentPawn — 占位 Pawn（本作为纯地图调度玩法，无实体角色）
 * Pawn 为引擎输入链路必需（SpawnPlayer 契约），保持空实现。
 */
import { Pawn } from '@/engine'

export class WarmCurrentPawn extends Pawn {
  constructor() {
    super('WarmCurrentPawn')
  }
}
