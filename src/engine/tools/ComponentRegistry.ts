/**
 * ComponentRegistry — Component 工厂注册中心
 *
 * 管理 Component 类型字符串 → 工厂函数 + 配置器 的映射。
 * Blueprint 系统通过它从 JSON 描述（{ type, props }）创建并配置 Component。
 *
 * 复刻 GameFactoryRegistry 的工厂函数模式：
 *   - factory(owner, props):  构造 Component（props 可含构造所需参数，如 sprite 的 width/height）
 *   - configure(comp, props): 构造后用剩余 props 调各 setter（setColor / setOpacity ...）
 *
 * 内置 Component 由 registerBuiltinComponents() 集中注册。
 */
import type { Component } from '../entity/Component'
import type { Actor } from '../entity/Actor'
import type { PropertyPatch } from '../tools/deepMerge'

/** Component 工厂：用 owner 与 props 构造实例（props 可含构造所需参数） */
export type ComponentFactory = (owner: Actor, props?: PropertyPatch) => Component

/** Component 配置器：构造后用 props 调各 setter */
export type ComponentConfigurator = (comp: Component, props: PropertyPatch) => void

export class ComponentRegistry {
  private static entries = new Map<string, { factory: ComponentFactory; configure?: ComponentConfigurator }>()

  /** 注册一个 Component 类型 */
  static register(type: string, factory: ComponentFactory, configure?: ComponentConfigurator): void {
    ComponentRegistry.entries.set(type, { factory, configure })
  }

  /**
   * 创建并配置一个 Component（不 addComponent，由调用方决定是否挂载）。
   * 未注册的类型返回 null。
   */
  static create(owner: Actor, type: string, props?: PropertyPatch): Component | null {
    const entry = ComponentRegistry.entries.get(type)
    if (!entry) return null
    const comp = entry.factory(owner, props)
    // persistType 默认即完整类名（this.constructor.name），无需注入
    if (entry.configure && props) {
      entry.configure(comp, props)
    }
    return comp
  }

  /** 检查是否已注册 */
  static has(type: string): boolean {
    return ComponentRegistry.entries.has(type)
  }

  /** 获取所有已注册的 Component 类型 */
  static getRegisteredTypes(): string[] {
    return [...ComponentRegistry.entries.keys()]
  }
}
