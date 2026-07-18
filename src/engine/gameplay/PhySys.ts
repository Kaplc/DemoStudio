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

  // ═══════════════════════════════════
  //  ClickableComponent 注册表
  // ═══════════════════════════════════

  private _clickables = new Set<ClickableComponent>()

  register(c: ClickableComponent): void {
    this._clickables.add(c)
  }

  unregister(c: ClickableComponent): void {
    this._clickables.delete(c)
  }

  get clickableCount(): number {
    return this._clickables.size
  }

  // ═══════════════════════════════════
  //  Camera / UI 设置
  // ═══════════════════════════════════

  setup(camera: THREE.Camera, uiEl: HTMLElement): void {
    this._camera = camera
    this._uiEl = uiEl
    this._ready = true
  }

  clear(): void {
    this._camera = null
    this._uiEl = null
    this._ready = false
  }

  get ready(): boolean {
    return this._ready && this._camera !== null && this._uiEl !== null
  }

  // ═══════════════════════════════════
  //  射线检测
  // ═══════════════════════════════════

  /** 屏幕坐标 → Raycaster（复用内部实例，无 GC） */
  screenToRay(screenX: number, screenY: number): THREE.Raycaster | null {
    if (!this._ready || !this._camera || !this._uiEl) return null

    const rect = this._uiEl.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null

    this._ndc.set(
      ((screenX - rect.left) / rect.width) * 2 - 1,
      -((screenY - rect.top) / rect.height) * 2 + 1,
    )

    this.raycaster.setFromCamera(this._ndc, this._camera)
    return this.raycaster
  }

  /** 点击检测：遍历所有注册的 ClickableComponent，命中一个即停止 */
  raycastClick(screenX: number, screenY: number): boolean {
    const raycaster = this.screenToRay(screenX, screenY)
    if (!raycaster) return false
    for (const c of this._clickables) {
      if (c.bEnabled && c.handleClick(raycaster)) return true
    }
    return false
  }

  /** 悬停检测：遍历所有注册的 ClickableComponent */
  raycastHover(screenX: number, screenY: number): void {
    const raycaster = this.screenToRay(screenX, screenY)
    if (!raycaster) return
    for (const c of this._clickables) {
      if (c.bEnabled) c.handleHover(raycaster)
    }
  }
}

/** 全局物理系统单例 */
export const PhySys = new PhySysImpl()
