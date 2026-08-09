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

class PhySysImpl {
  /** 全局复用 raycaster */
  readonly raycaster = new THREE.Raycaster()

  private readonly _ndc = new THREE.Vector2()
  private _camera: THREE.Camera | null = null
  private _uiEl: HTMLElement | null = null
  private _ready = false

  /** UI 独立叠加相机（双摄像机：UI 层点击用平行射线，与渲染相机一致） */
  private _uiCamera: THREE.Camera | null = null

  // ═══════════════════════════════════
  //  ClickableComponent 注册表（按层分流）
  // ═══════════════════════════════════

  /** 世界层：主相机射线检测（3D 物体/建筑） */
  private _clickables = new Set<ClickableComponent>()
  /** UI 层：UI 相机平行射线检测（屏幕空间 UI 面板） */
  private _uiClickables = new Set<ClickableComponent>()

  register(c: ClickableComponent): void {
    if (c.layer === 'ui') this._uiClickables.add(c)
    else this._clickables.add(c)
  }

  unregister(c: ClickableComponent): void {
    this._clickables.delete(c)
    this._uiClickables.delete(c)
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
    // 清空 clickable 注册表：防止上一次运行残留的组件被再次命中
    // （残留组件闭包链会指向已销毁的旧 GameInstance/World，导致旧 world 被驱动）
    this._clickables.clear()
    this._uiClickables.clear()
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

  /** 点击检测：UI 层优先（UI 相机平行射线，命中即消费），再世界层（主相机射线） */
  raycastClick(screenX: number, screenY: number): boolean {
    // 1. UI 层：命中即消费点击（UI 永远在顶层，挡住 3D）
    if (this._uiCamera && this._uiClickables.size > 0) {
      const uiRay = this.screenToRay(screenX, screenY, this._uiCamera)
      if (uiRay) {
        for (const c of this._uiClickables) {
          if (c.bEnabled && c.handleClick(uiRay)) return true
        }
      }
    }
    // 2. 世界层
    const raycaster = this.screenToRay(screenX, screenY)
    if (!raycaster) return false
    for (const c of this._clickables) {
      if (c.bEnabled && c.handleClick(raycaster)) return true
    }
    return false
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

/** 全局物理系统单例 */
export const PhySys = new PhySysImpl()
