/**
 * UIWorldAnchorComponent — 3D 场景 UI 锚定组件（World-Space UI 双模式核心）
 *
 * 挂在 widget 根 Actor 上，把 UI 锚定到 3D 世界，覆盖两类需求（doc-dev/ui-world-space）：
 *  - mode='screen'（屏幕跟随层）：血条/名牌/伤害数字/交互提示。widget 留在 uiScene
 *    （现状渲染链路零改动），每帧把"target 世界坐标 + localOffset"投影为 UI 设计
 *    像素写入根 UITransform.position；视觉上是屏幕 UI，位置跟着世界实体走。
 *  - mode='world'（世界空间面板）：全息面板/世界大屏（diegetic）。widget 由 UIManager
 *    分流到主场景（isUIActor 第三分支），天然深度遮挡/近大远小；设计 px ÷ pxPerMeter
 *    （缺省 200）= 米；可选 billboard（faceCamera）正对相机。
 *
 * 时序：tickUI 发生在同帧相机解析之后、主场景渲染之前（SceneRendererComponent 帧循环），
 * 锚定投影的时序天然正确。
 *
 * 写入语义：screen 模式直接写根 UITransform.position（要求根 anchor=null——锚定系统
 * 接管定位，避开 applyAnchor 覆盖语义；assetLint 有对应 warn）。
 *
 * 生命周期：由 UIManager.spawnAnchoredWidget 统一创建/持有（AnchoredWidgetHandle），
 * target 销毁或 release() 时 widget 销毁；不支持作为 HUD 子节点静态挂载。
 */
import * as THREE from 'three'
import { ActorComponent, type EditableProperty } from '../entity/ActorComponent'
import type { Actor } from '../entity/Actor'
import { UITransformComponent } from './UITransformComponent'
import { CanvasUIComponent } from '../rendering/CanvasUIComponent'
import { ClickableComponent } from '../physics/ClickableComponent'
import { UICamera } from '../rendering/UICamera'
import { GameInstance } from '../gameflow/GameInstance'
import { logger } from '../Logger'

/** 锚定模式：screen=屏幕跟随（uiScene + 投影写位）/ world=世界空间面板（主场景 + 米制换算） */
export type UIWorldAnchorMode = 'screen' | 'world'
/** 出屏策略：none=照常投影（出屏消失）/ clamp=钳制到安全区（5% 内缩） */
export type UIWorldAnchorClamping = 'none' | 'clamp'

/** 出屏钳制安全边距（画布比例，5% 内缩） */
const SAFE_MARGIN = 0.05

export interface UIWorldAnchorComponentOptions {
  mode?: UIWorldAnchorMode
  /** 锚定目标 Actor 名（运行时按 name 每帧解析；空 = 无 target，world 模式位姿静态） */
  targetActorId?: string
  /** 相对 target 的局部偏移（米，如 [0, 2.2, 0] 头顶） */
  localOffset?: [number, number, number]
  /** world 模式：是否每帧朝向相机（billboard，仅根） */
  faceCamera?: boolean
  /** screen 模式：恒定屏占（true=不随距离缩放；false=近大远小） */
  constantScreenSize?: boolean
  clamping?: UIWorldAnchorClamping
  /** world 模式：设计 px → 米换算基准（缺省 200px/m） */
  pxPerMeter?: number
  /** world 模式：canvas 纹理像素密度倍数（2 = 近景不糊；设计 px 不变） */
  pixelDensity?: number
}

/** 复用临时向量（每帧投影路径，避免分配） */
const _tmpVec = new THREE.Vector3()

export class UIWorldAnchorComponent extends ActorComponent<Actor> {
  private _mode: UIWorldAnchorMode
  private _targetActorId: string
  private _localOffset: [number, number, number]
  private _faceCamera: boolean
  private _constantScreenSize: boolean
  private _clamping: UIWorldAnchorClamping
  private _pxPerMeter: number
  private _pixelDensity: number

  /** 屏幕像素基准尺寸（applyScreenScale 用；Create 时从根 UITransform 捕获） */
  private _basePx: [number, number] = [0, 0]

  constructor(owner: Actor, options: UIWorldAnchorComponentOptions = {}) {
    super(owner)
    this.name = 'UIWorldAnchorComponent'
    this._mode = options.mode ?? 'screen'
    this._targetActorId = options.targetActorId ?? ''
    this._localOffset = options.localOffset ? [...options.localOffset] as [number, number, number] : [0, 0, 0]
    this._faceCamera = options.faceCamera ?? false
    this._constantScreenSize = options.constantScreenSize ?? true
    this._clamping = options.clamping ?? 'none'
    this._pxPerMeter = options.pxPerMeter ?? 200
    this._pixelDensity = options.pixelDensity ?? 1
  }

  // ─── 可配置属性（Inspector / 资产 / 运行时热更） ───

  get mode(): UIWorldAnchorMode { return this._mode }
  set mode(v: UIWorldAnchorMode) { this._mode = v }

  get targetActorId(): string { return this._targetActorId }
  set targetActorId(v: string) { this._targetActorId = v }

  get localOffset(): [number, number, number] { return this._localOffset }
  set localOffset(v: [number, number, number]) { this._localOffset = [...v] as [number, number, number] }

  get faceCamera(): boolean { return this._faceCamera }
  set faceCamera(v: boolean) { this._faceCamera = v }

  get constantScreenSize(): boolean { return this._constantScreenSize }
  set constantScreenSize(v: boolean) { this._constantScreenSize = v }

  get clamping(): UIWorldAnchorClamping { return this._clamping }
  set clamping(v: UIWorldAnchorClamping) { this._clamping = v }

  get pxPerMeter(): number { return this._pxPerMeter }
  set pxPerMeter(v: number) { this._pxPerMeter = v }

  get pixelDensity(): number { return this._pixelDensity }
  set pixelDensity(v: number) { this._pixelDensity = v }

  // ─── 生命周期 ───

  override BeginPlay(): void {
    super.BeginPlay()
    if (this._mode === 'world') this.applyWorldMode()
    // 捕获屏幕像素基准尺寸（screen 模式缩放基准；根 uitransform 此时已就绪）
    const tsf = this.owner.getComponent(UITransformComponent)
    if (tsf) this._basePx = tsf.getWorldSize()
    logger.info(
      `[UIWorldAnchor] BeginPlay: "${this.owner.name}" mode=${this._mode}` +
      `${this._targetActorId ? `, target=${this._targetActorId}` : ''}` +
      `${this._mode === 'world' ? `, pxPerMeter=${this._pxPerMeter}, density=${this._pixelDensity}` : ''}`,
    )
  }

  /** 每帧锚定（UIManager.tickUI 驱动所有 UI Actor 的 Tick → 组件 Tick） */
  override Tick(): void {
    const cam = GameInstance.current?.getActiveCamera() ?? null
    if (this._mode === 'screen') {
      this.tickScreenAnchor(cam)
    } else if (this._faceCamera && cam) {
      // world 模式 billboard：仅根 quaternion 对齐相机（子树局部布局不受影响）
      this.owner.root.quaternion.copy(cam.quaternion)
    }
  }

  // ─── screen 模式：世界坐标 → UI px 投影 ───

  /** 解析当前锚定目标（按名字在 3D Actor 与 UI Actor 中查找；销毁返回 null） */
  private resolveTarget(): Actor | null {
    if (!this._targetActorId) return null
    const w = this.owner.world
    if (!w) return null
    return w.findActorByName(this._targetActorId)
  }

  private tickScreenAnchor(cam: THREE.PerspectiveCamera | THREE.OrthographicCamera | null): void {
    const tsf = this.owner.getComponent(UITransformComponent)
    if (!tsf) return
    const target = this.resolveTarget()

    // target 缺失（未指定/被销毁）：UIManager 已按 target 销毁策略处理，这里跳过投影
    if (!target) return

    // 锚点世界坐标 = target 世界位置 + localOffset
    const wp = target.actorLocation
    _tmpVec.set(wp.x + this._localOffset[0], wp.y + this._localOffset[1], wp.z + this._localOffset[2])

    const ui = UICamera.projectToUi(cam, _tmpVec)

    if (!ui) {
      // 相机背面：整树隐藏（CanvasUIComponent.active 是 UI 节点显隐唯一入口）
      const canvas = this.owner.getComponent(CanvasUIComponent)
      if (canvas && canvas.bActive) canvas.bActive = false
      return
    }

    // 出屏钳制（safe area 5% 内缩）
    if (this._clamping === 'clamp') {
      ui[0] = Math.min(UI_CANVAS_W_MAX, Math.max(UI_CANVAS_W_MIN, ui[0]))
      ui[1] = Math.min(UI_CANVAS_H_MAX, Math.max(UI_CANVAS_H_MIN, ui[1]))
    }

    // 恢复可见（背面隐藏后回正）
    const canvas = this.owner.getComponent(CanvasUIComponent)
    if (canvas && !canvas.bActive) canvas.bActive = true

    // 直接写根 position（根 anchor 必须为 null——锚定系统接管，避开 applyAnchor 覆盖语义）
    tsf.setPosition(ui[0], ui[1], tsf.position.z)

    // 距离缩放：恒定屏占（scale=1）或近大远小（反比）
    this.applyScreenScale(cam, wp.y + this._localOffset[1])
  }

  /** 距离缩放：constantScreenSize=false 时按投影距离反比（近大远小），true 恒 1 */
  private applyScreenScale(cam: THREE.PerspectiveCamera | THREE.OrthographicCamera | null, anchorY: number): void {
    if (!cam) return
    const target = this.resolveTarget()
    if (!target) return
    const wp = target.actorLocation
    _tmpVec.set(wp.x + this._localOffset[0], anchorY, wp.z + this._localOffset[2])
    const dist = _tmpVec.distanceTo(cam.position)
    if (dist <= 0.001) return
    // 屏幕像素尺寸 = 世界米尺寸在屏幕上的投影尺寸；恒定屏占 = 抵消投影缩放
    const scale = this._constantScreenSize ? 1 : Math.min(10 / dist, 10)
    this.owner.root.scale.setScalar(scale)
  }

  // ─── world 模式：场景分流后的单位换算 ───

  /** world 模式一次性应用：设计 px ÷ pxPerMeter = 米 + pixelDensity canvas 翻倍 */
  private applyWorldMode(): void {
    const tsf = this.owner.getComponent(UITransformComponent)
    if (!tsf || this._pxPerMeter <= 0) return
    const [pw, ph] = tsf.getWorldSize()
    const metersW = pw / this._pxPerMeter
    const metersH = ph / this._pxPerMeter
    tsf.setWorldSize(metersW, metersH)
    // canvas 纹理密度（近景不糊）：实际像素 ×N，设计 px 语义不变
    if (this._pixelDensity !== 1) {
      for (const c of this.owner.getAllComponents()) {
        if (c instanceof CanvasUIComponent && !c.isMarkerOnly) {
          const [cw, ch] = c.getSize()
          c.resizeCanvas(Math.round(cw * this._pixelDensity), Math.round(ch * this._pixelDensity))
        }
      }
    }
    // 子树 clickable 全部切 world 层（主相机射线命中；UIButton 透明点击层随之生效）
    this.switchClickablesToWorld(this.owner)
  }

  /** 递归切换子树全部 ClickableComponent 到 world 层（BeginPlay 后赋值自动迁移注册表） */
  private switchClickablesToWorld(root: Actor): void {
    const walk = (a: Actor): void => {
      for (const c of a.getComponents(ClickableComponent)) c.layer = 'world'
      for (const child of a.getChildren()) walk(child)
    }
    walk(root)
  }

  // ─── Inspector / 持久化 ───

  override getProperties(): Record<string, unknown> {
    return {
      mode: this._mode,
      target: this._targetActorId || '（无）',
      localOffset: `[${this._localOffset.join(', ')}]`,
      faceCamera: this._faceCamera,
      constantScreenSize: this._constantScreenSize,
      clamping: this._clamping,
      pxPerMeter: this._pxPerMeter,
      pixelDensity: this._pixelDensity,
    }
  }

  override getEditableProperties(): EditableProperty[] {
    return [
      { key: 'mode', type: 'enum', options: ['screen', 'world'], get: () => this._mode, set: (v) => { this._mode = v as UIWorldAnchorMode } },
      { key: 'targetActorId', type: 'string', get: () => this._targetActorId, set: (v) => { this._targetActorId = v as string } },
      { key: 'localOffset', type: 'vec3', step: 0.1, get: () => [...this._localOffset] as [number, number, number], set: (v) => { this._localOffset = [...(v as number[])] as [number, number, number] } },
      { key: 'faceCamera', type: 'boolean', get: () => this._faceCamera, set: (v) => { this._faceCamera = v as boolean } },
      { key: 'constantScreenSize', type: 'boolean', get: () => this._constantScreenSize, set: (v) => { this._constantScreenSize = v as boolean } },
      { key: 'clamping', type: 'enum', options: ['none', 'clamp'], get: () => this._clamping, set: (v) => { this._clamping = v as UIWorldAnchorClamping } },
      { key: 'pxPerMeter', type: 'number', step: 10, min: 1, get: () => this._pxPerMeter, set: (v) => { this._pxPerMeter = v as number } },
      { key: 'pixelDensity', type: 'number', step: 1, min: 1, max: 4, get: () => this._pixelDensity, set: (v) => { this._pixelDensity = v as number } },
    ]
  }
}

/** 出屏钳制边界（画布 1920×1080，5% 内缩） */
const UI_CANVAS_W_MAX = 1920 * (1 - SAFE_MARGIN)
const UI_CANVAS_W_MIN = 1920 * SAFE_MARGIN
const UI_CANVAS_H_MAX = 1080 * (1 - SAFE_MARGIN)
const UI_CANVAS_H_MIN = 1080 * SAFE_MARGIN
