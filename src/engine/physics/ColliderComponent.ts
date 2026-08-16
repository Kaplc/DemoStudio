/**
 * ColliderComponent — 碰撞体组件基类（抽象）
 *
 * 挂载到 Actor 上，BeginPlay 时创建 cannon body 注册进 PhysicsWorld，
 * EndPlay 自动销毁注销。三个派生类：
 *  - BoxColliderComponent      盒形碰撞体（建筑等）
 *  - CircleColliderComponent   圆形碰撞体（球状物体）
 *  - CapsuleColliderComponent  胶囊碰撞体（兵等角色）
 *
 * 设计要点（俯视角玩法）：
 *  - y 轴锁定：dynamic 兵每帧回写时强制 y + 旋转归零（无重力弹跳/倾倒）
 *  - body 为碰撞权威：dynamic 模式下 body.position 回写 actor.root（渲染跟随）；
 *    static 模式只从 actor.root 读一次（生成时同步）
 *  - 碰撞事件：PhysicsWorld 步进后统一分发，经 onCollisionEnter/Exit/Stay 委托字段回调
 *
 * 挂载方式（蓝图组件机制）：baseClass 用具体派生类名，properties 传尺寸/类型/分层。
 */
import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { ActorComponent } from '../entity/ActorComponent'
import type { EditableProperty } from '../entity/ActorComponent'
import type { Actor } from '../entity/Actor'
import { PhysicsWorld, COLLISION_LAYER_GROUPS } from './PhysicsWorld'

/** 碰撞体驱动类型 */
export type ColliderBodyType = 'static' | 'dynamic'

/** 碰撞事件负载（对方碰撞体 + 其 owner） */
export interface CollisionEvent {
  /** 碰撞对方碰撞体组件 */
  other: ColliderComponent
}

export abstract class ColliderComponent extends ActorComponent {
  // ─── 碰撞事件委托（脚本组件在 BeginPlay 时订阅）───
  onCollisionEnter: ((e: CollisionEvent) => void) | null = null
  onCollisionExit: ((e: CollisionEvent) => void) | null = null
  onCollisionStay: ((e: CollisionEvent) => void) | null = null

  // ─── 可配置属性（蓝图 properties / Inspector 可编辑）───
  /** 刚体类型：static 建筑用（不动）；dynamic 兵用（会被推挤） */
  bodyType: ColliderBodyType = 'static'
  /** 质量（dynamic 时生效；static 恒视为无穷大） */
  mass = 1
  /** 碰撞层名（COLLISION_LAYER_GROUPS key：default/troop/building） */
  group = 'default'
  /** 碰撞掩码层名列表（与哪些层碰撞；空数组 = 全部） */
  mask: string[] = []
  /** 碰撞体中心相对 owner.root 的偏移 */
  offset: [number, number, number] = [0, 0, 0]
  /** 线性阻尼（dynamic：速度衰减，越大停得越快） */
  linearDamping = 0.4
  /** 是否锁定 y（俯视角玩法默认锁：禁弹跳） */
  lockY = true

  /** 创建好的 cannon body（BeginPlay 后有值；EndPlay 置 null） */
  body: CANNON.Body | null = null

  constructor(owner: Actor) {
    super(owner)
    this.name = 'ColliderComponent'
  }

  // ─── 子类实现 ───

  /** 由派生类创建 cannon 形状（Box/Cylinder-Sphere 组合等） */
  protected abstract createShape(): CANNON.Shape | null

  /** 碰撞体 xz 平面投影半径（查询 API 用：AABB 圆近似） */
  abstract get boundRadiusXZ(): number

  // ─── 生命周期 ───

  override BeginPlay(): void {
    super.BeginPlay()
    // 游戏运行态检查：编辑器预览 World（蓝图/场景预览）同样会 BeginPlay，但不注册 body
    if (!PhysicsWorld.enabled || !PhysicsWorld.active) return
    const shape = this.createShape()
    if (!shape) return
    const world = PhysicsWorld.world
    if (!world) return

    // 位置基准：顶层 Actor（碰撞体挂在模型子 Actor 时，物理位置应取实体根部）
    let top = this.owner
    while (top.parent) top = top.parent
    const pos = top.root.position
    const isStatic = this.bodyType === 'static'
    const body = new CANNON.Body({
      mass: isStatic ? 0 : Math.max(0.01, this.mass), // cannon: mass=0 即 static
      shape,
      position: new CANNON.Vec3(pos.x + this.offset[0], pos.y + this.offset[1], pos.z + this.offset[2]),
      type: isStatic ? CANNON.Body.STATIC : CANNON.Body.DYNAMIC,
    })
    // 碰撞分层（group/mask 层名 → 位）
    body.collisionFilterGroup = COLLISION_LAYER_GROUPS[this.group] ?? COLLISION_LAYER_GROUPS.default
    const maskBits = this.mask.length > 0
      ? this.mask.reduce((acc, n) => acc | (COLLISION_LAYER_GROUPS[n] ?? 0), 0)
      : -1 // 全部
    body.collisionFilterMask = maskBits
    // 动态体参数：高阻尼 + 锁旋转（俯视角：永不翻倒）
    if (!isStatic) {
      body.linearDamping = this.linearDamping
      body.angularDamping = 1
      body.fixedRotation = true
      body.updateMassProperties()
    }
    this.body = body
    PhysicsWorld.registerCollider(this)
  }

  override EndPlay(): void {
    PhysicsWorld.unregisterCollider(this)
    this.body = null
    super.EndPlay()
  }

  override Tick(_dt: number): void {
    // dynamic：body 为碰撞权威，回写顶层 Actor（沿 parent 链上溯——
    // 碰撞体常挂在蓝图模型（子 Actor）上，而物理应驱动整个实体根；
    // lockY 时保留原 y（俯视角无重力，模型悬空偏移不被覆盖））
    const body = this.body
    if (!body || this.bodyType !== 'dynamic') return
    let top = this.owner
    while (top.parent) top = top.parent
    top.root.position.x = body.position.x - this.offset[0]
    top.root.position.z = body.position.z - this.offset[2]
    if (!this.lockY) top.root.position.y = body.position.y - this.offset[1]
  }

  /**
   * 脚本注入移动速度（dynamic 兵每帧调用）：
   * 速度向量直接写入 body.velocity（引擎负责推挤/阻尼）。
   */
  setVelocity(vx: number, vz: number): void {
    if (!this.body || this.bodyType !== 'dynamic') return
    this.body.wakeUp()
    this.body.velocity.x = vx
    this.body.velocity.z = vz
  }

  /**
   * static 建筑被移动（基地拖动放置）后同步碰撞体位置。
   */
  syncStaticPosition(): void {
    if (!this.body || this.bodyType !== 'static') return
    let top = this.owner
    while (top.parent) top = top.parent
    const pos = top.root.position
    this.body.position.set(pos.x + this.offset[0], pos.y + this.offset[1], pos.z + this.offset[2])
    this.body.aabbNeedsUpdate = true
  }

  /** 调试 gizmos 绘制中心缓存（派生类 OnDrawGizmos 用） */
  protected _gizmoCenter = new THREE.Vector3()

  // Inspector 属性展示
  override getProperties(): Record<string, unknown> {
    return {
      bodyType: this.bodyType,
      mass: this.mass,
      group: this.group,
      mask: this.mask.join(','),
      offset: `[${this.offset.join(', ')}]`,
      hasBody: this.body !== null,
    }
  }

  /** 通用可编辑属性（bodyType/mass/group/mask 及派生类尺寸），Inspector 编辑 + 蓝图持久化 */
  override getEditableProperties(): EditableProperty[] {
    return [
      {
        key: 'bodyType', type: 'enum', options: ['static', 'dynamic'],
        get: () => this.bodyType,
        set: (v) => { this.bodyType = v as ColliderBodyType },
      },
      {
        key: 'mass', type: 'number', min: 0.01, step: 0.1,
        get: () => this.mass,
        set: (v) => { this.mass = v as number },
      },
      {
        key: 'group', type: 'enum', options: Object.keys(COLLISION_LAYER_GROUPS),
        get: () => this.group,
        set: (v) => { this.group = v as string },
      },
      {
        key: 'mask', type: 'string',
        get: () => this.mask.join(','),
        set: (v) => { this.mask = String(v).split(',').map((s) => s.trim()).filter(Boolean) },
      },
      {
        key: 'linearDamping', type: 'number', min: 0, step: 0.05,
        get: () => this.linearDamping,
        set: (v) => { this.linearDamping = v as number },
      },
      {
        // 数组型 offset 持久化：getPersistentProps 默认实现直接读 get()，vec3 类型的 Inspector 控件可编辑
        key: 'offset', type: 'vec3', persistent: true,
        get: () => [this.offset[0], this.offset[1], this.offset[2]] as [number, number, number],
        set: (v) => { const a = v as [number, number, number]; this.offset = [a[0], a[1], a[2]] },
      },
    ]
  }
}
