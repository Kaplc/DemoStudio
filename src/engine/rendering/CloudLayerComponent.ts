/**
 * CloudLayerComponent — 行星云层壳组件（独立自转的贴图外壳）
 *
 * 挂在行星 Actor 上，生成一个半径略大于本体的贴图球壳（FrontSide 看近半球云），
 * 自带 Tick 错速自转（spin rad/s，可与本体 SphereMesh 自转不同速 → 云相对地面
 * 流动的观感）。贴图支持 asset/ 资产路径（loadTexture 缓存）与程序化 Canvas 兜底
 * （starTextures 同款：无 DOM canvas 环境自动降级纯色，不报错）。
 *
 * 分层说明（关键设计决策）：
 *  - 继承 ThreeObjectComponent 而非 MeshComponent：MeshComponent 强制一个 Actor
 *    一个 mesh，云层必须与本体 SphereMeshComponent 共存 —— 同 AtmosphereComponent
 *    的自托管外壳路径（ShadowBlobComponent 先例）。
 *  - 几何半径固定 1，scale = altitude（外壳倍率）：挂 owner.root 自动跟随天体
 *    位移；半透明（depthWrite:false）+ renderOrder 1，与大气壳共存的绘制顺序 =
 *    本体(0) → 云(1) → 大气(2)（构造时按 altitude 与大气壳相对关系取 1）。
 *  - transparent 壳不进点击：星图点击是纯数学距离判定（planetAt），与 mesh 无关。
 *
 * 蓝图声明用：
 *   { "baseClass": "CloudLayerComponent", "properties": { "texture": "asset/textures/earth_clouds.png", "altitude": 1.03, "spin": 0.02, "opacity": 0.85 } }
 */
import * as THREE from 'three'
import { ThreeObjectComponent } from './ThreeObjectComponent'
import { ThreeObject } from './ThreeObject'
import { loadTexture } from './TextureLoader'
import type { Actor } from '../entity/Actor'
import type { EditableProperty } from '../entity/ActorComponent'

/**
 * 程序化兜底云图（无 texture 路径时）：纬度带状云絮 Canvas。
 * 无 DOM canvas（单测/极简容器）返回 null → 纯色壳兜底（不报错）。
 */
function makeFallbackCloudTexture(): THREE.Texture | null {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null
  if (!canvas) return null
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const W = 512
  const H = 256
  canvas.width = W
  canvas.height = H
  // 透明底（云 = 白色斑驳，alpha 由材质 opacity 统一控制）
  ctx.clearRect(0, 0, W, H)
  let seed = 0x9e37
  const rnd = (): number => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t ^ (t >>> 14)) >>> 0
    return t / 4294967296
  }
  ctx.fillStyle = '#ffffff'
  // 三层椭圆云絮（经度环绕：x 出界回卷画第二份）
  for (const [count, rMin, rMax, alpha] of [[36, 8, 30, 0.5], [24, 4, 14, 0.65], [48, 2, 6, 0.55]] as const) {
    for (let i = 0; i < count; i++) {
      const r = rMin + rnd() * (rMax - rMin)
      const x = rnd() * W
      const y = H * 0.1 + rnd() * H * 0.8
      const sx = 1 + rnd() * 2.2 // 横向拉伸成絮状
      ctx.globalAlpha = alpha
      for (const dx of [0, -W, W]) {
        ctx.beginPath()
        ctx.ellipse(x + dx, y, r * sx, r * 0.6, 0, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
  ctx.globalAlpha = 1
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export class CloudLayerComponent extends ThreeObjectComponent<ThreeObject<THREE.Mesh>> {
  public readonly obj: ThreeObject<THREE.Mesh>

  /** 外壳高度倍率（相对行星本体半径，下限 1.01 防穿模） */
  private _altitude: number
  /** 云层自转速率（rad/s，错速自转用） */
  private _spin: number
  /** 云层不透明度 [0,1] */
  private _opacity: number
  /** 基准不透明度快照（蓝图装配值；观察模式增益的复位依据） */
  public readonly baseOpacity: number

  constructor(owner: Actor, options: Record<string, unknown> = {}, name = 'CloudLayerComponent') {
    super(owner, name)
    this._altitude = typeof options.altitude === 'number' ? Math.max(1.01, options.altitude) : 1.02
    this._spin = typeof options.spin === 'number' ? options.spin : 0.02
    this._opacity = typeof options.opacity === 'number' ? THREE.MathUtils.clamp(options.opacity, 0, 1) : 0.85
    this.baseOpacity = this._opacity

    const geo = new THREE.SphereGeometry(1, 48, 32)
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: this._opacity,
      depthWrite: false,
      side: THREE.FrontSide,
    })
    const path = options.texture
    if (typeof path === 'string' && path) {
      mat.map = loadTexture(path)
      mat.needsUpdate = true
    } else {
      const fallback = makeFallbackCloudTexture()
      if (fallback) {
        mat.map = fallback
        mat.needsUpdate = true
      }
    }
    this.obj = new ThreeObject(new THREE.Mesh(geo, mat))
    this.obj.object.scale.setScalar(this._altitude)
    this.obj.object.renderOrder = 1
    this.attachToRoot(this.obj)
  }

  /** 外壳高度倍率 */
  get altitude(): number { return this._altitude }
  set altitude(v: number) {
    this._altitude = Math.max(1.01, v)
    this.obj.object.scale.setScalar(this._altitude)
  }

  /** 自转速率 rad/s（0 = 静止；负值反转） */
  get spin(): number { return this._spin }
  set spin(v: number) { this._spin = v }

  /** 云层不透明度 [0,1] */
  get opacity(): number { return this._opacity }
  set opacity(v: number) {
    this._opacity = THREE.MathUtils.clamp(v, 0, 1)
    const mat = this.obj.object.material as THREE.MeshBasicMaterial
    mat.opacity = this._opacity
    mat.transparent = this._opacity < 1
  }

  /**
   * 每帧自转（由宿主 Actor Tick 分发；GameMode syncFrom 链暂停时 dt=0 云停转，
   * 与天体自转/公转同一暂停语义）。
   */
  override Tick(deltaTime: number): void {
    if (this._spin === 0) return
    this.obj.object.rotation.y += deltaTime * this._spin
  }

  /** Inspector 属性展示 */
  override getProperties(): Record<string, unknown> {
    const mat = this.obj.object.material as THREE.MeshBasicMaterial
    return {
      Altitude: Math.round(this._altitude * 100) / 100,
      Spin: Math.round(this._spin * 1000) / 1000,
      Opacity: Math.round(this._opacity * 100) / 100,
      Texture: mat.map ? '已设置' : '（无）',
    }
  }

  /** Inspector 可编辑属性（camelCase 与蓝图 JSON 属性名一致） */
  override getEditableProperties(): EditableProperty[] {
    return [
      {
        key: 'altitude', type: 'number', step: 0.01, min: 1.01,
        get: () => this._altitude,
        set: (v) => { this.altitude = v as number },
      },
      {
        key: 'spin', type: 'number', step: 0.01,
        get: () => this._spin,
        set: (v) => { this.spin = v as number },
      },
      {
        key: 'opacity', type: 'number', step: 0.05, min: 0, max: 1,
        get: () => this._opacity,
        set: (v) => { this.opacity = v as number },
      },
    ]
  }
}
