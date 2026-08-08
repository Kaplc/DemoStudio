/**
 * BaseObject — 世界对象的通用基类
 *
 * 模仿 UE UObject：世界内一切对象的根基，提供：
 *  - uid / name：唯一标识
 *  - world：所属 World 引用
 *  - 生命周期：BeginPlay / Tick / EndPlay / destroy
 *  - 组件系统：addComponent / getComponent / getComponents（组件可挂任意 BaseObject）
 *  - 序列化（预留）
 *
 * 分层：
 *   BaseObject（本类，无渲染依赖）
 *    ├── Actor（场景对象：+ root/Transform/可见性/层级）
 *    ├── PlayerController / GameMode / GameState（非场景对象）
 */
import type { Component } from './Component'
import type { World } from '../gameflow/World'

export abstract class BaseObject {
  /** 全局唯一整数 ID，每个 BaseObject 构造时自动分配 */
  public readonly uid: number

  public readonly name: string
  public world: World | null = null

  /** 生命周期状态 */
  public bHasBegunPlay = false
  public bPendingDestroy = false

  private static _nextUid = 1

  private components: Component[] = []

  constructor(name = 'BaseObject') {
    this.uid = BaseObject._nextUid++
    this.name = name
  }

  // ═══════════════════════════════════
  //  生命周期
  // ═══════════════════════════════════

  /** 游戏开始，所有组件就绪后调用一次 */
  BeginPlay(): void {
    if (this.bHasBegunPlay) return
    this.bHasBegunPlay = true
    for (const c of this.components) {
      if (c.bEnabled) c.BeginPlay()
    }
  }

  /** 每帧更新 */
  Tick(_deltaTime: number): void {
    if (this.bPendingDestroy) return
    for (const c of this.components) {
      if (c.bEnabled) c.Tick(_deltaTime)
    }
  }

  /** 绘制调试 Gizmos（由 World 每帧调用，可重写） */
  OnDrawGizmos(): void {}

  /** 引擎入口：绘制自身 + 所有启用 Component 的 Gizmos */
  drawGizmos(): void {
    this.OnDrawGizmos()
    for (const c of this.components) {
      if (c.bEnabled) c.OnDrawGizmos()
    }
  }

  /** 销毁前调用 */
  EndPlay(): void {
    for (let i = this.components.length - 1; i >= 0; i--) {
      this.components[i].EndPlay()
    }
    this.bHasBegunPlay = false
  }

  /** 销毁自己，由 World 实际清理 */
  destroy() {
    if (this.bPendingDestroy) return
    this.bPendingDestroy = true
    if (this.world) {
      this.world.DestroyObject(this)
    }
  }

  // ═══════════════════════════════════
  //  Component 管理
  // ═══════════════════════════════════

  addComponent<T extends Component<any>>(component: T): T {
    this.components.push(component)
    if (this.bHasBegunPlay && component.bEnabled) {
      component.BeginPlay()
    }
    return component
  }

  /** 移除组件（若已 BeginPlay 则先 EndPlay） */
  removeComponent(component: Component): void {
    const idx = this.components.indexOf(component)
    if (idx < 0) return
    this.components.splice(idx, 1)
    if (this.bHasBegunPlay) component.EndPlay()
  }

  getComponents<T extends Component<any>>(type: new (...args: any[]) => T): T[] {
    return this.components.filter((c) => c instanceof type) as T[]
  }

  getComponent<T extends Component<any>>(type: new (...args: any[]) => T): T | null {
    return this.components.find((c) => c instanceof type) as T ?? null
  }

  /** 获取该 BaseObject 挂载的全部组件实例（Inspector/持久化遍历用） */
  getAllComponents(): Component[] {
    return [...this.components]
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
