/**
 * ActorRegistry — Actor 工厂注册中心
 *
 * 管理 Actor 类型字符串 → 工厂函数 的映射。
 * Blueprint 系统通过它从 baseClass 创建 Actor 实例（行为类或容器）。
 *
 * 复刻 GameFactoryRegistry 的工厂函数模式：
 *   factory(params?):  创建 Actor（params 可含构造参数，如 name）
 *
 * 内置 / 基础 Actor 由 registerBuiltinActors() 集中注册；
 * 项目行为类（如 FishHouse）在各项目 register.ts 中注册。
 */
import type { Actor } from '../entity/Actor'
import type { PropertyPatch } from '../tools/deepMerge'

/** Actor 工厂：用 params 创建实例 */
export type ActorFactory = (params?: PropertyPatch) => Actor

export class ActorRegistry {
  private static factories = new Map<string, ActorFactory>()

  /** 注册一个 Actor 类型 */
  static register(type: string, factory: ActorFactory): void {
    ActorRegistry.factories.set(type, factory)
  }

  /** 创建一个 Actor 实例，未注册返回 null */
  static create(type: string, params?: PropertyPatch): Actor | null {
    const factory = ActorRegistry.factories.get(type)
    if (!factory) return null
    return factory(params)
  }

  /** 检查是否已注册 */
  static has(type: string): boolean {
    return ActorRegistry.factories.has(type)
  }

  /** 获取所有已注册的 Actor 类型 */
  static getRegisteredTypes(): string[] {
    return [...ActorRegistry.factories.keys()]
  }
}
