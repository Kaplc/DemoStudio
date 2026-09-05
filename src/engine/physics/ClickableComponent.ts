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
// 值导入（uiZOrder 用 getComponent(CanvasUIComponent) 运行时查询；PhySys 对 CanvasUIComponent 仅 type 引用，无循环）
import { CanvasUIComponent } from '../rendering/CanvasUIComponent'

export class ClickableComponent extends Component<Actor> {
  /**
   * 所属层：
   *  - 'world'：3D 世界（主相机射线检测，默认）
   *  - 'ui'：屏幕空间 UI（独立 UI 相机平行射线检测，由 UIButtonComponent 等设置）
   *
   * 赋值即重注册：BeginPlay 按赋值瞬间的 layer 分流到 PhySys 注册表，而组件创建方
   * 普遍是 addComponent（同步 BeginPlay 注册为缺省 world）之后才改 layer——只改字段
   * 不迁移注册表会让 clickable 永久留在 world 集合，UI 射线永远扫不到（根因七）。
   */
  private _layer: 'ui' | 'world' = 'world'
  get layer(): 'ui' | 'world' {
    return this._layer
  }
  set layer(v: 'ui' | 'world') {
    if (this._layer === v) return
    // owner 已 BeginPlay = BeginPlay 时的注册已按旧 layer 落位 → 迁移注册表；
    // 未开始则尚无注册，BeginPlay 会按新 layer 注册
    const registered = this.owner?.bHasBegunPlay ?? false
    if (registered) PhySys.unregister(this)
    this._layer = v
    if (registered) PhySys.register(this)
  }

  /** 点击回调：传入命中的 Intersection 信息（含 point 坐标） */
  onClick: ((hit: THREE.Intersection) => void) | null = null
  /** 按下回调：mousedown 命中时触发（先于 onClick），长按保持由 onRelease 恢复 */
  onPress: ((hit: THREE.Intersection) => void) | null = null
  /** 释放回调：mouseup 时触发（无论鼠标是否仍在按钮上，只要之前按过） */
  onRelease: (() => void) | null = null
  /** 悬停回调：传入命中信息（null 表示离开） */
  onHover: ((hit: THREE.Intersection | null) => void) | null = null
  /**
   * 鼠标按下时回调（命中的 Intersection，含 point 坐标）。
   * 用于精确 UI 交互（如文本输入框根据点击 X 坐标定位光标字符位置）。
   */
  onMouseDown: ((hit: THREE.Intersection) => void) | null = null
  /**
   * 拖拽开始回调（按下后首次移动时触发，传入屏幕坐标）。
   * 绑定 onDragMove 时启用拖拽语义：位移超过阈值后 onClick 不再触发（拖拽 ≠ 点击）。
   */
  onDragStart: ((screenX: number, screenY: number) => void) | null = null
  /** 拖拽移动回调（按下期间鼠标移动，传入屏幕坐标；未按下不触发） */
  onDragMove: ((screenX: number, screenY: number) => void) | null = null
  /**
   * 拖拽结束回调（handleRelease 时触发；独立字段，不干扰 UIButtonComponent 的 onRelease）。
   * 用于拖拽松手后的收尾（如滚动列表回弹到边界）。
   */
  onDragEnd: (() => void) | null = null

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

  /**
   * 拖拽判定阈值（像素）：按下后移动距离超过该值视为拖拽。
   * 仅绑定 onDragMove 的组件启用（普通点击组件移动鼠标不会取消点击）。
   */
  private static readonly DRAG_THRESHOLD_PX = 8
  /** 按下时的屏幕坐标（拖拽位移判定基准；null = 尚未移动） */
  private _pressScreen: [number, number] | null = null
  /** 延迟到释放时触发的点击（拖拽语义下按下不立即触发）；null = 无待触发点击 */
  private _pendingClick: THREE.Intersection | null = null

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
      if (visible) {
        // 强制沿父链刷新世界矩阵：父链任何节点 matrixWorld 陈旧（如渲染停止/刚生成）
        // 时，raycaster.intersectObjects 会用旧矩阵算出错误命中（射线 miss）。
        t.updateWorldMatrix(true, false)
        visibleTargets.push(t)
      }
    }
    if (visibleTargets.length === 0) return null
    const hits = raycaster.intersectObjects(visibleTargets, false)
    return hits.length > 0 ? hits[0] : null
  }

  /**
   * 处理点击事件（带防连点）。命中时先触发 onPress（按下），再触发 onClick（点击逻辑）。
   * 拖拽语义（绑定了 onDragMove）：onClick 延迟到释放时触发，移动超过阈值即取消
   * （拖拽 ≠ 点击，滚动列表拖拽不误触按钮）。
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
      this._pressScreen = null
      this._pendingClick = null
      // 按下视觉/状态先于点击逻辑（按钮长按保持按下）
      this.onPress?.(hit)
      this.onMouseDown?.(hit)
      if (this.onDragMove) {
        // 拖拽语义：点击延迟到释放（未拖拽）时触发，位移超阈值取消
        this._pendingClick = hit
      } else {
        // 普通点击：按下即触发（保持原语义）
        this.onClick?.(hit)
      }
      return true
    }
    return false
  }

  /**
   * 处理拖拽移动（InputSys.handlePointerMove → PhySys.dispatchDragMove 分发，仅按下期间）。
   * 首次移动触发 onDragStart；位移超过阈值后取消待触发的 onClick（拖拽 ≠ 点击）。
   */
  handleDragMove(screenX: number, screenY: number): void {
    if (!this._pressed) return
    if (!this._pressScreen) {
      this._pressScreen = [screenX, screenY]
      this.onDragStart?.(screenX, screenY)
    } else {
      const dx = screenX - this._pressScreen[0]
      const dy = screenY - this._pressScreen[1]
      if (dx * dx + dy * dy > ClickableComponent.DRAG_THRESHOLD_PX * ClickableComponent.DRAG_THRESHOLD_PX) {
        this._pendingClick = null
      }
    }
    this.onDragMove?.(screenX, screenY)
  }

  /**
   * 处理释放事件（mouseup 时由 PhySys 对按中的对象分发，无需射线）。
   * 无论鼠标在哪里松开（拖出按钮/窗口外），只要之前按下过就恢复。
   */
  handleRelease(): void {
    if (this.isDestroyed() || this.owner.isDestroyed() || !this._pressed) return
    this._pressed = false
    // 是否发生过真实拖拽（移动过鼠标；handleDragMove 首次移动才设置 _pressScreen）
    const dragged = this._pressScreen !== null
    this._pressScreen = null
    // 拖拽语义下的延迟点击：未拖拽（位移未超阈值）时在此触发
    const hit = this._pendingClick
    this._pendingClick = null
    if (hit) this.onClick?.(hit)
    // 拖拽结束回调（滚动列表回弹等收尾；独立于 onRelease，按钮组件不占用此字段）
    // 仅真实拖拽后触发——纯点击（无位移）松手不触发回弹
    if (dragged) this.onDragEnd?.()
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

  /**
   * 强制清除悬停态（PhySys 互斥仲裁判定本组件被更前端元素覆盖时调用）。
   * leave 沿语义与 handleHover 未命中相同：onHover(null)。
   */
  clearHover(): void {
    if (!this._hovering) return
    this._hovering = false
    this.onHover?.(null)
  }

  /** 当前悬停状态 */
  get isHovering(): boolean {
    return this._hovering
  }

  /**
   * 遮挡竞争 zOrder：owner 及祖先链上 CanvasUIComponent 的最大 zOrder。
   * screen 与 world 模式 UI 通用——world 模式 clickable 的 layer 已切 'world'，
   * 不能再按 layer 短路（否则面板按钮 zOrder 恒 0，与底板/其他面板的平局裁决必输）；
   * 纯 3D clickable（建筑 clickZone 等）无 canvas 祖先，恒返回 0。
   */
  get uiZOrder(): number {
    let z = 0
    let a: Actor | null = this.owner
    while (a) {
      const ui = a.getComponent(CanvasUIComponent)
      if (ui && ui.zOrder > z) z = ui.zOrder
      a = a.parent
    }
    return z
  }
}
