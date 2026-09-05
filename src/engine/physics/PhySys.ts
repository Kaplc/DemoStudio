/**
 * PhySys — 物理系统全局单例
 *
 * 职责：
 * 1. 全局复用 THREE.Raycaster（避免每帧 new 对象）
 * 2. 管理 ClickableComponent 注册表（只有挂载该组件的对象才被射线检测）
 * 3. 提供 screenToRay / raycastClick / raycastHover 接口
 *
 * 命中仲裁（UE 语义）：UI 层先解（clickable 与 block 画布按 zOrder 竞争），世界层收集全部
 * 命中取射线最近者（pickFrontmostHit）——注册顺序不参与归属，被 UI/面板遮挡的世界物体
 * 收不到点击与 hover；block 画布按所属空间分流（屏幕画布归 UI 层、world 模式画布归世界层）。
 *
 * 使用方式：
 * - ClickableComponent 在 BeginPlay/EndPlay 时自动 register/unregister
 * - GameInstance 在阶段切换时调用 PhySys.setup(camera, uiEl) 更新相机
 * - InputSys.handlePointerDown/Move 内部调用 PhySys.raycastClick/Hover
 */
import * as THREE from 'three'
import type { ClickableComponent } from './ClickableComponent'
import type { CanvasUIComponent } from '../rendering/CanvasUIComponent'
import { logger } from '../Logger'
import type { GameSingleton } from '../gameflow/Game'

class PhySysImpl implements GameSingleton {
  readonly name = 'PhySys'

  /** 全局复用 raycaster */
  readonly raycaster = new THREE.Raycaster()

  private readonly _ndc = new THREE.Vector2()
  private _camera: THREE.Camera | null = null
  private _uiEl: HTMLElement | null = null
  private _ready = false

  /** UI 独立叠加相机（双摄像机：UI 层点击用平行射线，与渲染相机一致） */
  private _uiCamera: THREE.Camera | null = null

  /** 当前处于按下状态的 ClickableComponent（mouseup 时向其分发释放；null = 无） */
  private _pressedClickable: ClickableComponent | null = null

  // ═══════════════════════════════════
  //  ClickableComponent 注册表（按层分流）
  // ═══════════════════════════════════

  /** 世界层：主相机射线检测（3D 物体/建筑） */
  private _clickables = new Set<ClickableComponent>()
  /** UI 层：UI 相机平行射线检测（屏幕空间 UI 面板） */
  private _uiClickables = new Set<ClickableComponent>()
  /** UI 层点击拦截画布（CanvasUIComponent hitTestMode='block'）：命中即消费，挡住更低层级 UI/世界 */
  private _uiBlockers = new Set<CanvasUIComponent>()

  register(c: ClickableComponent): void {
    if (c.layer === 'ui') this._uiClickables.add(c)
    else this._clickables.add(c)
  }

  unregister(c: ClickableComponent): void {
    this._clickables.delete(c)
    this._uiClickables.delete(c)
    // 注销的组件不再接收释放分发（防止残留引用）
    if (this._pressedClickable === c) this._pressedClickable = null
  }

  /** 注册 UI 点击拦截画布（CanvasUIComponent hitTestMode='block' 时调用） */
  registerUIBlocker(ui: CanvasUIComponent): void {
    if (this._uiBlockers.has(ui)) return
    this._uiBlockers.add(ui)
    logger.debug(`[PhySys] 注册 UI 点击拦截画布: ${ui.name}`)
  }

  /** 注销 UI 点击拦截画布（组件销毁/退出 block 模式时调用） */
  unregisterUIBlocker(ui: CanvasUIComponent): void {
    if (this._uiBlockers.delete(ui)) {
      logger.debug(`[PhySys] 注销 UI 点击拦截画布: ${ui.name}`)
    }
  }

  get clickableCount(): number {
    return this._clickables.size + this._uiClickables.size
  }

  // ═══════════════════════════════════
  //  Camera / UI 设置
  // ═══════════════════════════════════

  setup(camera: THREE.Camera, uiEl: HTMLElement): void {
    this._camera = camera
    this._uiEl = uiEl
    this._ready = true
  }

  /** 当前视口 DOM 元素（屏幕坐标 → 世界坐标换算容器，供外部获取视口尺寸/边界） */
  get viewportElement(): HTMLElement | null {
    return this._uiEl
  }

  /** 设置 UI 独立叠加相机（由 Game 启动时传入 SceneRendererComponent.uiCamera） */
  setupUI(camera: THREE.Camera | null): void {
    this._uiCamera = camera
  }

  clear(): void {
    this._camera = null
    this._uiEl = null
    this._uiCamera = null
    this._ready = false
    this._pressedClickable = null
    // 清空 clickable 注册表：防止上一次运行残留的组件被再次命中
    // （残留组件闭包链会指向已销毁的旧 GameInstance/World，导致旧 world 被驱动）
    this._clickables.clear()
    this._uiClickables.clear()
    this._uiBlockers.clear()
  }

  /** GameSingleton：游戏停止时回收运行状态（等价 clear） */
  reset(): void {
    this.clear()
  }

  get ready(): boolean {
    return this._ready && this._camera !== null && this._uiEl !== null
  }

  // ═══════════════════════════════════
  //  射线检测
  // ═══════════════════════════════════

  /**
   * 屏幕坐标 → Raycaster（复用内部实例，无 GC）。
   * @param camera 指定相机（默认主相机；UI 层传 UI 相机做平行射线）
   */
  screenToRay(screenX: number, screenY: number, camera?: THREE.Camera | null): THREE.Raycaster | null {
    if (!this._ready || !this._camera || !this._uiEl) return null
    const cam = camera ?? this._camera
    if (!cam) return null

    const rect = this._uiEl.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null

    // 相机可能不参与渲染（如 CameraComponent 内部相机由 syncCamera 驱动），
    // matrixWorld 未更新会导致 setFromCamera 用陈旧矩阵算出错误射线（方向错/原点 0,0,0）。
    // 每次射线前强制刷新，保证位置/朝向最新。
    cam.updateMatrixWorld()

    this._ndc.set(
      ((screenX - rect.left) / rect.width) * 2 - 1,
      -((screenY - rect.top) / rect.height) * 2 + 1,
    )

    this.raycaster.setFromCamera(this._ndc, cam)
    return this.raycaster
  }

  /** 点击检测：UI 层优先（UI 永远在顶层），世界层按射线最近命中仲裁（UE 语义：游戏输入是 UI 未命中时的兜底） */
  raycastClick(screenX: number, screenY: number): boolean {
    // 1. UI 层：zOrder 竞争（clickable 与 block 画布），命中即消费
    if (this._uiCamera) {
      const uiRay = this.screenToRay(screenX, screenY, this._uiCamera)
      if (uiRay) {
        const top = this.resolveUIStage(uiRay)
        if (top?.kind === 'blocked') {
          logger.debug(`[PhySys] 点击被 UI 拦截画布消费（zOrder=${top.z}）`)
          return true
        }
        if (top?.kind === 'clickable' && top.clickable) {
          if (top.clickable.handleClick(uiRay)) {
            this._pressedClickable = top.clickable
            return true
          }
          // 处理失败（冷却中/已销毁）：保持旧行为落到世界层，不让被遮挡者接管
        }
      }
    }
    // 2. 世界层：收集全部命中（clickable + world 模式 block 画布）取射线最近者，
    //    注册顺序不再参与仲裁（信息牌按钮不再被身后先注册的建筑抢走点击）
    const raycaster = this.screenToRay(screenX, screenY)
    if (!raycaster) return false
    const top = this.resolveWorldStage(raycaster)
    if (top?.kind === 'blocked') {
      logger.debug(`[PhySys] 点击被 world 模式 UI 画布拦截（zOrder=${top.z}）`)
      return true
    }
    if (top?.kind === 'clickable' && top.clickable) {
      if (top.clickable.handleClick(raycaster)) {
        this._pressedClickable = top.clickable
        return true
      }
      // 冷却中/已失效：本次点击穿到 controller（与旧行为一致：快速连点建筑落到空地关闭信息牌）
    }
    return false
  }

  /**
   * 释放检测：鼠标释放时对按中的对象分发 handleRelease（无需射线，
   * 拖出按钮/窗口外松开也能恢复）。幂等：无按中对象时直接返回。
   */
  raycastRelease(): void {
    const c = this._pressedClickable
    this._pressedClickable = null
    if (c && c.bEnabled) c.handleRelease()
  }

  /**
   * 拖拽移动分发：鼠标移动时对按中的对象分发 handleDragMove（无需射线，
   * 拖出命中区域外仍持续收到——拖拽滚动依赖此特性）。幂等：无按中对象时直接返回。
   */
  dispatchDragMove(screenX: number, screenY: number): void {
    const c = this._pressedClickable
    if (c && c.bEnabled && !c.isDestroyed()) c.handleDragMove(screenX, screenY)
  }
  /** 是否处于拖拽中（按下且尚未释放）；InputSys 据此跳过拖拽期间的 hover 射线检测 */
  get isDragging(): boolean {
    return this._pressedClickable !== null
  }
  /** 悬停检测：互斥语义（UE 式）——只有每层最前端命中者处于 hover；被 UI 消费时世界层全部熄灭 */
  raycastHover(screenX: number, screenY: number): void {
    let uiConsumed = false
    let uiWinner: ClickableComponent | null = null
    if (this._uiCamera && (this._uiClickables.size > 0 || this._uiBlockers.size > 0)) {
      const uiRay = this.screenToRay(screenX, screenY, this._uiCamera)
      if (uiRay) {
        const top = this.resolveUIStage(uiRay)
        if (top?.kind === 'clickable' && top.clickable) {
          top.clickable.handleHover(uiRay)
          uiWinner = top.clickable
          uiConsumed = true
        } else if (top?.kind === 'blocked') {
          // 拦截画布之下的 clickable 不再 hover（GM 控制台打开时其下按钮/世界悬停熄灭）
          uiConsumed = true
        }
      }
    }
    // 非中选者统一清 hover（含 UI 层无命中时的全清）
    for (const c of this._uiClickables) {
      if (c === uiWinner) continue
      if (c.isHovering) c.clearHover()
    }
    if (uiConsumed) {
      // UI 层接住了指针：世界层 hover 全部熄灭（面板背后的建筑不再透出高亮）
      for (const c of this._clickables) {
        if (c.isHovering) c.clearHover()
      }
      return
    }
    // 世界层：同样只保留最前端
    const raycaster = this.screenToRay(screenX, screenY)
    if (!raycaster) return
    const top = this.resolveWorldStage(raycaster)
    const worldWinner = top?.kind === 'clickable' ? top.clickable : null
    if (worldWinner) worldWinner.handleHover(raycaster)
    for (const c of this._clickables) {
      if (c === worldWinner) continue
      if (c.isHovering) c.clearHover()
    }
  }

  // ═══════════════════════════════════
  //  命中仲裁（几何决定归属，与注册顺序无关）
  // ═══════════════════════════════════

  /** UI 层解析：clickable（zOrder 竞争）+ 屏幕 block 画布 → 最前端命中；无命中返回 null */
  private resolveUIStage(uiRay: THREE.Raycaster): HitCandidate | null {
    const candidates: HitCandidate[] = []
    for (const c of this._uiClickables) {
      if (!c.bEnabled || c.isDestroyed()) continue
      const hit = c.hitTest(uiRay)
      if (hit) candidates.push({ kind: 'clickable', clickable: c, distance: hit.distance, z: c.uiZOrder })
    }
    for (const b of this._uiBlockers) {
      if (!b.panel || !isVisibleChain(b.panel)) continue
      // world 模式画布在世界坐标系，UI 相机（原点附近正交）的射线会数值性误命中 → 只归世界层管
      if (isWorldModeUI(b.owner)) continue
      const hits = rayWithFreshMatrix(uiRay, b.panel)
      if (hits) candidates.push({ kind: 'blocked', distance: hits.distance, z: b.zOrder })
    }
    return pickFrontmostHit(candidates)
  }

  /** 世界层解析：世界 clickable + world 模式 block 画布 → 射线最近命中；无命中返回 null */
  private resolveWorldStage(ray: THREE.Raycaster): HitCandidate | null {
    const candidates: HitCandidate[] = []
    for (const c of this._clickables) {
      if (!c.bEnabled || c.isDestroyed()) continue
      const hit = c.hitTest(ray)
      if (hit) candidates.push({ kind: 'clickable', clickable: c, distance: hit.distance, z: c.uiZOrder })
    }
    for (const b of this._uiBlockers) {
      if (!b.panel || !isVisibleChain(b.panel)) continue
      if (!isWorldModeUI(b.owner)) continue
      const hits = rayWithFreshMatrix(ray, b.panel)
      if (hits) candidates.push({ kind: 'blocked', distance: hits.distance, z: b.zOrder })
    }
    return pickFrontmostHit(candidates)
  }

  /** 诊断：给定屏幕点输出世界层全部命中候选（Playwright 定位仲裁问题用） */
  debugWorldCandidates(screenX: number, screenY: number): string[] {
    const ray = this.screenToRay(screenX, screenY)
    if (!ray) return []
    const out: string[] = []
    for (const c of this._clickables) {
      if (!c.bEnabled || c.isDestroyed()) continue
      const hit = c.hitTest(ray)
      if (hit) out.push(`clickable:${c.owner.root.name}@z${c.uiZOrder}@d${hit.distance.toFixed(4)}`)
    }
    for (const b of this._uiBlockers) {
      if (!b.panel || !isVisibleChain(b.panel)) continue
      if (!isWorldModeUI(b.owner)) continue
      const hit = rayWithFreshMatrix(ray, b.panel)
      if (hit) out.push(`blocked:${b.owner.root.name}@z${b.zOrder}@d${hit.distance.toFixed(4)}`)
    }
    return out
  }
}

/** Object3D 沿父链是否全部可见（自身或任一祖先 visible=false 视为隐藏，射线应穿过） */
function isVisibleChain(o: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = o
  while (cur) {
    if (!cur.visible) return false
    cur = cur.parent
  }
  return true
}

/**
 * owner 或祖先链是否为 world 模式 UI（UIWorldAnchorComponent.applyWorldMode 打的 __dsWorldUI 标记）。
 * 内联实现而非引 CanvasUIComponent.isInWorldUI：CanvasUI 已值导入 PhySys，反向值导入成环。
 */
function isWorldModeUI(owner: { root: THREE.Object3D; parent: unknown } | null | undefined): boolean {
  for (let a = owner as { root: THREE.Object3D; parent: unknown } | null; a; a = a.parent as typeof a) {
    if (a.root.userData.__dsWorldUI) return true
  }
  return false
}

/**
 * 刷新 mesh 世界矩阵后做射线相交（返回最近交点或 null）。
 * blocker 面板是逐帧 billboard/缩放的（world 模式 constantScreenSize），不刷新会用
 * 上一帧矩阵算错命中——与 ClickableComponent.hitTest 的父链刷新同款保障。
 */
function rayWithFreshMatrix(ray: THREE.Raycaster, mesh: THREE.Mesh): THREE.Intersection | null {
  mesh.updateWorldMatrix(true, false)
  const hits = ray.intersectObject(mesh, false)
  return hits.length > 0 ? hits[0] : null
}

// ═══════════════════════════════════════════
//  命中仲裁（纯函数，可单测）
// ═══════════════════════════════════════════

/** 命中候选条目（clickable 命中或 block 画布拦截） */
export interface HitCandidate {
  kind: 'clickable' | 'blocked'
  /** 射线距离（世界单位） */
  distance: number
  /** UI 层级（遮挡竞争平局用；world 层 3D 物体恒 0） */
  z: number
  /** kind='clickable' 时的组件 */
  clickable?: ClickableComponent
}

/** 距离差小于该值视为同一平面（world 模式 z 偏移经 1/pxPerMeter 缩放后约 5e-5 米，按钮点击层 vs 面板底板靠 zOrder 决胜） */
export const SAME_PLANE_EPS = 1e-3

/**
 * 取最前端命中：射线最近者；同面（距离差 < SAME_PLANE_EPS）按 zOrder 高者胜、
 * 同 z 时 clickable 优先于拦截画布（对齐 UE 绘制序语义）。空集返回 null。
 */
export function pickFrontmostHit(candidates: HitCandidate[]): HitCandidate | null {
  let best: HitCandidate | null = null
  for (const c of candidates) {
    if (!best) {
      best = c
      continue
    }
    if (c.distance < best.distance - SAME_PLANE_EPS) {
      best = c
    } else if (c.distance <= best.distance + SAME_PLANE_EPS) {
      const cWins = c.z > best.z || (c.z === best.z && c.kind === 'clickable' && best.kind === 'blocked')
      if (cWins) best = c
    }
  }
  return best
}

/** 全局物理系统单例 */
export const PhySys = new PhySysImpl()
