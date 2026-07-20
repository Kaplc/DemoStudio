/**
 * registerBuiltinActors — 集中注册引擎内置 / 基础 Actor
 *
 * 目前仅注册通用容器 Actor 'Actor'（GenericActor），作为 Blueprint 的默认 baseClass
 * （纯 Component 组合 / 子 Actor 组合的容器，无内置行为）。
 *
 * 项目行为类（如 FishHouse）在各项目 register.ts 中通过 ActorRegistry.register 注册。
 */
import { ActorRegistry } from './ActorRegistry'
import { GenericActor } from '../entity/GenericActor'

let _registered = false

/** 注册所有内置 Actor（幂等，重复调用无副作用） */
export function registerBuiltinActors(): void {
  if (_registered) return
  _registered = true

  // Actor — 通用容器（Blueprint 默认 baseClass）
  ActorRegistry.register('Actor', (p) => new GenericActor((p?.name as string | undefined) ?? 'Actor'))
}
