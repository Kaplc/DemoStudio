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
 *  - 几何半径固定 1，scale = radius × scale（外壳倍率）：Actor 变换只驱动本体
 *    mesh，子壳跟随 owner.root 位置自动同步；不读 owner 的 SphereMesh 半径，
 *    组件保持自包含（蓝图声明即完整外观，预览/运行时同源）。
 *  - ShaderMaterial unlit（不受灯光）：行星光来自太阳方向光，Fresnel 用视线夹角
 *    近似即可，避免真实大气散射积分的复杂度；观察模式增强走 intensity setter。
 *  - renderOrder = 1：透明壳在行星本体之后绘制，保证混合正确。
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

  constructor(owner: Actor, options: Record<string, unknown> = {}, name = 'AtmosphereComponent') {
    super(owner, name)
    this._color = new THREE.Color((options.color as THREE.ColorRepresentation) ?? '#7fb8ff')
    this._intensity = typeof options.intensity === 'number' ? options.intensity : 1.2
    this.baseIntensity = this._intensity
    this._power = typeof options.power === 'number' ? options.power : 2.6
    this._shellScale = typeof options.shellScale === 'number' ? Math.max(1.01, options.shellScale) : 1.05

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
    this.obj.object.scale.setScalar(this._shellScale)
    this.obj.object.renderOrder = 1
    this.attachToRoot(this.obj)
  }

  /** 大气颜色 */
  get color(): string { return `#${this._color.getHexString()}` }
  set color(v: string) {
    this._color.set(v)
    ;(this.obj.object.material as THREE.ShaderMaterial).uniforms.uColor.value = this._color
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
    this.obj.object.scale.setScalar(this._shellScale)
  }

  /** Inspector 属性展示 */
  override getProperties(): Record<string, unknown> {
    return {
      Color: this.color,
      Intensity: Math.round(this._intensity * 100) / 100,
      Power: Math.round(this._power * 100) / 100,
      ShellScale: Math.round(this._shellScale * 100) / 100,
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
    ]
  }
}
