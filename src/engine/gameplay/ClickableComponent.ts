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
import { Component } from './Component'
import { PhySys } from './PhySys'

export class ClickableComponent extends Component {
  /** 点击回调：传入命中的 Intersection 信息 */
  onClick: ((hit: THREE.Intersection) => void) | null = null
  /** 悬停回调：传入命中信息（null 表示离开） */
  onHover: ((hit: THREE.Intersection | null) => void) | null = null

  /** 点击冷却时间 (ms) */
  clickCooldown = 500

  /** 是否正在被悬停 */
  private _hovering = false
  /** 防连点时间戳 */
  private _lastClickTime = 0
  /** 显式指定的检测目标 */
  private _explicitTargets: THREE.Object3D[] | null = null

  constructor(owner: import('./Actor').Actor) {
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
   */
  hitTest(raycaster: THREE.Raycaster): THREE.Intersection | null {
    const targets = this.getTargets()
    if (targets.length === 0) return null
    const hits = raycaster.intersectObjects(targets, false)
    return hits.length > 0 ? hits[0] : null
  }

  /**
   * 处理点击事件（带防连点）。
   * 返回 true 表示本次点击已命中消费。
   */
  handleClick(raycaster: THREE.Raycaster): boolean {
    const now = performance.now()
    if (now - this._lastClickTime < this.clickCooldown) return false

    const hit = this.hitTest(raycaster)
    if (hit) {
      this._lastClickTime = now
      this.onClick?.(hit)
      return true
    }
    return false
  }

  /**
   * 处理悬停事件（自动追踪 hover 状态变化）。
   * 返回当前是否正在悬停。
   */
  handleHover(raycaster: THREE.Raycaster): boolean {
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
