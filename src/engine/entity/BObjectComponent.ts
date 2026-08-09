/**
 * BObjectComponent — BObject 组件基类（中间层）
 *
 * 在 AObjectComponent 基础上增加生命周期钩子：
 *  - BeginPlay / Tick / EndPlay / OnDrawGizmos
 * 由所属 BObject（含 Actor）的对应生命周期驱动。
 *
 * 分层：
 *   AObjectComponent（基础能力）
 *    └── BObjectComponent（本类：+ 生命周期）
 *         └── ActorComponent（+ 泛型限定 Actor，可访问 owner.root）
 */
import { AObjectComponent } from './AObjectComponent'
import type { BObject } from './BObject'

export abstract class BObjectComponent<T extends BObject = BObject> extends AObjectComponent<T> {
  /**
   * 持久化时该组件在 JSON 中对应的 baseClass 标识。
   * 约定：baseClass 直接用完整 TS 类名（如 'UITransformComponent'），
   * 默认即 this.constructor.name——组件无需任何手动标记。
   */
  get persistType(): string {
    return this.constructor.name
  }

  /** 游戏开始/激活时调用 */
  BeginPlay(): void {}
  /** 每帧调用 */
  Tick(_deltaTime: number): void {}
  /** 绘制调试 Gizmos（由所属 BObject 每帧调用，可重写） */
  OnDrawGizmos(): void {}
  /** 销毁时调用 */
  EndPlay(): void {
    // 终态死亡标记 + 从全局注册表注销（与 BObject.EndPlay 约定一致）。
    // 此前为空实现：组件 EndPlay 后仍留在 ObjectRegistry，
    // 泄漏诊断会把所有已销毁对象的组件误报为泄漏。
    this.markDestroyed()
  }
}
