/**
 * Actor — 世界中的基础实体
 * 模仿 UE Actor，拥有 Transform、生命周期、Component 挂载
 */
import * as THREE from 'three'
import type { Component } from './Component'
import type { World } from './World'

export abstract class Actor {
  public readonly name: string
  public readonly root: THREE.Group
  public world: World | null = null

  /** Actor 生命周期 */
  public bHasBegunPlay = false
  public bPendingDestroy = false

  private components: Component[] = []
  private children: Actor[] = []
  private _parent: Actor | null = null

  constructor(name = 'Actor') {
    this.name = name
    this.root = new THREE.Group()
    this.root.name = name
    this.root.userData.actorRef = this
  }

  // ═══════════════════════════════════
  //  生命周期
  // ═══════════════════════════════════

  /** 游戏开始，所有组件就绪后调用一次 */
  BeginPlay(): void {
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
    // 递归销毁子 Actor
    for (const child of [...this.children]) {
      child.destroy()
    }
    this.bHasBegunPlay = false
  }

  /** 销毁自己，由 World 实际清理 */
  destroy() {
    if (this.bPendingDestroy) return
    this.bPendingDestroy = true
    if (this.world) {
      this.world.DestroyActor(this)
    }
  }

  // ═══════════════════════════════════
  //  Transform
  // ═══════════════════════════════════

  get position(): THREE.Vector3 { return this.root.position }
  set position(v: THREE.Vector3) { this.root.position.copy(v) }

  get rotation(): THREE.Euler { return this.root.rotation }
  set rotation(v: THREE.Euler) { this.root.rotation.copy(v) }

  get scale(): THREE.Vector3 { return this.root.scale }
  set scale(v: THREE.Vector3) { this.root.scale.copy(v) }

  setPosition(x: number, y: number, z: number) { this.root.position.set(x, y, z) }
  setRotation(x: number, y: number, z: number) { this.root.rotation.set(x, y, z) }
  setScale(x: number, y: number, z: number) { this.root.scale.set(x, y, z) }

  get actorLocation(): THREE.Vector3 {
    const v = new THREE.Vector3()
    this.root.getWorldPosition(v)
    return v
  }

  // ═══════════════════════════════════
  //  Component 管理
  // ═══════════════════════════════════

  addComponent<T extends Component>(component: T): T {
    this.components.push(component)
    if (this.bHasBegunPlay && component.bEnabled) {
      component.BeginPlay()
    }
    return component
  }

  getComponents<T extends Component>(type: new (...args: any[]) => T): T[] {
    return this.components.filter((c) => c instanceof type) as T[]
  }

  getComponent<T extends Component>(type: new (...args: any[]) => T): T | null {
    return this.components.find((c) => c instanceof type) as T ?? null
  }

  // ═══════════════════════════════════
  //  层级关系
  // ═══════════════════════════════════

  get parent(): Actor | null { return this._parent }

  attachTo(parent: Actor) {
    if (this._parent) this.detach()
    this._parent = parent
    parent.children.push(this)
    parent.root.add(this.root)
  }

  detach() {
    if (!this._parent) return
    const idx = this._parent.children.indexOf(this)
    if (idx >= 0) this._parent.children.splice(idx, 1)
    this._parent.root.remove(this.root)
    this._parent = null
  }

  getChildren(): readonly Actor[] { return this.children }

  /** 在场景中查找指定类型的 Actor（递归） */
  findActorInChildren<T extends Actor>(type: new (...args: any[]) => T): T | null {
    for (const child of this.children) {
      if (child instanceof type) return child
      const found = child.findActorInChildren(type)
      if (found) return found
    }
    return null
  }

  // ═══════════════════════════════════
  //  便利方法
  // ═══════════════════════════════════

  /** 添加到 World 的场景中（由 SpawnActor 调用） */
  addToScene(scene: THREE.Scene) {
    scene.add(this.root)
  }

  /** 从场景移除 */
  removeFromScene(scene: THREE.Scene) {
    scene.remove(this.root)
  }
}
