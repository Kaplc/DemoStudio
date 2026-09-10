/**
 * AtmosphereComponent — 行星大气 Fresnel 边缘辉光壳（unlit 程序化外壳）
 *
 * 挂在行星 Actor 上，生成一个半径略大于本体的透明球壳（BackSide，渲染行星背
 * 面轮廓之外的"光圈"），边缘视角越掠射越亮、正对越透明——肉眼观感为星球轮廓
 * 外包裹一圈颜色渐隐的大气辉光，与壳内行星贴图叠出"有气态包络"的体积感。
 *
 * 分层说明（关键设计决策）：
 *  - 本组件继承 ThreeObjectComponent 而非 MeshComponent：MeshComponent 强制
 *    "一个 Actor 只能挂一个 mesh"（构造时按类名后缀拒绝重复），大气/云层必须
 *    与行星本体 SphereMeshComponent 共存于同一 Actor —— 走 ShadowBlobComponent
 *    同款自托管外壳路径（ShadowBlob 先例：非 Mesh 派生的渲染附件组件）。
 *  - 几何半径固定 1，scale = 本体半径 × shellScale（外壳倍率）：本体半径在构造时
 *    从 owner 的 SphereMeshComponent.radius 解析（壳必须晚于本体挂载），缺失时
 *    兜底 1（倍率即半径，适配单位球）；Actor 变换只驱动本体 mesh，子壳跟随
 *    owner.root 位置自动同步。运行时改本体 radius 不回缩放（行星半径蓝图定值，
 *    不支持动态改）。
 *  - ShaderMaterial unlit（不受灯光）：行星光来自太阳方向光，Fresnel 用视线夹角
 *    近似即可，避免真实大气散射积分的复杂度；观察模式增强走 intensity setter。
 *  - renderOrder = 1：透明壳在行星本体之后绘制，保证混合正确。
 *  - 外发散光晕（haloScale/haloIntensity）：Fresnel 壳只亮贴边一圈、外壳边界即
 *    戛然而止，没有"向外发散"——光晕用星图飞船/太阳同款的相机朝向加色 Sprite
 *    （径向渐变 mask + AdditiveBlending + depthWrite off），深度测试让本体裁掉
 *    Sprite 中心 → 只露轮廓外的外溢光圈；haloScale 0 = 关。
 *
 * 蓝图声明用：
 *   { "baseClass": "AtmosphereComponent", "properties": { "color": "#7fb8ff", "intensity": 1.2, "power": 2.6, "scale": 1.05 } }
 *
 * 资源模型：几何与贴图全程序化（半径 1 球 + Fresnel shader），无共享单例，
 * EndPlay 经 ThreeObject.dispose 释放（与普通 mesh 组件一致）。
 */
import * as THREE from 'three'
import { ThreeObjectComponent } from './ThreeObjectComponent'
import { ThreeObject } from './ThreeObject'
import { SphereMeshComponent } from './SphereMeshComponent'
import type { Actor } from '../entity/Actor'
import type { EditableProperty } from '../entity/ActorComponent'

/** 大气辉光顶点着色器：传视线方向与法线夹角数据（世界空间） */
const VERT = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vViewDirW;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDirW = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`

/** 大气辉光片元着色器：Fresnel = 1-|dot(N,V)|，power 控制边缘锐度 */
const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uPower;
  varying vec3 vNormalW;
  varying vec3 vViewDirW;
  void main() {
    float fresnel = pow(1.0 - abs(dot(normalize(vNormalW), normalize(vViewDirW))), uPower);
    gl_FragColor = vec4(uColor, fresnel * uIntensity);
  }
`

/** 外发散光晕径向渐变贴图（白 = 色乘 mask，加色混合）：与星图飞船/太阳光晕同配方。
 *  过渡带按 haloScale 2.6 调校（0.385 ≈ 1/2.6 = 星球轮廓位置，贴边最亮向外渐隐）。 */
function makeHaloTexture(): THREE.CanvasTexture | null {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null
  if (!canvas) return null
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const S = 256
  canvas.width = S
  canvas.height = S
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.02, S / 2, S / 2, S / 2)
  g.addColorStop(0, 'rgba(255,255,255,0.5)')
  g.addColorStop(0.385, 'rgba(255,255,255,0.45)')
  g.addColorStop(0.6, 'rgba(255,255,255,0.2)')
  g.addColorStop(0.8, 'rgba(255,255,255,0.07)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export class AtmosphereComponent extends ThreeObjectComponent<ThreeObject<THREE.Mesh>> {
  public readonly obj: ThreeObject<THREE.Mesh>

  /** 大气颜色（uniform uColor） */
  private _color: THREE.Color
  /** 辉光强度（uniform uIntensity，乘在 alpha 上） */
  private _intensity: number
  /** 基准强度快照（蓝图装配值；观察模式增益的复位依据） */
  public readonly baseIntensity: number
  /** 边缘锐度（uniform uPower，越大边缘越细亮） */
  private _power: number
  /** 外壳半径倍率（相对行星本体半径；资产字段名 shellScale，scale 保留给 TransformComponent） */
  private _shellScale: number
  /** 本体半径快照（构造时从 owner 的 SphereMeshComponent 解析；缺失兜底 1） */
  private readonly _bodyRadius: number
  /** 外发散光晕直径倍率（相对本体半径；0 = 关。直径 = 2 × 本体半径 × haloScale） */
  private _haloScale: number
  /** 外发散光晕强度（加色 Sprite opacity [0,1]） */
  private _haloIntensity: number
  /** 外发散光晕 Sprite（相机朝向；深度测试让本体裁掉中心 → 只露轮廓外光圈） */
  private haloObj: ThreeObject<THREE.Sprite> | null = null

  constructor(owner: Actor, options: Record<string, unknown> = {}, name = 'AtmosphereComponent') {
    super(owner, name)
    this._color = new THREE.Color((options.color as THREE.ColorRepresentation) ?? '#7fb8ff')
    this._intensity = typeof options.intensity === 'number' ? options.intensity : 1.2
    this.baseIntensity = this._intensity
    this._power = typeof options.power === 'number' ? options.power : 2.6
    this._shellScale = typeof options.shellScale === 'number' ? Math.max(1.01, options.shellScale) : 1.05
    this._bodyRadius = owner.getComponent(SphereMeshComponent)?.radius ?? 1
    this._haloScale = typeof options.haloScale === 'number' ? Math.max(0, options.haloScale) : 2.6
    this._haloIntensity = typeof options.haloIntensity === 'number' ? THREE.MathUtils.clamp(options.haloIntensity, 0, 1) : 0.9
    this.buildHalo()

    const geo = new THREE.SphereGeometry(1, 48, 32)
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uColor: { value: this._color },
        uIntensity: { value: this._intensity },
        uPower: { value: this._power },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
    })
    this.obj = new ThreeObject(new THREE.Mesh(geo, mat))
    this.obj.object.scale.setScalar(this._bodyRadius * this._shellScale)
    this.obj.object.renderOrder = 1
    this.attachToRoot(this.obj)
  }

  /** 外发散光晕装配：相机朝向加色 Sprite（径向渐变 mask），无 DOM canvas 环境静默跳过 */
  private buildHalo(): void {
    if (this._haloScale <= 0) return
    const mat = new THREE.SpriteMaterial({
      map: makeHaloTexture() ?? undefined,
      color: this._color,
      transparent: true,
      opacity: this._haloIntensity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.setScalar(this._bodyRadius * 2 * this._haloScale)
    sprite.renderOrder = 1
    this.haloObj = new ThreeObject(sprite, { disposeGeometry: false })
    this.attachToRoot(this.haloObj)
  }

  /** 测试/检查口：外发散光晕 Sprite（haloScale 0 = null） */
  get halo(): THREE.Sprite | null { return this.haloObj?.object ?? null }

  override EndPlay(): void {
    if (this.haloObj) {
      this.owner.root.remove(this.haloObj.object)
      this.haloObj.dispose()
      this.haloObj = null
    }
    super.EndPlay()
  }

  override setVisible(visible: boolean): void {
    super.setVisible(visible)
    if (this.haloObj) this.haloObj.object.visible = visible && this.owner.bActive !== false
  }

  /** 大气颜色（同步 Fresnel 壳 uniform 与外发散光晕 Sprite 乘色） */
  get color(): string { return `#${this._color.getHexString()}` }
  set color(v: string) {
    this._color.set(v)
    ;(this.obj.object.material as THREE.ShaderMaterial).uniforms.uColor.value = this._color
    if (this.haloObj) (this.haloObj.object.material as THREE.SpriteMaterial).color.set(v)
  }

  /** 辉光强度 [0.2, 3]（观察模式增强走此 setter） */
  get intensity(): number { return this._intensity }
  set intensity(v: number) {
    this._intensity = THREE.MathUtils.clamp(v, 0.2, 3)
    ;(this.obj.object.material as THREE.ShaderMaterial).uniforms.uIntensity.value = this._intensity
  }

  /** 边缘锐度（≥0.5） */
  get power(): number { return this._power }
  set power(v: number) {
    this._power = Math.max(0.5, v)
    ;(this.obj.object.material as THREE.ShaderMaterial).uniforms.uPower.value = this._power
  }

  /** 外壳半径倍率（下限 1.01 防穿进本体） */
  get shellScale(): number { return this._shellScale }
  set shellScale(v: number) {
    this._shellScale = Math.max(1.01, v)
    this.obj.object.scale.setScalar(this._bodyRadius * this._shellScale)
  }

  /** 外发散光晕直径倍率（相对本体半径；0 = 关；直径 = 2 × 本体半径 × haloScale） */
  get haloScale(): number { return this._haloScale }
  set haloScale(v: number) {
    this._haloScale = Math.max(0, v)
    if (this.haloObj) this.haloObj.object.scale.setScalar(this._bodyRadius * 2 * this._haloScale)
  }

  /** 外发散光晕强度 [0,1] */
  get haloIntensity(): number { return this._haloIntensity }
  set haloIntensity(v: number) {
    this._haloIntensity = THREE.MathUtils.clamp(v, 0, 1)
    if (this.haloObj) (this.haloObj.object.material as THREE.SpriteMaterial).opacity = this._haloIntensity
  }

  /**
   * Inspector 属性展示。key 必须与 getEditableProperties() 的 key 完全一致
   * （camelCase）：Inspector 按 `p.key === k` 精确匹配决定渲染编辑控件还是灰色
   * 只读文本（大小写不同 = 静默变只读，见 doc/editor/core/property_edit_system.md 坑 1）。
   */
  override getProperties(): Record<string, unknown> {
    return {
      color: this.color,
      intensity: Math.round(this._intensity * 100) / 100,
      power: Math.round(this._power * 100) / 100,
      shellScale: Math.round(this._shellScale * 100) / 100,
      haloScale: Math.round(this._haloScale * 100) / 100,
      haloIntensity: Math.round(this._haloIntensity * 100) / 100,
    }
  }

  /** Inspector 可编辑属性（camelCase 与蓝图 JSON 属性名一致） */
  override getEditableProperties(): EditableProperty[] {
    return [
      {
        key: 'color', type: 'color',
        get: () => this.color,
        set: (v) => { this.color = v as string },
      },
      {
        key: 'intensity', type: 'number', step: 0.1, min: 0.2, max: 3,
        get: () => this._intensity,
        set: (v) => { this.intensity = v as number },
      },
      {
        key: 'power', type: 'number', step: 0.1, min: 0.5,
        get: () => this._power,
        set: (v) => { this.power = v as number },
      },
      {
        key: 'shellScale', type: 'number', step: 0.01, min: 1.01,
        get: () => this._shellScale,
        set: (v) => { this.shellScale = v as number },
      },
      {
        key: 'haloScale', type: 'number', step: 0.1, min: 0,
        get: () => this._haloScale,
        set: (v) => { this.haloScale = v as number },
      },
      {
        key: 'haloIntensity', type: 'number', step: 0.05, min: 0, max: 1,
        get: () => this._haloIntensity,
        set: (v) => { this.haloIntensity = v as number },
      },
    ]
  }
}
