/**
 * AObject — 可挂载组件的基础对象
 *
 * 只提供"组件系统"能力（组件挂载/查询/移除），不含身份、World 引用与游戏生命周期。
 * 适用场景：需要组件能力但生命周期由外部管理的对象。
 *
 * 分层：
 *   OObject（完全空，仅标记）
 *    └── AObject（本类：组件系统）
 *         └── BObject（+ uid/name + world 引用 + BeginPlay/Tick/EndPlay/destroy + 序列化）
 *              ├── Actor（场景对象）
 *              ├── GameMode / GameState / PlayerController（非场景对象）
 */
import type { AObjectComponent } from './AObjectComponent'
import { OObject } from './OObject'
import { logger } from '../Logger'

export abstract class AObject extends OObject {
  private components: AObjectComponent[] = []

  // ═══════════════════════════════════
  //  Component 管理
  // ═══════════════════════════════════

  /** 实例版：直接传入已构造的组件实例（兼容旧写法） */
  addComponent(component: AObjectComponent): AObjectComponent
  /**
   * 类版（推荐）：传入组件类，内部自动 new Cls(this, ...args)（owner 自动传入），
   * 随后与实例版走完全相同的挂载流程（幂等检查/同名警告/MeshComponent 校验），
   * 并返回新实例（调用方可用返回值保存引用或继续链式配置）。
   * 示例：this.sprite = this.addComponent(SpriteComponent, 2.4, 2.4, 'CannonSprite')
   * ...args 与组件构造参数严格类型匹配（编译期检查，非 any 透传）。
   */
  addComponent<T extends AObjectComponent, Args extends unknown[]>(
    Cls: new (owner: this, ...args: Args) => T,
    ...args: Args
  ): T
  addComponent(
    componentOrCls: AObjectComponent | (new (...args: any[]) => AObjectComponent),
    ...args: unknown[]
  ): AObjectComponent {
    // 类版：自动实例化（owner 自动传入）；实例版：直接使用
    const component: AObjectComponent =
      typeof componentOrCls === 'function' ? new componentOrCls(this, ...args) : componentOrCls
    // 幂等：同一实例重复添加直接忽略（不重复入列）
    if (this.components.includes(component)) {
      logger.warn(`[AObject] 组件实例重复添加已忽略: ${component.constructor.name}（owner=${this.constructor.name}）`)
      return component
    }
    // 同名同类型组件重复警告：语义单例组件（ClickableComponent/CameraComponent 等）
    // 通常不应出现多个同名实例；同类型不同名（如底座 MeshComponent 'BaseMesh' +
    // 主体 MeshComponent 'BodyMesh'）是合法的多实例，不警告
    const dup = this.components.find(
      (c) => c.constructor === component.constructor && c.name === component.name,
    )
    if (dup) {
      logger.warn(
        `[AObject] 警告: ${this.constructor.name} 已存在同名组件 ${component.constructor.name}("${component.name}")，` +
        `再次添加可能导致行为重复（如点击回调绑定两次）。` +
        `来源: ${(dup as { uid?: number }).uid ?? '-'} → 新添加 @${(component as { uid?: number }).uid ?? '-'}`,
      )
    }
    // 一个 Actor 只能挂一个 mesh（MeshComponent / CapsuleMeshComponent 及子类）：
    // 组合多个网格必须拆成子 Actor（每个子 Actor 一个 MeshComponent），
    // 保证 Inspector/撤回系统能精确对应"一个 actor ↔ 一个几何"。
    const isMeshComponent = (c: AObjectComponent): boolean => {
      const n = c.constructor.name
      return n === 'MeshComponent' || n.endsWith('MeshComponent')
    }
    if (isMeshComponent(component)) {
      const existing = this.components.find(isMeshComponent)
      if (existing) {
        logger.error(
          `[AObject] 拒绝挂载: ${this.constructor.name} 已有 ${existing.constructor.name}("${existing.name}")，` +
          `一个 Actor 只能挂载一个 MeshComponent（组合网格请拆成子 Actor，如 new GenericActor(...) + attachTo 挂到本 Actor 下）。` +
          `被拒: ${component.constructor.name}("${(component as { name?: string }).name}")`,
        )
        return component
      }
    }
    this.components.push(component)
    return component
  }

  /** 移除组件 */
  removeComponent(component: AObjectComponent): void {
    const idx = this.components.indexOf(component)
    if (idx < 0) return
    this.components.splice(idx, 1)
  }

  getComponents<T extends AObjectComponent>(type: new (...args: any[]) => T): T[] {
    return this.components.filter((c) => c instanceof type) as T[]
  }

  getComponent<T extends AObjectComponent>(type: new (...args: any[]) => T): T | null {
    return this.components.find((c) => c instanceof type) as T ?? null
  }

  /** 获取全部组件实例（Inspector/持久化遍历用） */
  getAllComponents(): AObjectComponent[] {
    return [...this.components]
  }
}
