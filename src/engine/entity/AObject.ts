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

  addComponent(component: AObjectComponent): AObjectComponent {
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
