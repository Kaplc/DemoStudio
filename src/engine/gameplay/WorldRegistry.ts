/**
 * WorldRegistry — 世界构建器注册中心
 * 管理 游戏名 → WorldBuilder 的映射
 * 游戏在 App 初始化时注册，Viewport 通过游戏名查找
 */
import type { WorldBuilder } from './WorldAsset'

export class WorldRegistry {
  private static builders = new Map<string, WorldBuilder>()

  /** 注册世界构建器 */
  static register(gameName: string, builder: WorldBuilder): void {
    WorldRegistry.builders.set(gameName, builder)
  }

  /** 获取指定游戏的世界构建器 */
  static get(gameName: string): WorldBuilder | undefined {
    return WorldRegistry.builders.get(gameName)
  }

  /** 检查是否已注册 */
  static has(gameName: string): boolean {
    return WorldRegistry.builders.has(gameName)
  }

  /** 获取所有已注册的游戏名 */
  static getRegisteredGames(): string[] {
    return [...WorldRegistry.builders.keys()]
  }
}
