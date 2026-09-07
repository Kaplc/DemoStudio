/**
 * WarmCurrentMenuPawn — 主菜单占位 Pawn（本作为纯地图调度玩法，无实体角色）
 * Pawn 为引擎输入链路必需（SpawnPlayer 契约），保持空实现（WarmCurrentPawn 同款）。
 */
import { Pawn } from '@/engine'

export class WarmCurrentMenuPawn extends Pawn {
  constructor() {
    super('WarmCurrentMenuPawn')
  }
}
