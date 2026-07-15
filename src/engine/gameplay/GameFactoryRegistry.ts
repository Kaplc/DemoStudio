/**
 * GameFactoryRegistry — 游戏实例工厂注册中心
 * 管理 游戏名 → GameInstance 工厂函数的映射
 * 每个游戏注册自己的工厂，Viewport 根据项目名创建对应的 GameInstance
 */
import type * as THREE from 'three'
import type { GameInstance } from './GameInstance'

export type GameInstanceFactory = (sharedScene: THREE.Scene) => GameInstance

export class GameFactoryRegistry {
  private static factories = new Map<string, GameInstanceFactory>()

  /** 注册游戏实例工厂 */
  static register(gameName: string, factory: GameInstanceFactory): void {
    GameFactoryRegistry.factories.set(gameName, factory)
  }

  /** 创建指定游戏的 GameInstance */
  static create(gameName: string, sharedScene: THREE.Scene): GameInstance | null {
    const factory = GameFactoryRegistry.factories.get(gameName)
    if (!factory) return null
    return factory(sharedScene)
  }

  /** 检查是否已注册 */
  static has(gameName: string): boolean {
    return GameFactoryRegistry.factories.has(gameName)
  }

  /** 获取所有已注册的游戏名 */
  static getRegisteredGames(): string[] {
    return [...GameFactoryRegistry.factories.keys()]
  }
}
