/**
 * ParticleEmitterComponent — 粒子发射器组件（A7 最小可用形态）
 *
 * 单发射器 CPU 更新 + THREE.Points 渲染（无 GPU instancing / sub-emitter，
 * 性能档位：单发射器几百粒）：
 *  - emit(options)：一次性爆发（打击火花/死亡迸裂/拾取闪光）
 *  - 粒子：初速（speed 区间 × spread 形状）、重力、阻尼、寿命、颜色 from→to 渐变
 *  - additive：AdditiveBlending（能量感）；缺省 Normal
 *
 * 设计取舍（反哺二期的一手结论）：
 *  - PointsMaterial 单一 size：无 per-particle size over life（用颜色渐变近似能量衰减）
 *  - Points 挂 world.scene（世界空间发射，不随 owner 移动——命中火花语义）
 *  - 固定容量环形分配（maxParticles），活粒子数 = drawRange，无 GC 压力
 *
 * 使用：comp.emit({...}) 即发即忘；owner 需 enableTick()（驱动 Tick 更新）。
 */
import * as THREE from 'three'
import { ActorComponent } from '../entity/ActorComponent'
import { ThreeObject } from './ThreeObject'
import { logger } from '../Logger'
import type { EditableProperty } from '../entity/ActorComponent'
import type { Actor } from '../entity/Actor'

/** 爆发配置（全部缺省可用） */
export interface ParticleBurstOptions {
  /** 粒子数 */
  count: number
  /** 初速大小区间 [min, max]（米/秒） */
  speed?: [number, number]
  /** 扩散形状：sphere 全向 / hemisphere 上半球 / disc 水平圆盘 */
  spread?: 'sphere' | 'hemisphere' | 'disc'
  /** 寿命区间 [min, max]（秒） */
  lifetime?: [number, number]
  /** 粒子渲染尺寸（世界单位） */
  size?: number
  /** 起始色（单色或数组随机取） */
  color?: THREE.ColorRepresentation | THREE.ColorRepresentation[]
  /** 终止色（渐变；缺省 = 起始色淡出） */
  colorTo?: THREE.ColorRepresentation
  /** 竖直加速度（负 = 下落；正 = 上飘） */
  gravity?: number
  /** 速度阻尼 0~1（每秒保留比例；0.9 = 每秒衰减 10%） */
  drag?: number
  /** 加法混合（能量/火光质感） */
  additive?: boolean
  /** 发射中心相对 owner 的偏移 */
  localOffset?: [number, number, number]
}

/** 单粒子运行时数据（结构化池，无对象分配） */
interface Particle {
  active: boolean
  x: number; y: number; z: number
  vx: number; vy: number; vz: number
  life: number
  maxLife: number
  cr0: number; cg0: number; cb0: number
  cr1: number; cg1: number; cb1: number
}

export class ParticleEmitterComponent extends ActorComponent {
  /** 粒子容量上限（单发射器档位） */
  maxParticles = 512

  private _points: ThreeObject<THREE.Points> | null = null
  private _geometry: THREE.BufferGeometry | null = null
  private _material: THREE.PointsMaterial | null = null
  private _particles: Particle[] = []
  private _positions: Float32Array | null = null
  private _colors: Float32Array | null = null
  private _activeCount = 0
  private _cursor = 0 // 环形分配游标（容量满时覆盖最老粒子）
  private _attachedScene: THREE.Scene | null = null

  constructor(owner: Actor) {
    super(owner)
    this.name = 'ParticleEmitterComponent'
    for (let i = 0; i < this.maxParticles; i++) {
      this._particles.push({
        active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        life: 0, maxLife: 1, cr0: 1, cg0: 1, cb0: 1, cr1: 1, cg1: 1, cb1: 1,
      })
    }
  }

  /** 一次性爆发（owner 世界位置 + localOffset） */
  emit(options: ParticleBurstOptions): void {
    const world = this.owner.world
    if (!world) return
    const points = this._ensureResources(world.scene)
    if (!points) return
    this._syncBlending(options.additive ?? false)

    const speedMin = options.speed?.[0] ?? 2
    const speedMax = options.speed?.[1] ?? 5
    const lifeMin = options.lifetime?.[0] ?? 0.3
    const lifeMax = options.lifetime?.[1] ?? 0.7
    const spread = options.spread ?? 'sphere'
    // 重力/阻尼为发射器级参数（单爆发器同一时刻一般只有一种火花，简化为最近一次 emit 生效）
    this._pendingGravity = options.gravity ?? -9.8
    this._pendingDrag = options.drag ?? 0
    const fromColors = Array.isArray(options.color)
      ? options.color.map((c) => new THREE.Color(c))
      : [new THREE.Color(options.color ?? '#ffffff')]
    const toColor = new THREE.Color(options.colorTo ?? (Array.isArray(options.color) ? options.color[options.color.length - 1] : options.color ?? '#ffffff'))

    const origin = new THREE.Vector3()
    this.owner.root.getWorldPosition(origin)
    if (options.localOffset) {
      origin.x += options.localOffset[0]
      origin.y += options.localOffset[1]
      origin.z += options.localOffset[2]
    }

    const count = Math.max(0, Math.min(options.count, this.maxParticles))
    for (let i = 0; i < count; i++) {
      // 环形分配：覆盖游标处粒子（容量满时最老者先亡）
      const p = this._particles[this._cursor]
      this._cursor = (this._cursor + 1) % this.maxParticles

      // 扩散方向
      let dx = 0; let dy = 0; let dz = 0
      if (spread === 'sphere') {
        dx = Math.random() * 2 - 1
        dy = Math.random() * 2 - 1
        dz = Math.random() * 2 - 1
      } else if (spread === 'hemisphere') {
        dx = Math.random() * 2 - 1
        dy = Math.random()
        dz = Math.random() * 2 - 1
      } else {
        // disc：水平圆盘均匀
        const ang = Math.random() * Math.PI * 2
        dx = Math.cos(ang)
        dz = Math.sin(ang)
      }
      const len = Math.hypot(dx, dy, dz) || 1
      const spd = speedMin + Math.random() * (speedMax - speedMin)
      const fc = fromColors[Math.floor(Math.random() * fromColors.length)]

      p.active = true
      p.x = origin.x; p.y = origin.y; p.z = origin.z
      p.vx = (dx / len) * spd
      p.vy = (dy / len) * spd
      p.vz = (dz / len) * spd
      p.maxLife = lifeMin + Math.random() * (lifeMax - lifeMin)
      p.life = p.maxLife
      p.cr0 = fc.r; p.cg0 = fc.g; p.cb0 = fc.b
      p.cr1 = toColor.r; p.cg1 = toColor.g; p.cb1 = toColor.b
    }
    points.visible = true
  }

  /** 最近一次 emit 的重力/阻尼（per-emitter 简化：单发射器同一时刻一般只有一种火花） */
  private _pendingGravity = -9.8
  private _pendingDrag = 0

  /** 惰性创建 Points 资源（挂 world.scene；EndPlay 随组件释放）。失败/已销毁返回 null */
  private _ensureResources(scene: THREE.Scene): THREE.Points | null {
    const max = this.maxParticles
    this._geometry = new THREE.BufferGeometry()
    this._positions = new Float32Array(max * 3)
    this._colors = new Float32Array(max * 3)
    this._geometry.setAttribute('position', new THREE.BufferAttribute(this._positions, 3))
    this._geometry.setAttribute('color', new THREE.BufferAttribute(this._colors, 3))
    this._geometry.setDrawRange(0, 0)
    this._material = new THREE.PointsMaterial({
      size: 0.15,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    })
    this._points = new ThreeObject(new THREE.Points(this._geometry, this._material))
    this._points.object.frustumCulled = false
    scene.add(this._points.object)
    this._attachedScene = scene
    return this._points.object
  }

  /** 切换混合模式（emit 时按 additive 选项同步） */
  private _syncBlending(additive: boolean): void {
    const want = additive ? THREE.AdditiveBlending : THREE.NormalBlending
    if (this._material && this._material.blending !== want) {
      this._material.blending = want
      this._material.needsUpdate = true
    }
  }

  override Tick(dt: number): void {
    if (!this._points || !this._positions || !this._colors || dt <= 0) return
    const dragKeep = Math.pow(1 - Math.min(1, Math.max(0, this._pendingDrag)), dt)
    const gravity = this._pendingGravity
    let n = 0
    for (const p of this._particles) {
      if (!p.active) continue
      p.life -= dt
      if (p.life <= 0) {
        p.active = false
        continue
      }
      // 运动积分
      p.vy += gravity * dt
      if (dragKeep !== 1) {
        p.vx *= dragKeep; p.vy *= dragKeep; p.vz *= dragKeep
      }
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      // 写顶点缓冲（活粒子压缩到前部）
      const t = 1 - p.life / p.maxLife
      const i3 = n * 3
      this._positions[i3] = p.x
      this._positions[i3 + 1] = p.y
      this._positions[i3 + 2] = p.z
      this._colors[i3] = p.cr0 + (p.cr1 - p.cr0) * t
      this._colors[i3 + 1] = p.cg0 + (p.cg1 - p.cg0) * t
      this._colors[i3 + 2] = p.cb0 + (p.cb1 - p.cb0) * t
      n++
    }
    this._activeCount = n
    this._geometry!.setDrawRange(0, n)
    this._geometry!.attributes.position.needsUpdate = true
    this._geometry!.attributes.color.needsUpdate = true
    this._points.object.visible = n > 0
  }

  override EndPlay(): void {
    if (this._points && this._attachedScene) {
      this._attachedScene.remove(this._points.object)
    }
    this._points?.dispose()
    this._points = null
    this._geometry = null
    this._material = null
    this._positions = null
    this._colors = null
    this._attachedScene = null
    logger.debug(`[ParticleEmitter] ${this.owner.name} 资源已释放`)
    super.EndPlay()
  }

  override getProperties(): Record<string, unknown> {
    return {
      activeParticles: this._activeCount,
      capacity: this.maxParticles,
    }
  }

  override getEditableProperties(): EditableProperty[] {
    return [
      { key: 'maxParticles', type: 'number', min: 16, step: 16, get: () => this.maxParticles, set: (v) => { this.maxParticles = Math.max(16, v as number) } },
    ]
  }
}
