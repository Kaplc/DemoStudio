/**
 * ClickableComponent — 射线点击检测组件
 *
 * 挂载到 Actor 上，自动注册到所属 World 的 PhySys，
 * 提供点击/悬停检测能力。
 *
 * 自动收集 Actor.root 下的所有 Mesh 作为检测目标，
 * 也可通过 setTargets() 指定特定 Object3D。
 *
 * 点击/悬停由 PhySys 的 raycastClick/raycastHover 自动分发，
 * 无需手动管理。
 */
import * as THREE from 'three'
import { Component } from '../entity/Component'
import type { Actor } from '../entity/Actor'
import { PhySys } from './PhySys'

export class ClickableComponent extends Component<Actor> {
  /**
   * 所属层：
   *  - 'world'：3D 世界（主相机射线检测，默认）
   *  - 'ui'：屏幕空间 UI（独立 UI 相机平行射线检测，由 UIButtonComponent 等设置）
   */
  layer: 'ui' | 'world' = 'world'

  /** 点击回调：传入命中的 Intersection 信息 */
  onClick: ((hit: THREE.Intersection) => void) | null = null
  /** 按下回调：mousedown 命中时触发（先于 onClick），长按保持由 onRelease 恢复 */
  onPress: ((hit: THREE.Intersection) => void) | null = null
  /** 释放回调：mouseup 时触发（无论鼠标是否仍在按钮上，只要之前按过） */
  onRelease: (() => void) | null = null
  /** 悬停回调：传入命中信息（null 表示离开） */
  onHover: ((hit: THREE.Intersection | null) => void) | null = null

  /** 点击冷却时间 (ms) */
  clickCooldown = 500

  /** 是否正在被悬停 */
  private _hovering = false
  /** 是否处于按下状态（mousedown 命中置位，mouseup 清除） */
  private _pressed = false
  /** 防连点时间戳 */
  private _lastClickTime = 0
  /** 显式指定的检测目标 */
  private _explicitTargets: THREE.Object3D[] | null = null

  constructor(owner: import('../entity/Actor').Actor) {
    super(owner)
    this.name = 'ClickableComponent'
  }

  // ═══════════════════════════════════
  //  生命周期 — 自动注册/注销到 PhySys 单例
  // ═══════════════════════════════════

  override BeginPlay(): void {
    PhySys.register(this)
  }

  override EndPlay(): void {
    PhySys.unregister(this)
    this._hovering = false
    super.EndPlay()
  }

  /** Inspector 属性展示 */
  override getProperties(): Record<string, unknown> {
    return {
      ClickCooldown: `${this.clickCooldown}ms`,
      Hovering: this._hovering,
      HasOnClick: this.onClick !== null,
      HasOnHover: this.onHover !== null,
    }
  }

  // ═══════════════════════════════════
  //  目标管理
  // ═══════════════════════════════════

  /**
   * 设置显式检测目标（覆盖默认的自动收集行为）。
   * 适用于需要精确控制检测范围的情况（如房子点击区域用一个不可见 BoxMesh）。
   */
  setTargets(targets: THREE.Object3D[]): void {
    this._explicitTargets = targets
  }

  /** 添加一个检测目标 */
  addTarget(target: THREE.Object3D): void {
    if (!this._explicitTargets) {
      this._explicitTargets = []
    }
    this._explicitTargets.push(target)
  }

  /** 获取检测目标列表 */
  private getTargets(): THREE.Object3D[] {
    if (this._explicitTargets) return this._explicitTargets
    // 默认：自动收集 owner.root 下的所有 Mesh
    const meshes: THREE.Mesh[] = []
    this.owner.root.traverse((child) => {
      if (child instanceof THREE.Mesh) meshes.push(child)
    })
    return meshes
  }

  // ═══════════════════════════════════
  //  射线检测
  // ═══════════════════════════════════

  /**
   * 对指定 raycaster 做命中测试。
   * 返回最近的命中结果，无命中返回 null。
   *
   * 注意：THREE.Raycaster 不检查 visible——隐藏的 mesh（如节点 bActive=false
   * 级联隐藏的 UI 按钮）依然会被命中。这里沿父链过滤不可见目标，
   * 保证"隐藏的 UI/物体不响应射线"（与 Unity 行为一致）。
   */
  hitTest(raycaster: THREE.Raycaster): THREE.Intersection | null {
    const targets = this.getTargets()
    if (targets.length === 0) return null
    // 过滤不可见目标：自身或任一父节点 visible=false 均视为隐藏（父隐藏则子也看不到）
    const visibleTargets: THREE.Object3D[] = []
    for (const t of targets) {
      let o: THREE.Object3D | null = t
      let visible = true
      while (o) {
        if (!o.visible) {
          visible = false
          break
        }
        o = o.parent
      }
      if (visible) visibleTargets.push(t)
    }
    if (visibleTargets.length === 0) return null
    const hits = raycaster.intersectObjects(visibleTargets, false)
    return hits.length > 0 ? hits[0] : null
  }

  /**
   * 处理点击事件（带防连点）。命中时先触发 onPress（按下），再触发 onClick（点击逻辑）。
   * 返回 true 表示本次点击已命中消费。
   */
  handleClick(raycaster: THREE.Raycaster): boolean {
    // 已销毁的组件（残留注册表）不应再响应点击 —— 直接拒绝
    if (this.isDestroyed() || this.owner.isDestroyed()) return false
    const now = performance.now()
    if (now - this._lastClickTime < this.clickCooldown) return false

    const hit = this.hitTest(raycaster)
    if (hit) {
      this._lastClickTime = now
      this._pressed = true
      // 按下视觉/状态先于点击逻辑（按钮长按保持按下）
      this.onPress?.(hit)
      this.onClick?.(hit)
      return true
    }
    return false
  }

  /**
   * 处理释放事件（mouseup 时由 PhySys 对按中的对象分发，无需射线）。
   * 无论鼠标在哪里松开（拖出按钮/窗口外），只要之前按下过就恢复。
   */
  handleRelease(): void {
    if (this.isDestroyed() || this.owner.isDestroyed() || !this._pressed) return
    this._pressed = false
    this.onRelease?.()
  }

  /**
   * 处理悬停事件（自动追踪 hover 状态变化）。
   * 返回当前是否正在悬停。
   */
  handleHover(raycaster: THREE.Raycaster): boolean {
    // 已销毁的组件（残留注册表）不应再响应悬停 —— 直接拒绝
    if (this.isDestroyed() || this.owner.isDestroyed()) return false
    const hit = this.hitTest(raycaster)
    const hovering = hit !== null

    if (hovering !== this._hovering) {
      this._hovering = hovering
      this.onHover?.(hit ?? null)
    }
    return hovering
  }

  /** 当前悬停状态 */
  get isHovering(): boolean {
    return this._hovering
  }
}
