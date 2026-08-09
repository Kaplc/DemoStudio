/**
 * OObject — 引擎对象体系的最顶层基类
 *
 * 所有引擎对象（AObject/BObject/Actor/GameMode/...）统一收拢到 OObject 名下，
 * 提供：
 *  - 全局注册：构造时自动注册到 ObjectRegistry（模仿 UE GUObjectArray）
 *  - 销毁标记：markDestroyed 置位终态 + 从注册表注销（模仿 UE IsValid / Unity 伪 null）
 *  - 访问断言：assertValid() 在对象已销毁时抛错（模仿 UE check/ensure —— 早期暴露
 *    "已销毁对象被调用"，避免静默失败导致旧 world 被驱动等诡异 bug）
 *
 * 注意：bDestroyed 是"终态死亡证明"（EndPlay/destroy 后置位），
 * 与 BObject.bPendingDestroy（排队中，等 tick 提交）语义不同：
 *   bPendingDestroy（排队中）→ EndPlay（清理）→ bDestroyed（死亡）
 *
 * 分层：
 *   OObject（本类：注册表 + 销毁标记 + 访问断言）
 *    └── AObject（+ 组件系统）
 *         └── BObject（+ uid/name + 生命周期 + 序列化）
 *              ├── Actor（场景对象）
 *              ├── GameMode / GameState / PlayerController（非场景对象）
 */
import { ObjectRegistry } from '../tools/ObjectRegistry'

export abstract class OObject {
  /** 是否已销毁（终态标记；任何外部引用都应停止使用） */
  private _bDestroyed = false

  constructor() {
    // 自动注册到全局对象表（销毁时由 markDestroyed 注销）
    ObjectRegistry.register(this)
  }

  get bDestroyed(): boolean {
    return this._bDestroyed
  }

  /** 对象是否仍有效（等价 UE IsValid / Unity 伪 null 判断） */
  isDestroyed(): boolean {
    return this._bDestroyed
  }

  /**
   * 访问断言：对象已销毁时抛出明确错误（模仿 UE check/ensure）。
   * 所有"外部可能持有引用"的入口（回调、跨对象调用）应调用此方法，
   * 让"已销毁对象被访问"第一时间暴露，而不是静默执行导致诡异 bug。
   * @param action 当前操作描述（错误信息用）
   */
  assertValid(action = '访问'): void {
    if (this._bDestroyed) {
      const cls = (this.constructor as { name?: string })?.name ?? 'OObject'
      throw new Error(
        `[${cls}] 已销毁对象被${action}：对象已 markDestroyed，但仍有外部引用在调用它。` +
        `请检查持有引用的回调/单例是否在销毁时解绑（bDestroyed / GameSingleton.reset / reclaimForWorld）。`,
      )
    }
  }

  /** 标记为已销毁（由销毁流程调用；幂等）：置位 + 从全局注册表注销 */
  markDestroyed(): void {
    if (this._bDestroyed) return
    this._bDestroyed = true
    ObjectRegistry.unregister(this)
  }
}
