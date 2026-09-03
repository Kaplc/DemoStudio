/**
 * UIMaskComponent — UI 裁剪遮罩组件（矩形/圆角矩形）
 *
 * 裁剪框 = owner 的 UITransform 边盒（世界矩形，沿父链累加 position）；
 * radius = 圆角半径（世界米，0 = 矩形）。子树内所有 UI 渲染对象
 * （CanvasUI panel / UIImage mesh / troika 文本 mesh）被裁剪到框内。
 *
 * 渲染实现（三机制并存，按对象类型自动选择）：
 *  - GL scissor rect：所有对象统一兜底（轴对齐矩形；正交 UI 相机下世界→屏幕线性映射）；
 *    对象 onBeforeRender 设 scissor、onAfterRender 恢复。嵌套 mask = 链上矩形求交。
 *  - 圆角 SDF discard：MeshBasicMaterial（canvas panel / UIImage）经 onBeforeCompile 注入
 *    圆角矩形 SDF，世界坐标超出圆角框即 discard——取链上**最近的**圆角 mask（单框）。
 *  - troika clipRect：troika-three-text 原生矩形裁剪（本地坐标），圆角退化为矩形。
 *
 * 已知限制（v1）：
 *  - 裁剪仅支持轴对齐（UI 元素旋转/缩放后裁剪框仍按轴对齐包围处理）
 *  - 命中测试不裁剪：被裁掉的视觉区域仍可被射线命中（按钮点击区域与视觉可能不一致）
 *  - troika 文本圆角裁剪退化为矩形
 *  - scissor 换算按 z=0 平面展开二维仿射（矩形两角投影时忽略 z 分量）。
 *    UI 元素本就铺在 z≈0（层级靠 zOrder 的微小 z 偏移区分，量级 0.001 可忽略），
 *    故当前正确；若将来 mask 子树被放到显著 z 偏移上，需改用
 *    THREE.Vector3.project(camera) 走完整投影。
 *
 * HTML 映射：overflow: hidden / auto / scroll 的元素自动挂本组件
 * （radius 取同元素 border-radius），滚动语义再配 UIScrollContainerComponent。
 */
import * as THREE from 'three'
import { Component, type EditableProperty } from '../entity/Component'
import type { Actor } from '../entity/Actor'
import { UITransformComponent } from './UITransformComponent'
import { CanvasUIComponent } from '../rendering/CanvasUIComponent'
import { logger } from '../Logger'

/** 生效 mask 描述（渲染时动态求值世界矩形，滚动/移动即时生效） */
export interface UIMaskFrame {
  /** mask 所属 Actor（世界矩形从它的 uitransform 现算） */
  actor: Actor
  /** 圆角半径（世界米，0 = 矩形） */
  radius: number
}

/** 世界轴对齐矩形（中心 + 半尺寸） */
export interface UIWorldRect {
  cx: number
  cy: number
  hw: number
  hh: number
}

/** 圆角矩形 SDF（世界 xy 相对框中心）：> 0 在框外 */
const SDF_CHUNK = /* glsl */ `
float sdUIRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}
`

/**
 * 给渲染对象安装裁剪 hook（scissor + SDF 圆角 uniform 引用收集）。
 * 由 UIMaskComponent 在收集受控对象时调用；userData.__uiMaskChain 缓存
 * 生效 mask 链（refreshTargets 时清空重算）。
 */
function installClipHook(obj: THREE.Object3D): void {
  if ((obj.userData as Record<string, unknown>).__uiClipInstalled) return
  ;(obj.userData as Record<string, unknown>).__uiClipInstalled = true
  const mesh = obj as THREE.Mesh
  const prevBefore = obj.onBeforeRender
  const prevAfter = obj.onAfterRender
  void mesh
  obj.onBeforeRender = function (
    this: THREE.Object3D,
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    group: THREE.Group,
  ) {
    prevBefore?.call(this, renderer, scene, camera, geometry, material, group)
    const chain = (this.userData.__uiMaskChain as UIMaskFrame[] | undefined) ?? collectMaskChain(this)
    ;(this.userData as Record<string, unknown>).__uiMaskChain = chain
    if (chain.length === 0) return
    applyScissor(renderer, camera as THREE.OrthographicCamera, chain)
    // 圆角：取链上最近（第一个）带 radius 的 mask，写入材质 uniform（SDF 注入时建立）
    const rounded = chain.find((m) => m.radius > 0)
    const uniforms = (this.userData.__uiClipUniforms) as
      | { uClipCenter: { value: THREE.Vector2 }, uClipHalf: { value: THREE.Vector2 }, uClipRadius: { value: number } }
      | undefined
    if (rounded && uniforms) {
      const r = maskWorldRect(rounded.actor)
      if (r) {
        uniforms.uClipCenter.value.set(r.cx, r.cy)
        uniforms.uClipHalf.value.set(r.hw, r.hh)
        uniforms.uClipRadius.value = rounded.radius
      }
    }
  }
  obj.onAfterRender = function (
    this: THREE.Object3D,
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    group: THREE.Group,
  ) {
    prevAfter?.call(this, renderer, scene, camera, geometry, material, group)
    if ((this.userData.__uiMaskChain as UIMaskFrame[] | undefined)?.length) {
      renderer.setScissorTest(false)
    }
  }
}

function uninstallClipHook(obj: THREE.Object3D): void {
  const ud = obj.userData as Record<string, unknown>
  if (!ud.__uiClipInstalled) return
  // three 默认 noop（非 null），恢复为空函数
  obj.onBeforeRender = () => {}
  obj.onAfterRender = () => {}
  delete ud.__uiClipInstalled
  delete ud.__uiMaskChain
  delete ud.__uiClipUniforms
}

/** 从渲染对象向上收集生效 mask 链（祖先 Actor 链上所有 UIMaskComponent，近 → 远） */
function collectMaskChain(obj: THREE.Object3D): UIMaskFrame[] {
  const chain: UIMaskFrame[] = []
  const comp = (obj.userData.__uiMaskOwner as Actor | undefined) ?? null
  let a: Actor | null = comp
  if (!a) {
    // 未登记宿主 Actor 的对象（防御）：无法确定树链，跳过
    return chain
  }
  while (a) {
    const m = a.getComponent(UIMaskComponent)
    if (m && m.enabled) chain.push({ actor: a, radius: m.radius })
    a = a.parent
  }
  return chain
}

/** mask 世界矩形（owner uitransform 边盒，沿父链累加 position；忽略旋转/缩放） */
export function maskWorldRect(actor: Actor): UIWorldRect | null {
  const tf = actor.getComponent(UITransformComponent)
  if (!tf) return null
  const [w, h] = tf.getWorldSize()
  const p = objectWorldPos(actor.root)
  return { cx: p.x, cy: p.y, hw: w / 2, hh: h / 2 }
}

/** Object3D 世界位置（沿父链累加，忽略旋转/缩放——UI 轴对齐使用约定） */
function objectWorldPos(obj: THREE.Object3D): THREE.Vector2 {
  let x = 0
  let y = 0
  let node: THREE.Object3D | null = obj
  while (node) {
    x += node.position.x
    y += node.position.y
    node = node.parent
  }
  return new THREE.Vector2(x, y)
}

/** 链上所有 mask 世界矩形求交（空集返回 null → 对象完全不可见） */
function intersectMaskRects(chain: UIMaskFrame[]): UIWorldRect | null {
  let out: UIWorldRect | null = null
  for (const m of chain) {
    const r = maskWorldRect(m.actor)
    if (!r) continue
    if (!out) {
      out = { ...r }
      continue
    }
    const x2 = Math.min(out.cx + out.hw, r.cx + r.hw)
    const y2 = Math.min(out.cy + out.hh, r.cy + r.hh)
    out.cx = Math.max(out.cx - out.hw, r.cx - r.hw)
    out.cy = Math.max(out.cy - out.hh, r.cy - r.hh)
    out.hw = Math.max(0, (x2 - out.cx) / 2)
    out.hh = Math.max(0, (y2 - out.cy) / 2)
  }
  return out
}

/** scissor 应用：mask 交集世界矩形 → 屏幕像素矩形（正交相机线性映射，GL y 向上） */
function applyScissor(
  renderer: THREE.WebGLRenderer,
  camera: THREE.OrthographicCamera | undefined,
  chain: UIMaskFrame[],
): void {
  const rect = intersectMaskRects(chain)
  if (!rect || rect.hw <= 0 || rect.hh <= 0) {
    renderer.setScissorTest(true)
    renderer.setScissor(0, 0, 0, 0)
    return
  }
  // 世界矩形 → NDC（−1..1）：用相机世界逆矩阵做投影，
  // 而非只用 left/right/top/bottom——那样等于隐含"相机在原点、zoom=1"，
  // 编辑器预览平移/缩放后 scissor 会停在错误位置（mask 内容被裁掉/错位遮挡）。
  // 走完整矩阵后平移、缩放乃至旋转都自动正确；运行时 UICamera 恒在原点，结果不变。
  const size = new THREE.Vector2()
  renderer.getSize(size)
  const W = size.x
  const H = size.y
  let left = 0
  let bottom = 0
  let width = W
  let height = H
  if (camera) {
    camera.updateMatrixWorld()
    const inv = camera.matrixWorldInverse
    // 矩形两角（左下、右上）投影到相机空间（正交：w=1，无需透视除法）
    const e = inv.elements
    const toView = (wx: number, wy: number): [number, number] => [
      e[0] * wx + e[4] * wy + e[8] * 0 + e[12],
      e[1] * wx + e[5] * wy + e[9] * 0 + e[13],
    ]
    const [x0, y0] = toView(rect.cx - rect.hw, rect.cy - rect.hh)
    const [x1, y1] = toView(rect.cx + rect.hw, rect.cy + rect.hh)
    const cw = camera.right - camera.left
    const chh = camera.top - camera.bottom
    if (cw > 0 && chh > 0) {
      // 相机空间 → NDC：正交投影下除以视锥尺寸，再考虑 zoom 缩放
      const z = camera.zoom
      const ndcX0 = (x0 * z - (camera.left + camera.right) / 2) / cw * 2
      const ndcX1 = (x1 * z - (camera.left + camera.right) / 2) / cw * 2
      const ndcY0 = (y0 * z - (camera.top + camera.bottom) / 2) / chh * 2
      const ndcY1 = (y1 * z - (camera.top + camera.bottom) / 2) / chh * 2
      // NDC → 像素（GL y 向上）
      const px0 = (ndcX0 + 1) / 2 * W
      const px1 = (ndcX1 + 1) / 2 * W
      const py0 = (ndcY0 + 1) / 2 * H
      const py1 = (ndcY1 + 1) / 2 * H
      left = Math.min(px0, px1)
      width = Math.abs(px1 - px0)
      bottom = Math.min(py0, py1)
      height = Math.abs(py1 - py0)
    }
  }
  renderer.setScissorTest(true)
  renderer.setScissor(left, bottom, Math.max(0, width), Math.max(0, height))
}

/**
 * MeshBasicMaterial 圆角裁剪注入（panel / UIImage 共用）。
 * 建立 SDF discard + uniform 引用挂对象 userData（渲染时每帧更新框位置）。
 * 注意：onBeforeCompile 编译一次后缓存，uniform 对象引用长期有效。
 */
export function injectRoundClip(obj: THREE.Object3D, material: THREE.Material): void {
  const mat = material as THREE.MeshBasicMaterial
  if ((mat.userData as Record<string, unknown>).__uiRoundClip) return
  ;(mat.userData as Record<string, unknown>).__uiRoundClip = true
  const uniforms = {
    uClipCenter: { value: new THREE.Vector2(0, 0) },
    uClipHalf: { value: new THREE.Vector2(-1, -1) }, // <0 = 未启用（全可见）
    uClipRadius: { value: 0 },
  }
  ;(obj.userData as Record<string, unknown>).__uiClipUniforms = uniforms
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uClipCenter = uniforms.uClipCenter
    shader.uniforms.uClipHalf = uniforms.uClipHalf
    shader.uniforms.uClipRadius = uniforms.uClipRadius
    shader.vertexShader = 'varying vec2 vUIClipWorld;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n\tvUIClipWorld = (modelMatrix * vec4(position, 1.0)).xy;',
    )
    shader.fragmentShader = 'varying vec2 vUIClipWorld;\nuniform vec2 uClipCenter;\nuniform vec2 uClipHalf;\nuniform float uClipRadius;\n' + SDF_CHUNK + '\n' + shader.fragmentShader.replace(
      '#include <clipping_planes_fragment>',
      '#include <clipping_planes_fragment>\n\tif (uClipHalf.x > 0.0 && sdUIRoundBox(vUIClipWorld - uClipCenter, uClipHalf, uClipRadius) > 0.0) discard;',
    )
  }
  mat.customProgramCacheKey = () => 'ui-round-clip'
}

export class UIMaskComponent extends Component<Actor> {
  private _radius = 0
  /** 已安装 hook 的受控渲染对象 */
  private _targets: THREE.Object3D[] = []
  private _installed = false

  constructor(owner: Actor, options: { radius?: number, name?: string } = {}) {
    super(owner)
    this.name = options.name ?? 'UIMaskComponent'
    this._radius = Math.max(0, options.radius ?? 0)
  }

  /** 圆角半径（世界米，0 = 矩形） */
  get radius(): number { return this._radius }
  set radius(v: number) {
    this._radius = Math.max(0, v)
    this.refreshTargets()
  }

  /** 是否生效（预留开关：始终 true；Inspector/链判断用） */
  get enabled(): boolean { return true }

  override BeginPlay(): void {
    super.BeginPlay()
    this.install()
  }

  override EndPlay(): void {
    super.EndPlay()
    for (const obj of this._targets) uninstallClipHook(obj)
    this._targets = []
    this._installed = false
  }

  /**
   * 收集子树受控渲染对象并安装裁剪 hook。
   * 子树变化（动态加子项/滚动内容重建）后调用重装。
   */
  install(): void {
    this.uninstall()
    const objects = this.collectRenderObjects(this.owner)
    for (const obj of objects) {
      ;(obj.userData as Record<string, unknown>).__uiMaskOwner = this.owner
      installClipHook(obj)
    }
    this._targets = objects
    this._installed = true
    this.applyRoundClip(objects)
    this.applyTroikaClipRects(objects)
    logger.debug(`[UIMaskComponent] "${this.owner.name}" 安装裁剪: ${objects.length} 个渲染对象 (radius=${this._radius})`)
  }

  /** 圆角 SDF 注入：canvas 纹理面板（MeshBasicMaterial + map）；troika 等无 map 材质跳过（走 scissor 矩形） */
  private applyRoundClip(objects: THREE.Object3D[]): void {
    if (this._radius <= 0) return
    for (const obj of objects) {
      const mesh = obj as THREE.Mesh
      const mat = mesh.material as THREE.MeshBasicMaterial | undefined
      if (mat && (mat as unknown as { isMeshBasicMaterial?: boolean }).isMeshBasicMaterial && mat.map) {
        injectRoundClip(obj, mat)
      }
    }
  }

  /**
   * troika 文本矩形裁剪（troika 原生 clipRect，文本本地坐标）。
   * 世界矩形 − 文本世界位置 = 本地平移近似（轴对齐）。滚动/移动后 refreshTargets 重算。
   */
  private applyTroikaClipRects(objects: THREE.Object3D[]): void {
    const r = maskWorldRect(this.owner)
    if (!r) return
    for (const obj of objects) {
      const t = obj as unknown as { clipRect?: number[] }
      if (t.clipRect === undefined) continue // 非 troika 对象（无该字段）
      const pos = objectWorldPos(obj)
      t.clipRect = [r.cx - r.hw - pos.x, r.cy - r.hh - pos.y, r.cx + r.hw - pos.x, r.cy + r.hh - pos.y]
    }
  }

  /** 卸载并重装（radius 变化 / 子树变化后调用；清 hook 链缓存） */
  refreshTargets(): void {
    if (!this._installed) return
    this.install()
  }

  private uninstall(): void {
    for (const obj of this._targets) uninstallClipHook(obj)
    this._targets = []
  }

  /** 子树收集受控渲染对象：canvas panel（含透明点击层）+ 注册的 troika mesh */
  private collectRenderObjects(root: Actor): THREE.Object3D[] {
    const out: THREE.Object3D[] = []
    const walk = (a: Actor) => {
      for (const canvas of a.getComponents(CanvasUIComponent)) {
        if (canvas.isMarkerOnly) {
          // markerOnly 无 panel，但子组件（troika 文本）会注册渲染对象到它
          for (const obj of canvas.renderObjects) out.push(obj)
        } else if (canvas.panel) {
          out.push(canvas.panel)
        }
      }
      for (const child of a.getChildren()) walk(child)
    }
    walk(root)
    return out
  }

  override getProperties(): Record<string, unknown> {
    return {
      radius: this.round2(this._radius),
      targets: this._targets.length,
    }
  }

  override getEditableProperties(): EditableProperty[] {
    return [
      {
        key: 'radius', type: 'number', step: 0.01, min: 0,
        get: () => this.round2(this._radius),
        set: (v) => { this.radius = v as number },
      },
    ]
  }

  /** 保留 2 位小数 */
  private round2(v: number): number {
    return Math.round(v * 100) / 100
  }
}
