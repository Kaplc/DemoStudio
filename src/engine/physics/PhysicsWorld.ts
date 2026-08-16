/**
 * PhysicsWorld — 引擎物理世界（Game 级 GameSingleton）
 *
 * 内部持有 cannon-es World，承载刚体模拟：
 *  - 固定步长 1/60 + accumulator（不直接 step(dt)，防大 dt 穿透/不稳定）
 *  - 碰撞体组件（BoxColliderComponent 等）BeginPlay 创建 body 并注册至此，
 *    EndPlay 自动注销；body.position/rotation 回写 actor.root（body 为碰撞权威）
 *  - 碰撞事件（Enter/Exit/Stay）经组件公开委托字段分发（Unity 式）
 *  - 查询 API（overlapTest / queryAll）供基地放置冲突、脚本按需调用
 *
 * 生命周期：Game.launch 注册进单例表，Game.shutdown 统一 reset 回收
 * （与 PhySys 同生命周期）。初始化失败时禁用物理（游戏可继续，仅无碰撞）。
 */
import * as CANNON from 'cannon-es'
import * as THREE from 'three'
import { logger } from '../Logger'
import type { GameSingleton } from '../gameflow/Game'
import type { ColliderComponent } from './ColliderComponent'

/** 固定物理步长（秒）：1/60，与帧率解耦 */
const FIXED_STEP = 1 / 60
/** 单帧最大模拟时长（秒）：防页面 hidden 后恢复时大 dt 连击步进（最多 3 步） */
const MAX_FRAME_TIME = FIXED_STEP * 3

/** 碰撞层定义：cannon collisionFilterGroup 用 2 的幂（1 保留给 Ground/默认） */
export const CollisionLayer = {
  /** 默认层（未配置 group 的碰撞体） */
  DEFAULT: 1,
  /** 兵层 */
  TROOP: 2,
  /** 建筑层 */
  BUILDING: 4,
} as const

/** 层名 → group 位（组件属性 group/mask 用字符串名配置；扩展新层在此追加） */
export const COLLISION_LAYER_GROUPS: Record<string, number> = {
  default: CollisionLayer.DEFAULT,
  troop: CollisionLayer.TROOP,
  building: CollisionLayer.BUILDING,
}

/** 查询命中的碰撞体信息（overlapTest / queryAll 返回） */
export interface OverlapHit {
  /** 命中的碰撞体组件（owner 可经 comp.owner 获取） */
  collider: ColliderComponent
  /** 该碰撞体的 cannon body */
  body: CANNON.Body
}

class PhysicsWorldImpl implements GameSingleton {
  readonly name = 'PhysicsWorld'

  /** cannon 世界（初始化失败时为 null：物理禁用，所有接口静默降级） */
  private _world: CANNON.World | null = null
  /** 物理是否可用（World 创建成功即 true） */
  private _enabled = false
  /**
   * 是否处于游戏运行态（Game.launch 激活 / Game.shutdown 复原）。
   * 编辑器预览 World（蓝图/场景/UI 预览）同样会 BeginPlay 碰撞体组件，
   * 但不应把 body 注册进全局物理世界（防污染游戏运行时），
   * 因此碰撞体 BeginPlay 前必须检查本标志。
   */
  private _active = false
  /** 步长累计器（accumulator 固定步长模式） */
  private _accumulator = 0
  /** 暂停标记（Game 暂停时物理同步暂停） */
  private _paused = false

  /** 已注册碰撞体组件集合（查询 API 遍历用） */
  private _colliders = new Set<ColliderComponent>()

  /** 与 cannon world 一一对应的接触对键集合（碰撞事件 Enter/Exit 判定） */
  private _contactPairs = new Map<string, { a: ColliderComponent; b: ColliderComponent }>()

  constructor() {
    this.init()
  }

  /** 初始化 cannon 世界（构造时调用一次；失败降级禁用物理） */
  private init(): void {
    try {
      const world = new CANNON.World({
        gravity: new CANNON.Vec3(0, 0, 0), // 俯视角玩法：无重力（y 由组件锁定）
      })
      // 宽相位：SAP（轴扫掠）对 100+ 动态刚体效率好，cannon-es 内置
      world.broadphase = new CANNON.SAPBroadphase(world)
      // 允许休眠：静止刚体跳过求解（兵站桩不烧 CPU）
      world.allowSleep = true
      this._world = world
      this._enabled = true
      logger.info('[PhysicsWorld] cannon-es 物理世界已初始化（固定步长 1/60，重力 0）')
    } catch (e) {
      logger.error(`[PhysicsWorld] 初始化失败，物理已禁用: ${(e as Error).message}`)
      this._world = null
      this._enabled = false
    }
  }

  /** 物理是否可用（禁用时所有接口静默降级，游戏可继续） */
  get enabled(): boolean {
    return this._enabled && this._world !== null
  }

  /** 是否处于游戏运行态（碰撞体组件 BeginPlay 前检查；预览模式 false） */
  get active(): boolean {
    return this._active
  }

  /** 激活游戏运行态（Game.launch 调用；物理才真正开始接收碰撞体注册与步进） */
  begin(): void {
    if (this._active) return
    this._active = true
    logger.info('[PhysicsWorld] 物理已激活（游戏运行态）')
  }

  /** 内部 cannon world（碰撞体组件创建 body 用；禁用时 null） */
  get world(): CANNON.World | null {
    return this._world
  }

  /** 已注册碰撞体数量（日志/调试） */
  get colliderCount(): number {
    return this._colliders.size
  }

  // ═══════════════════════════════════
  //  碰撞体注册（组件 BeginPlay/EndPlay 调用）
  // ═══════════════════════════════════

  /** 注册碰撞体（body 已由组件创建好，此处入 world + 注册表） */
  registerCollider(comp: ColliderComponent): void {
    if (!this.enabled || !this._world) return
    this._colliders.add(comp)
    if (comp.body && !this._world.bodies.includes(comp.body)) {
      this._world.addBody(comp.body)
    }
    logger.info(`[PhysicsWorld] 注册碰撞体: ${comp.owner.name}.${comp.persistType}（共 ${this._colliders.size} 个）`)
  }

  /** 注销碰撞体（EndPlay 调用；body 从 world 移除，接触对清理） */
  unregisterCollider(comp: ColliderComponent): void {
    if (!this._colliders.has(comp)) return
    this._colliders.delete(comp)
    if (comp.body && this._world) {
      this._world.removeBody(comp.body)
    }
    // 清理涉及该碰撞体的接触对（防 Exit 事件丢失/残留引用）
    for (const [key, pair] of this._contactPairs) {
      if (pair.a === comp || pair.b === comp) this._contactPairs.delete(key)
    }
  }

  // ═══════════════════════════════════
  //  步进（固定步长 + accumulator）
  // ═══════════════════════════════════

  /**
   * 每帧步进（由 collider 组件 Tick 之外的统一驱动点调用；本项目挂 World 每 tick）。
   * accumulator 模式：累计 dt，每次消耗一个 FIXED_STEP 执行 world.step。
   * @returns 是否实际执行了步进（暂停/禁用时 false）
   */
  step(dt: number): boolean {
    if (!this.enabled || !this._world || this._paused || !this._active) return false
    this._accumulator += Math.min(dt, MAX_FRAME_TIME)
    let stepped = false
    while (this._accumulator >= FIXED_STEP) {
      this._world.step(FIXED_STEP)
      this._accumulator -= FIXED_STEP
      stepped = true
    }
    if (stepped) this.dispatchCollisionEvents()
    return stepped
  }

  // ═══════════════════════════════════
  //  碰撞事件（Enter / Exit / Stay）
  // ═══════════════════════════════════

  /** 步进后收集当前帧接触对，与上一帧对比触发 Enter/Exit，持续接触触发 Stay */
  private dispatchCollisionEvents(): void {
    const world = this._world
    if (!world) return
    const current = new Map<string, { a: ColliderComponent; b: ColliderComponent }>()
    // 遍历窄相位生成的接触：a.body / b.body → 反查碰撞体组件
    for (const contact of world.contacts) {
      const compA = this.findColliderByBody(contact.bi)
      const compB = this.findColliderByBody(contact.bj)
      if (!compA || !compB) continue
      const key = this.pairKey(compA, compB)
      if (!current.has(key)) current.set(key, { a: compA, b: compB })
    }
    // Exit：上一帧有、本帧无
    for (const [key, pair] of this._contactPairs) {
      if (!current.has(key)) {
        pair.a.onCollisionExit?.({ other: pair.b })
        pair.b.onCollisionExit?.({ other: pair.a })
        this._contactPairs.delete(key)
      }
    }
    // Enter + Stay
    for (const [key, pair] of current) {
      const isNew = !this._contactPairs.has(key)
      if (isNew) {
        pair.a.onCollisionEnter?.({ other: pair.b })
        pair.b.onCollisionEnter?.({ other: pair.a })
      } else {
        pair.a.onCollisionStay?.({ other: pair.b })
        pair.b.onCollisionStay?.({ other: pair.a })
      }
    }
    this._contactPairs = current
  }

  /** body → 碰撞体组件（world.contacts 的 bi/bj 是 body） */
  private findColliderByBody(body: CANNON.Body): ColliderComponent | null {
    for (const c of this._colliders) {
      if (c.body === body) return c
    }
    return null
  }

  /** 接触对稳定键（uid 小的在前，保证 a-b 与 b-a 同键） */
  private pairKey(a: ColliderComponent, b: ColliderComponent): string {
    return a.uid < b.uid ? `${a.uid}-${b.uid}` : `${b.uid}-${a.uid}`
  }

  // ═══════════════════════════════════
  //  查询 API（基地放置冲突 / 脚本按需调用）
  // ═══════════════════════════════════

  /**
   * 圆形范围查询：返回中心 pos 附近 radius 内（x/z 平面圆 vs 碰撞体 AABB 投影圆近似）
   * 的所有碰撞体。放置冲突/范围技能够用，不做精确形状相交。
   */
  queryAll(pos: THREE.Vector3, radius: number, opts?: { group?: number }): OverlapHit[] {
    const hits: OverlapHit[] = []
    if (!this.enabled) return hits
    for (const c of this._colliders) {
      const body = c.body
      if (!body) continue
      if (opts?.group !== undefined && !(body.collisionFilterGroup & opts.group)) continue
      const dx = body.position.x - pos.x
      const dz = body.position.z - pos.z
      const rSum = radius + c.boundRadiusXZ
      if (dx * dx + dz * dz <= rSum * rSum) {
        hits.push({ collider: c, body })
      }
    }
    return hits
  }

  /**
   * 盒重叠测试：以 pos 为中心、halfSize 为半尺寸（x/z 平面 AABB）的盒子
   * 与已注册碰撞体（x/z AABB 投影）是否重叠。
   * @param opts.exclude 排除的碰撞体（如正在移动中的建筑自己的碰撞体）
   * @param opts.group 只检测指定碰撞层（如仅建筑层）
   */
  overlapTest(
    pos: THREE.Vector3,
    halfSizeX: number,
    halfSizeZ: number,
    opts?: { exclude?: ColliderComponent; group?: number },
  ): boolean {
    if (!this.enabled) return false
    for (const c of this._colliders) {
      if (opts?.exclude && c === opts.exclude) continue
      const body = c.body
      if (!body) continue
      if (opts?.group !== undefined && !(body.collisionFilterGroup & opts.group)) continue
      const r = c.boundRadiusXZ
      if (
        Math.abs(body.position.x - pos.x) < halfSizeX + r &&
        Math.abs(body.position.z - pos.z) < halfSizeZ + r
      ) {
        return true
      }
    }
    return false
  }

  // ═══════════════════════════════════
  //  暂停 / 回收（GameSingleton）
  // ═══════════════════════════════════

  /** 暂停/恢复物理模拟（Game 暂停时同步暂停） */
  setPaused(paused: boolean): void {
    if (this._paused === paused) return
    this._paused = paused
    logger.info(`[PhysicsWorld] 物理${paused ? '已暂停' : '已恢复'}`)
  }

  /** GameSingleton：游戏停止时回收运行状态（清 body/注册表/接触对/累计器） */
  reset(): void {
    this._active = false
    if (this._world) {
      // 逐个移除 body（碰撞体组件 EndPlay 已各自移除，这里兜底清空）
      while (this._world.bodies.length > 0) {
        this._world.removeBody(this._world.bodies[0])
      }
    }
    this._colliders.clear()
    this._contactPairs.clear()
    this._accumulator = 0
    this._paused = false
    logger.info('[PhysicsWorld] 物理世界已回收')
  }
}

/** 物理世界全局单例（与 PhySys 平级，生命周期绑定 Game） */
export const PhysicsWorld = new PhysicsWorldImpl()
