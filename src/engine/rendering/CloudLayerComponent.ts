/**
 * CloudLayerComponent — 行星云层壳组件（独立自转的受光外壳）
 *
 * 挂在行星 Actor 上，生成一个半径略大于本体的贴图球壳（FrontSide 看近半球云）。
 * 同一 Actor 可声明多层（低层浓/高层疏、异速自转 + 异速 UV 漂移）→ 视差出体积感。
 *
 * 受光材质（2026-09-12 群星观感改版）：MeshLambertMaterial + alphaMap——
 * 云图按"白云黑底"灰度读作透明度（alphaMap 取绿通道），云体受场景灯光：
 * 向阳面亮、夜面云随本体一起沉入暗部（旧 MeshBasicMaterial 恒全亮，夜面云发灰雾）。
 *
 * 云图柔化管线（2026-09-12 二轮）：1024 级源图在特写下 texel 1:1 放大会出二元硬边与
 * 像素块 → 加载后异步过"半分辨率下采样 → 2× 上采样（低通）→ smoothstep 软阈值"管线，
 * 产 2048 级柔化 alphaMap 替换原始图；硬边消失、云絮出半透明过渡带。
 *
 * 动态（Tick，宿主 Actor 分发）：
 *  - spin：整壳自转（与本体错速 → 云相对地面流动）
 *  - uvDrift：alphaMap 经度漂移（UV offset.x 累加，Repeat 回卷）→ 云形持续演变，
 *    与自转叠加读作"天气系统"，缩放下也有活体感（uvDrift 用源生 offset，多层互不干扰）
 *
 * 分层说明（关键设计决策）：
 *  - 继承 ThreeObjectComponent 而非 MeshComponent：MeshComponent 强制一个 Actor
 *    一个 mesh，云层必须与本体 SphereMeshComponent 共存 —— 同 AtmosphereComponent
 *    的自托管外壳路径（ShadowBlobComponent 先例）。
 *  - 几何半径固定 1，scale = 本体半径 × altitude（外壳倍率，本体半径构造时从
 *    owner 的 SphereMeshComponent.radius 解析、缺失兜底 1，壳必须晚于本体挂载；
 *    运行时改本体 radius 不回缩放）：挂 owner.root 自动跟随天体位移；
 *    半透明（depthWrite:false）+ renderOrder 1，与大气壳共存的绘制顺序 =
 *    本体(0) → 云(1) → 大气(2)；多层云按声明顺序内→外绘制（透明排序同中心稳定）。
 *  - transparent 壳不进点击：星图点击是纯数学距离判定（planetAt），与 mesh 无关。
 *
 * 蓝图声明用（双层体积感示例）：
 *   { "baseClass": "CloudLayerComponent", "properties": { "texture": "asset/textures/earth_clouds.png", "altitude": 1.015, "spin": 1.25, "uvDrift": 0.004, "opacity": 0.75 } }
 *   { "baseClass": "CloudLayerComponent", "properties": { "texture": "asset/textures/earth_clouds.png", "altitude": 1.05, "spin": 1.5, "uvDrift": 0.012, "opacity": 0.38 } }
 */
import * as THREE from 'three'
import { ThreeObjectComponent } from './ThreeObjectComponent'
import { ThreeObject } from './ThreeObject'
import { SphereMeshComponent } from './SphereMeshComponent'
import { TextureRegistry } from '../asset/TextureRegistry'
import { logger } from '../Logger'
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
  tex.wrapS = THREE.RepeatWrapping // UV 漂移需要经向回卷
  return tex
}

/**
 * 云图柔化管线：半分辨率下采样（均值糊化）→ 目标尺寸上采样（双线性低通）→ 稀薄化
 * 削底带 → smoothstep 软阈值重映射。输出上限 4096 宽：1024 源 2× 放大补 texel 密度，
 * ≥2048 源（4k 真图）保持原尺寸只做低通 + 曲线。硬边消失、云絮出半透明过渡带，
 * 覆盖度下降（削掉底部 15% 密度带的薄雾）。
 * 输出为数据纹理（不设 sRGB——alphaMap 取灰度值，sRGB 解码会压中灰）。
 * 无 DOM canvas（单测/极简容器）返回 null，调用方保留原始 alphaMap。
 */
function softenCloudAlpha(img: HTMLImageElement): THREE.CanvasTexture | null {
  const sw = img.naturalWidth || img.width
  const sh = img.naturalHeight || img.height
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null
  if (!canvas || !sw || !sh) return null
  const tmp = document.createElement('canvas')
  tmp.width = Math.max(1, sw >> 1)
  tmp.height = Math.max(1, sh >> 1)
  const tc = tmp.getContext('2d')
  const g = canvas.getContext('2d')
  if (!tc || !g) return null
  tc.imageSmoothingEnabled = true
  tc.drawImage(img, 0, 0, tmp.width, tmp.height)
  canvas.width = Math.min(sw * 2, 4096)
  canvas.height = Math.max(1, Math.round((canvas.width * sh) / sw))
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  g.drawImage(tmp, 0, 0, canvas.width, canvas.height)
  const id = g.getImageData(0, 0, canvas.width, canvas.height)
  const d = id.data
  const H = canvas.height
  // 纬度衰减：源云图两极常有涂抹白斑（equirect 伪影），最外 28% 纬度带平滑压到 20%
  // （赤道不受影响）——否则特写顶部读作"极冠"，不像天气
  const rowFade = new Float32Array(H)
  for (let y = 0; y < H; y++) {
    const lat = Math.abs((y / (H - 1)) * 2 - 1) // 0 赤道 → 1 极点
    rowFade[y] = lat < 0.72 ? 1 : Math.max(0.2, 1 - ((lat - 0.72) / 0.28) * 0.8)
  }
  const CUT = 0.15 // 稀薄化：削掉底部 15% 密度带（薄雾/霾），云主体保留、覆盖度下降
  for (let y = 0; y < H; y++) {
    const fade = rowFade[y]
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4
      // 密度 = 灰度 × alpha：兼容两类云图——黑底白图（灰度承载形状，a=1）与
      // 白底 alpha 图（RGB 全白，形状在 alpha 里；fair_clouds_4k 即此类）
      let t = (d[i] / 255) * (d[i + 3] / 255)
      // 稀薄化削底 → smoothstep(0,1)：暗部压透明、亮部提浓、边缘出过渡
      t = Math.max(0, (t - CUT) / (1 - CUT))
      t = t * t * (3 - 2 * t)
      const v = ((t * fade) * 255) | 0
      d[i] = v
      d[i + 1] = v
      d[i + 2] = v
    }
  }
  g.putImageData(id, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  return tex
}

export class CloudLayerComponent extends ThreeObjectComponent<ThreeObject<THREE.Mesh>> {
  public readonly obj: ThreeObject<THREE.Mesh>

  /** 外壳高度倍率（相对行星本体半径，下限 1.01 防穿模） */
  private _altitude: number
  /** 云层自转速率（rad/s，错速自转用） */
  private _spin: number
  /** alphaMap 经度漂移速率（UV offset.x/s，0 = 关；多层各自独立） */
  private _uvDrift: number
  /** 云层不透明度 [0,1] */
  private _opacity: number
  /** 基准不透明度快照（蓝图装配值；观察模式增益的复位依据） */
  public readonly baseOpacity: number
  /** 本体半径快照（构造时从 owner 的 SphereMeshComponent 解析；缺失兜底 1） */
  private readonly _bodyRadius: number

  constructor(owner: Actor, options: Record<string, unknown> = {}, name = 'CloudLayerComponent') {
    super(owner, name)
    this._altitude = typeof options.altitude === 'number' ? Math.max(1.01, options.altitude) : 1.02
    this._spin = typeof options.spin === 'number' ? options.spin : 0.02
    this._uvDrift = typeof options.uvDrift === 'number' ? options.uvDrift : 0
    this._opacity = typeof options.opacity === 'number' ? THREE.MathUtils.clamp(options.opacity, 0, 1) : 0.85
    this.baseOpacity = this._opacity
    this._bodyRadius = owner.getComponent(SphereMeshComponent)?.radius ?? 1

    const geo = new THREE.SphereGeometry(1, 48, 32)
    // 受光云层：Lambert + alphaMap（白云黑底灰度 → 绿通道读作透明度），云随灯光昼夜明暗
    const mat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: this._opacity,
      depthWrite: false,
      side: THREE.FrontSide,
    })
    const path = options.texture
    if (typeof path === 'string' && path) {
      // 柔化管线异步产出 alphaMap（RGB×A 乘积密度 + 稀薄化 + 软阈值），就绪前隐藏壳——
      // alphaMap 缺位时 Lambert alpha=1 会闪一帧实心白壳（fair_clouds 白底 alpha 图尤甚）
      mat.visible = false
      if (typeof document !== 'undefined') {
        const url = TextureRegistry.resolve(path) ?? path
        const img = new Image()
        img.onload = () => {
          const soft = softenCloudAlpha(img)
          if (soft) {
            mat.alphaMap = soft
            logger.info(`[CloudLayerComponent] ${this.name} 云图柔化完成（${soft.image.width}×${soft.image.height}，密度=灰度×alpha + 稀薄化）`)
          } else {
            logger.warn(`[CloudLayerComponent] ${this.name} 云图柔化失败（无 2D canvas 环境），素壳兜底`)
          }
          mat.visible = true
          mat.needsUpdate = true
        }
        img.onerror = () => {
          logger.warn(`[CloudLayerComponent] ${this.name} 云图加载失败：${url}`)
          mat.visible = true
        }
        img.src = url
      } else {
        // 无 DOM 环境（单测）：壳保持隐藏（可编辑属性/计数不受影响）
      }
    } else {
      const fallback = makeFallbackCloudTexture()
      if (fallback) {
        mat.alphaMap = fallback
        mat.needsUpdate = true
      }
    }
    this.obj = new ThreeObject(new THREE.Mesh(geo, mat))
    this.obj.object.scale.setScalar(this._bodyRadius * this._altitude)
    this.obj.object.renderOrder = 1
    this.attachToRoot(this.obj)
  }

  /** 外壳高度倍率 */
  get altitude(): number { return this._altitude }
  set altitude(v: number) {
    this._altitude = Math.max(1.01, v)
    this.obj.object.scale.setScalar(this._bodyRadius * this._altitude)
  }

  /** 自转速率 rad/s（0 = 静止；负值反转） */
  get spin(): number { return this._spin }
  set spin(v: number) { this._spin = v }

  /** alphaMap 经度漂移速率（UV offset.x/s；0 = 关） */
  get uvDrift(): number { return this._uvDrift }
  set uvDrift(v: number) { this._uvDrift = v }

  /** 云层不透明度 [0,1] */
  get opacity(): number { return this._opacity }
  set opacity(v: number) {
    this._opacity = THREE.MathUtils.clamp(v, 0, 1)
    const mat = this.obj.object.material as THREE.MeshLambertMaterial
    mat.opacity = this._opacity
    mat.transparent = this._opacity < 1
  }

  /**
   * 每帧自转 + UV 漂移（由宿主 Actor Tick 分发；GameMode syncFrom 链暂停时 dt=0 云停转，
   * 与天体自转/公转同一暂停语义）。
   */
  override Tick(deltaTime: number): void {
    if (this._spin !== 0) {
      this.obj.object.rotation.y += deltaTime * this._spin
    }
    if (this._uvDrift !== 0) {
      const mat = this.obj.object.material as THREE.MeshLambertMaterial
      if (mat.alphaMap) {
        mat.alphaMap.offset.x = (mat.alphaMap.offset.x + deltaTime * this._uvDrift) % 1
      }
    }
  }

  /**
   * Inspector 属性展示。key 与 getEditableProperties() 一致为 camelCase（精确匹配
   * 渲染编辑控件）；texture 为只读信息行，无对应可编辑属性。
   */
  override getProperties(): Record<string, unknown> {
    const mat = this.obj.object.material as THREE.MeshLambertMaterial
    return {
      altitude: Math.round(this._altitude * 100) / 100,
      spin: Math.round(this._spin * 1000) / 1000,
      uvDrift: Math.round(this._uvDrift * 10000) / 10000,
      opacity: Math.round(this._opacity * 100) / 100,
      texture: mat.alphaMap ? '已设置' : '（无）',
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
        key: 'uvDrift', type: 'number', step: 0.001,
        get: () => this._uvDrift,
        set: (v) => { this.uvDrift = v as number },
      },
      {
        key: 'opacity', type: 'number', step: 0.05, min: 0, max: 1,
        get: () => this._opacity,
        set: (v) => { this.opacity = v as number },
      },
    ]
  }
}
