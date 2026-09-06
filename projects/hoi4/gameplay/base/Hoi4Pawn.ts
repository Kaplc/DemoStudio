/**
 * Hoi4Pawn — 观察者 Pawn（大战略游戏无世界化身，空壳占位）
 */
import { Pawn } from '@/engine'

export class Hoi4Pawn extends Pawn {
  constructor() {
    super('Hoi4Observer')
  }
}
