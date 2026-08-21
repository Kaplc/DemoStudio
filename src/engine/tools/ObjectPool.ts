/**
 * ObjectPool — 通用对象池
 * 按需分配、复用对象，避免频繁 new/destroy 带来的 GC 开销。
 *
 * 用法：
 *   1. 目标类实现 IPoolable 接口（activate/deactivate/active）
 *   2. 创建 ObjectPool 实例，传入工厂函数（按需预热传 initialSize > 0）
 *   3. 用 pool.acquire(opts) 替代 new Xxx(opts)
 *   4. 用 pool.release(obj) 替代 obj.destroy()
 *
 * 池内对象状态：
 *   - 空闲：root.visible=false，对象不在场景中
 *   - 活跃：root.visible=true，正常参与 World Tick 和渲染
 */
/**
 * PoolableActor — 可入池的 Actor（继承 Actor，附加 IPoolable 生命周期方法）
 *
 * 对象池要求被池化对象实现 IPoolable（activate/deactivate/active），
 * 工厂返回的实例必须是 Actor 才能 spawnActor 进 World。本接口以继承形式
 * 把 IPoolable 与 Actor 合二为一，调用方直接 `class Xxx extends Actor implements IPoolable`。
 */
import type { Actor } from '../entity/Actor'

export interface IPoolable {
  /** 从池中取出时调用：用 opts 重置状态 */
  activate(opts?: any): void
  /** 放回池中时调用：清理状态、隐藏 */
  deactivate(): void
  /** 是否正在被使用 */
  active: boolean
}

/** 可入池的 Actor（必须是 Actor 且实现 IPoolable） */
export type PoolableActor = Actor & IPoolable

export class ObjectPool<T extends PoolableActor> {
  /** 所有池内对象（空闲 + 活跃） */
  private all: T[] = []
  /** 空闲对象栈 */
  private free: T[] = []

  /** 工厂函数：创建新实例 */
  private factory: () => T
  /** 池触发扩容时的最大上限，0 表示不限制 */
  private maxSize: number

  /** 总分配数（累计） */
  totalAllocated = 0
  /** 当前活跃数 */
  get activeCount(): number { return this.all.length - this.free.length }

  constructor(factory: () => T, initialSize = 0, maxSize = 0) {
    this.factory = factory
    this.maxSize = maxSize

    // 预分配
    for (let i = 0; i < initialSize; i++) {
      const obj = this.factory()
      obj.deactivate()
      this.all.push(obj)
      this.free.push(obj)
    }
  }

  /** 从池中获取一个对象（自动扩容） */
  acquire(opts?: any): T {
    if (this.free.length === 0) {
      // 扩容
      if (this.maxSize > 0 && this.all.length >= this.maxSize) {
        // 达到上限：回收最老的活跃对象
        for (const obj of this.all) {
          if (obj.active) {
            this.doRelease(obj)
            break
          }
        }
      }
      // 创建新实例
      const obj = this.factory()
      this.all.push(obj)
      this.free.push(obj)
    }

    const obj = this.free.pop()!
    obj.activate(opts)
    obj.root.visible = true
    this.totalAllocated++
    return obj
  }

  /** 将对象放回池中 */
  release(obj: T): void {
    if (!obj.active) return // 已在池中
    this.doRelease(obj)
  }

  /** 批量放回所有活跃对象 */
  releaseAll(): void {
    for (const obj of this.all) {
      if (obj.active) {
        this.doRelease(obj)
      }
    }
  }

  /** 清空整个池 */
  clear(): void {
    for (const obj of this.all) {
      if (obj.active) {
        obj.deactivate()
      }
    }
    this.all = []
    this.free = []
  }

  /** 遍历所有对象（活跃 + 空闲） */
  forEach(cb: (obj: T) => void): void {
    for (const obj of this.all) cb(obj)
  }

  /** 获取所有活跃对象 */
  getActive(): T[] {
    return this.all.filter(o => o.active)
  }

  private doRelease(obj: T): void {
    obj.deactivate()
    obj.root.visible = false
    this.free.push(obj)
  }
}
