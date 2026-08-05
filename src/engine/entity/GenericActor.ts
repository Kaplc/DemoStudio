/**
 * GenericActor — 通用容器 Actor
 *
 * 无内置行为，作为 Blueprint 的默认 baseClass：
 * 纯 Component 组合或子 Actor 组合的容器（如 seaweed = 容器 + SpriteComponent）。
 *
 * 行为类应直接继承 Actor 并实现自身逻辑（如 FishHouseActor），
 * 仅当 Blueprint 需要"空壳容器"时使用本类。
 */
import { Actor } from './Actor'

export class GenericActor extends Actor {
  constructor(name = 'GenericActor') {
    super(name)
  }
}
