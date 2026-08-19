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
 * owner 类型为 BObject：组件可挂 Actor（渲染类）也可挂 GameMode/PlayerController（逻辑类）。
 * 返回类型为 BObjectComponent（含生命周期钩子）：注册的组件均继承 BObjectComponent 或其子类
 * （ActorComponent 等），可直接挂到 BObject.addComponent。
 */
import type { BObjectComponent } from '../entity/BObjectComponent'
import type { BObject } from '../entity/BObject'
import type { PropertyPatch } from '../tools/deepMerge'

/** Component 工厂：用 owner 与 props 构造实例（props 可含构造所需参数） */
export type ComponentFactory = (owner: BObject, props?: PropertyPatch) => BObjectComponent

/** Component 配置器：构造后用 props 调各 setter */
export type ComponentConfigurator = (comp: BObjectComponent, props: PropertyPatch) => void

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
  static create(owner: BObject, type: string, props?: PropertyPatch): BObjectComponent | null {
    const entry = ComponentRegistry.entries.get(type)
    if (!entry) return null
    const comp = entry.factory(owner, props)
    // persistType 默认即完整类名（this.constructor.name），无需注入
    if (entry.configure && props) {
      entry.configure(comp, props)
    }
    return comp
  }

  /**
   * 用 props 配置已有组件（复用场景）：Actor 构造已自带 TransformComponent 时，
   * 蓝图声明的 TransformComponent 不再重复创建，改为对已有实例应用属性。
   */
  static configure(comp: BObjectComponent, type: string, props?: PropertyPatch): void {
    const entry = ComponentRegistry.entries.get(type)
    if (entry?.configure && props) {
      entry.configure(comp, props)
    }
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
