/**
 * GameModeRegistry — GameMode 模式注册中心
 *
 * 管理 场景模式标识（mode 字符串）→ GameMode 构造函数的映射。
 * World.SwitchToScene 通过此注册表根据 SceneAsset.mode 自动创建对应的 GameMode 实例。
 *
 * 用法（在项目的 register.ts 中注册）：
 *   GameModeRegistry.register('menu', FishMainMenuGameMode)
 *   GameModeRegistry.register('base', FishBaseGameMode)
 *   GameModeRegistry.register('game', FishGameMode)
 */
import type { GameMode } from '../gameflow/GameMode'

export type GameModeConstructor = new () => GameMode

export class GameModeRegistry {
  private static map = new Map<string, GameModeConstructor>()

  /** 注册 mode 字符串到 GameMode 构造函数 */
  static register(mode: string, ctor: GameModeConstructor): void {
    GameModeRegistry.map.set(mode, ctor)
  }

  /** 根据 mode 创建 GameMode 实例，未注册时返回 null */
  static create(mode: string): GameMode | null {
    const ctor = GameModeRegistry.map.get(mode)
    if (!ctor) return null
    return new ctor()
  }

  /** 检查 mode 是否已注册 */
  static has(mode: string): boolean {
    return GameModeRegistry.map.has(mode)
  }

  /** 获取所有已注册的 mode 列表 */
  static getRegisteredModes(): string[] {
    return [...GameModeRegistry.map.keys()]
  }
}
