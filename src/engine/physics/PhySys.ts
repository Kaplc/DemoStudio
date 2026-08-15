/**
 * PhySys — 物理系统全局单例
 *
 * 职责：
 * 1. 全局复用 THREE.Raycaster（避免每帧 new 对象）
 * 2. 管理 ClickableComponent 注册表（只有挂载该组件的对象才被射线检测）
 * 3. 提供 screenToRay / raycastClick / raycastHover 接口
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

  /** 点击检测：UI 层优先（遮挡竞争：clickable 与 block 画布按 zOrder 竞争，最高者消费），再世界层 */
  raycastClick(screenX: number, screenY: number): boolean {
    // 1. UI 层：命中即消费点击（UI 永远在顶层，挡住 3D）
    if (this._uiCamera) {
      const uiRay = this.screenToRay(screenX, screenY, this._uiCamera)
      if (uiRay) {
        // ─── 遮挡竞争：收集所有命中者（clickable 命中 / block 画布命中），按 zOrder 取最高 ───
        let bestZ = -Infinity
        let bestClickable: ClickableComponent | null = null
        let topBlocked = false
        // 候选 1：可点击元素（zOrder 取 owner 及祖先链 CanvasUIComponent 最大层级）
        for (const c of this._uiClickables) {
          if (!c.bEnabled || c.isDestroyed()) continue
          if (c.hitTest(uiRay)) {
            const z = c.uiZOrder
            if (z > bestZ) {
              bestZ = z
              bestClickable = c
              topBlocked = false
            }
          }
        }
        // 候选 2：拦截画布（hitTestMode='block'，如 GM 控制台全屏遮罩）
        for (const b of this._uiBlockers) {
          if (!b.panel || !isVisibleChain(b.panel)) continue
          if (uiRay.intersectObject(b.panel, false).length > 0) {
            const z = b.zOrder
            // 同 zOrder 时 clickable 优先（同层按钮先于遮罩）
            if (z > bestZ) {
              bestZ = z
              bestClickable = null
              topBlocked = true
            }
          }
        }
        // 顶层是拦截画布 → 消费点击（后面的 UI/世界收不到）
        if (topBlocked) {
          logger.debug('[PhySys] 点击被 UI 拦截画布消费（zOrder=' + bestZ + '）')
          return true
        }
        if (bestClickable && bestClickable.handleClick(uiRay)) {
          this._pressedClickable = bestClickable
          return true
        }
      }
    }
    // 2. 世界层
    const raycaster = this.screenToRay(screenX, screenY)
    if (!raycaster) return false
    for (const c of this._clickables) {
      if (c.bEnabled && c.handleClick(raycaster)) {
        this._pressedClickable = c
        return true
      }
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
  /** 悬停检测：UI 层 + 世界层分别处理 */
  raycastHover(screenX: number, screenY: number): void {
    // 1. UI 层
    if (this._uiCamera && this._uiClickables.size > 0) {
      const uiRay = this.screenToRay(screenX, screenY, this._uiCamera)
      if (uiRay) {
        for (const c of this._uiClickables) {
          if (c.bEnabled) c.handleHover(uiRay)
        }
      }
    }
    // 2. 世界层
    const raycaster = this.screenToRay(screenX, screenY)
    if (!raycaster) return
    for (const c of this._clickables) {
      if (c.bEnabled) c.handleHover(raycaster)
    }
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

/** 全局物理系统单例 */
export const PhySys = new PhySysImpl()
