/**
 * BObject — 世界对象的通用基类
 *
 * 模仿 UE UObject：世界内一切对象的根基，提供：
 *  - name：标识名
 *  - 组件系统（继承自 AObject）
 *  - 生命周期：BeginPlay / Tick / EndPlay
 *  - 序列化（预留）
 *
 * 注意：uid（全局唯一整数）已上移至 OObject，所有引擎对象统一分配。
 * world 引用属于场景对象（Actor），非场景对象（GameMode 等）自行持有。
 *
 * 分层：
 *   OObject（uid + 注册表 + 销毁标记）
 *    └── AObject（组件系统）
 *         └── BObject（本类：+ name + 生命周期 + 序列化，无渲染依赖）
 *              ├── Actor（场景对象：+ root/Transform/可见性/层级 + world 引用）
 *              ├── PlayerController / GameMode / GameState（非场景对象）
 */
import { AObject } from './AObject'
import type { BObjectComponent } from './BObjectComponent'

export abstract class BObject extends AObject {
  public readonly name: string

  /** 生命周期状态 */
  public bHasBegunPlay = false
  public bPendingDestroy = false

  constructor(name = 'BObject') {
    super()
    this.name = name
  }

  // ═══════════════════════════════════
  //  生命周期
  // ═══════════════════════════════════

  /** 游戏开始，所有组件就绪后调用一次 */
  BeginPlay(): void {
    if (this.bHasBegunPlay) return
    this.bHasBegunPlay = true
    for (const c of this.getAllComponents()) {
      if (c.bEnabled) c.BeginPlay()
    }
  }

  /** 每帧更新 */
  Tick(_deltaTime: number): void {
    if (this.bPendingDestroy) return
    for (const c of this.getAllComponents()) {
      if (c.bEnabled) c.Tick(_deltaTime)
    }
  }

  /** 绘制调试 Gizmos（由 World 每帧调用，可重写） */
  OnDrawGizmos(): void {}

  /** 引擎入口：绘制自身 + 所有启用 Component 的 Gizmos */
  drawGizmos(): void {
    this.OnDrawGizmos()
    for (const c of this.getAllComponents()) {
      if (c.bEnabled) c.OnDrawGizmos()
    }
  }

  /** 销毁前调用 */
  EndPlay(): void {
    const comps = this.getAllComponents()
    for (let i = comps.length - 1; i >= 0; i--) {
      comps[i].EndPlay()
    }
    this.bHasBegunPlay = false
    // 终态死亡标记 + 从全局注册表注销（幂等；允许重复 EndPlay）
    this.markDestroyed()
  }

  // ═══════════════════════════════════
  //  Component 管理（覆写：BObject 组件收窄为 BObjectComponent，BeginPlay 后挂载自动 BeginPlay）
  // ═══════════════════════════════════

  // 方法参数双变（method bivariance）：参数从 AObjectComponent 收窄为 BObjectComponent，
  // BObject 挂载的组件均有生命周期钩子，可直接调用 BeginPlay/EndPlay
  override addComponent(component: BObjectComponent): BObjectComponent
  /**
   * 类版（推荐）：传入组件类，内部自动 new Cls(this, ...args)（owner 自动传入），
   * 保留"BeginPlay 后挂载自动 BeginPlay"行为。
   * ...args 与组件构造参数严格类型匹配（编译期检查，非 any 透传）。
   */
  addComponent<T extends BObjectComponent, Args extends unknown[]>(
    Cls: new (owner: this, ...args: Args) => T,
    ...args: Args
  ): T
  override addComponent(
    componentOrCls: BObjectComponent | (new (...args: any[]) => BObjectComponent),
    ...args: unknown[]
  ): BObjectComponent {
    // 类版：自动实例化（owner 自动传入）；实例版：直接使用
    const component: BObjectComponent =
      typeof componentOrCls === 'function' ? new componentOrCls(this, ...args) : componentOrCls
    super.addComponent(component)
    if (this.bHasBegunPlay && component.bEnabled) {
      component.BeginPlay()
    }
    return component
  }

  override removeComponent(component: BObjectComponent): void {
    super.removeComponent(component)
    if (this.bHasBegunPlay) component.EndPlay()
  }
  /** 组件列表收窄为 BObjectComponent（生命周期钩子 BeginPlay/Tick/EndPlay 存在） */
  override getAllComponents(): BObjectComponent[] {
    return super.getAllComponents() as BObjectComponent[]
  }
  // ═══════════════════════════════════
  //  序列化（为未来场景保存预留；当前存档系统不遍历调用）
  // ═══════════════════════════════════

  /** 序列化：默认仅 name，子类 override 追加自定义数据 */
  serialize(): Record<string, unknown> {
    return { name: this.name }
  }

  /** 反序列化（name 在构造时确定，默认空实现） */
  deserialize(_data: Record<string, unknown>): void {}
}
