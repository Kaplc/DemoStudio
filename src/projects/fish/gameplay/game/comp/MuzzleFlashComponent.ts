/**
 * MuzzleFlashComponent — 炮口闪光组件（炮台开炮特效）
 *
 * 组件全权自管闪光生命周期（组件优先原则，不塞进 FishCannon）：
 *  - 构造：通过 owner.addComponent(SpriteComponent) 自动创建闪光面片（引擎内部
 *    建 mesh/材质并挂 root，项目代码零裸 new），初始隐藏
 *  - flash(size)：开炮触发 —— 设定初始尺寸/不透明度并显示、重置年龄
 *  - Tick(dt)：放大 + 淡出动画（scale 按 1 + grow*age 增长；opacity 按 1 - age/ttl
 *    衰减；age ≥ ttl 自动隐藏），自管生命周期
 *
 * 每个炮台持有一个反复触发；闪光纹理为模块级共享缓存（不重复创建），
 * 面片几何为 SpriteComponent 共享单位平面，材质由引擎 ThreeObjectComponent.EndPlay
 * 自动释放（纹理为共享缓存不释放）。
 *
 * 挂载方式（FishCannon 构造）：
 *   this.addComponent(MuzzleFlashComponent)
 * 触发方式（FishCannon.tryFire）：
 *   this.getComponent(MuzzleFlashComponent)?.flash(cfg.netRadius * 2.6)
 */
import * as THREE from 'three'
import { ActorComponent, SpriteComponent, logger } from '@/engine'
import type { Actor } from '@/engine'

/** 闪光纹理（模块级共享缓存，所有炮台共用一份） */
let _flashTex: THREE.Texture | null = null
function flashTexture(): THREE.Texture {
  if (!_flashTex) {
    // 径向闪光：中心亮 → 边缘透明（与旧 makeFlashTexture 完全一致）
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 64
    const ctx = c.getContext('2d')!
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    g.addColorStop(0, 'rgba(255,250,210,0.95)')
    g.addColorStop(0.4, 'rgba(255,213,79,0.6)')
    g.addColorStop(1, 'rgba(255,213,79,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 64, 64)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    _flashTex = tex
  }
  return _flashTex
}

export class MuzzleFlashComponent extends ActorComponent {
  /** 闪光面片（组件内部创建；位置固定在炮口 (0, 1.4, 0.3)，随 owner.root 旋转自动跟随） */
  private sprite: SpriteComponent
  /** 闪光总时长（秒），外部可调 */
  ttl = 0.15
  /** 每秒放大系数（scale = 1 + grow * age），外部可调 */
  grow = 6
  /** 触发时的初始不透明度，外部可调 */
  baseOpacity = 0.9
  /** 当前闪光年龄（秒） */
  private age = 0
  /** 是否正在播放 */
  private playing = false

  constructor(owner: Actor) {
    super(owner)
    this.name = 'MuzzleFlash'
    // 闪光面片：SpriteComponent 自动建 mesh/材质并挂 root（共享单位几何，零裸 new）
    this.sprite = this.owner.addComponent(SpriteComponent, 1, 1, 'MuzzleFlashSprite')
    this.sprite.setTexture(flashTexture())
    this.sprite.setOpacity(0)
    // 与原实现一致：透明面片不写深度，避免干扰其他透明对象的渲染顺序
    ;(this.sprite.mesh.material as THREE.MeshBasicMaterial).depthWrite = false
    this.sprite.mesh.position.set(0, 1.4, 0.3) // 默认在炮口位置（朝 +Y，法线 +Z）
    this.sprite.mesh.visible = false
  }

  /** 开炮触发：设定初始尺寸/不透明度 → 显示 → 重置年龄 */
  flash(size: number): void {
    this.sprite.mesh.scale.set(size, size, 1)
    this.sprite.setOpacity(this.baseOpacity)
    this.sprite.mesh.visible = true
    this.age = 0
    this.playing = true
    logger.info(`[MuzzleFlash] ${this.owner.name} 闪光触发（初始尺寸 ${size.toFixed(2)}）`)
  }

  /** 每帧放大 + 淡出（由 owner 的 Tick 驱动）：到期自动隐藏 */
  override Tick(dt: number): void {
    if (!this.playing) return
    this.age += dt
    const k = this.age / this.ttl
    const s = 1 + this.grow * this.age
    this.sprite.mesh.scale.set(s, s, 1)
    this.sprite.setOpacity(Math.max(0, 1 - k))
    if (this.age >= this.ttl) {
      this.playing = false
      this.sprite.mesh.visible = false
    }
  }
}
