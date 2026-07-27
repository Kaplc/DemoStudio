/**
 * Actor — 世界中的基础实体
 * 模仿 UE Actor，拥有 Transform、生命周期、Component 挂载
 */
import * as THREE from 'three'
import type { Component } from './Component'
import type { World } from '../gameflow/World'
import type { PropertyPatch } from '../tools/deepMerge'
import { clonePatch } from '../tools/deepMerge'

export abstract class Actor {
  /** 全局唯一整数 ID，每个 Actor 构造时自动分配 */
  public readonly uid: number

  public readonly name: string
  public readonly root: THREE.Group
  public world: World | null = null

  /** Actor 生命周期 */
  public bHasBegunPlay = false
  public bPendingDestroy = false

  /** Blueprint 实例元数据（由 SpawnActorFromBlueprint 设置；非蓝图实例为 null） */
  public blueprintRef: { id: string; overrides?: PropertyPatch } | null = null
  /** 由 ref 子节点生成，大纲中不展开其内部子 Actor */
  public isRefInstance = false

  private static _nextUid = 1

  private components: Component[] = []
  private children: Actor[] = []
  private _parent: Actor | null = null

  constructor(name = 'Actor') {
    this.uid = Actor._nextUid++
    this.name = name
    this.root = new THREE.Group()
    this.root.name = name
    this.root.userData.actorRef = this
    this.root.userData.actorUid = this.uid
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

  // ═══════════════════════════════════
  //  Blueprint 数据驱动
  // ═══════════════════════════════════

  /**
   * 应用属性补丁（Blueprint 实例化注入 CDO 默认值、运行时覆盖共用）。
   *
   * 先解析约定 transform 字段（position / rotation / scale，number[3]）调对应 setter，
   * 剩余字段深拷贝后交给 applyCustomDefaults（行为类 override 读取自定义参数）。
   *
   * 注意：本方法不触碰 world / 不构建几何；行为类的几何构建仍留 BeginPlay。
   */
  applyPatch(patch: PropertyPatch): void {
    const pos = patch.position
    if (Array.isArray(pos)) this.setPosition(pos[0], pos[1], pos[2])
    const rot = patch.rotation
    if (Array.isArray(rot)) this.setRotation(rot[0], rot[1], rot[2])
    const scl = patch.scale
    if (Array.isArray(scl)) this.setScale(scl[0], scl[1], scl[2])

    const rest: PropertyPatch = {}
    for (const k of Object.keys(patch)) {
      if (k !== 'position' && k !== 'rotation' && k !== 'scale') rest[k] = patch[k]
    }
    if (Object.keys(rest).length > 0) {
      this.applyCustomDefaults(clonePatch(rest))
    }
  }

  /**
   * 子类 override：从补丁读取自定义参数（如 FishHouseActor 读 houseSize / houseColors）。
   * 默认实现忽略。约束：只赋值字段，绝不触碰 world 或构建几何。
   * 收到的 patch 已是深拷贝，可安全直接赋值。
   */
  applyCustomDefaults(_patch: PropertyPatch): void {}

  // ═══════════════════════════════════
  //  序列化（为未来场景保存预留；当前存档系统不遍历调用）
  // ═══════════════════════════════════

  /** 序列化：默认仅 name + transform，子类 override 追加自定义数据 */
  serialize(): Record<string, unknown> {
    return {
      name: this.name,
      position: [this.position.x, this.position.y, this.position.z],
      rotation: [this.rotation.x, this.rotation.y, this.rotation.z],
      scale: [this.scale.x, this.scale.y, this.scale.z],
    }
  }

  /** 反序列化：默认仅恢复 transform（name 在构造时确定） */
  deserialize(data: Record<string, unknown>): void {
    const pos = data.position as [number, number, number] | undefined
    if (pos) this.setPosition(pos[0], pos[1], pos[2])
    const rot = data.rotation as [number, number, number] | undefined
    if (rot) this.setRotation(rot[0], rot[1], rot[2])
    const scl = data.scale as [number, number, number] | undefined
    if (scl) this.setScale(scl[0], scl[1], scl[2])
  }
}
