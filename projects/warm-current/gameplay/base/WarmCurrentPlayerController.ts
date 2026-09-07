/**
 * WarmCurrentController — 指针事件 → 星图交互路由
 *
 * 3D 俯视相机下编辑器注入的 worldPos 是 z=0 平面交点（不适用），
 * 这里对齐 hoi4 的拾取方式：屏幕坐标 → 自身相机射线 ∩ y=0 地面 → 星图画布坐标。
 * 释放事件无 screen 通道，用最近一次已知光标位置兜底。
 */
import * as THREE from 'three'
import { PlayerController } from '@/engine'
import type { WarmCurrentGameMode } from './WarmCurrentGameMode'
import { MAP_H, MAP_W } from '../core/balance'

export class WarmCurrentPlayerController extends PlayerController {
  private mode: WarmCurrentGameMode
  private lastMap: { x: number; y: number } | null = null
  private readonly _ndc = new THREE.Vector2()
  private readonly _raycaster = new THREE.Raycaster()
  private readonly _hit = new THREE.Vector3()

  constructor(mode: WarmCurrentGameMode) {
    super()
    this.mode = mode
    // 释放（无 screen 通道）：用最后已知光标位置结算拖拽
    this.inputComponent.BindMouseButton((button, eventType) => {
      if (button === 0 && eventType === 'released' && this.lastMap) {
        this.mode.onMapPointerUp(this.lastMap)
      }
    })
  }

  /** 屏幕坐标 → 星图画布坐标（射线 ∩ y=0 地面） */
  private toMap(screenX: number, screenY: number): { x: number; y: number } | null {
    const el = this.mode.world?.gameRenderer?.uiLayer
    const cam = this.mode.gameCamera.camera
    if (!el || !cam) return null
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    this._ndc.set(
      ((screenX - rect.left) / rect.width) * 2 - 1,
      -((screenY - rect.top) / rect.height) * 2 + 1,
    )
    this._raycaster.setFromCamera(this._ndc, cam)
    const dir = this._raycaster.ray.direction
    if (dir.y >= -1e-6) return null
    const t = -this._raycaster.ray.origin.y / dir.y
    this._raycaster.ray.at(t, this._hit)
    return { x: this._hit.x + MAP_W / 2, y: this._hit.z + MAP_H / 2 }
  }

  override OnPointerDownScreen(screenX: number, screenY: number): void {
    const map = this.toMap(screenX, screenY)
    if (map) {
      this.lastMap = map
      this.mode.onMapPointerDown(map)
    }
  }

  override OnPointerMoveScreen(screenX: number, screenY: number): void {
    // 转发给相机云台（屏幕边缘平移的鼠标位置源）
    this.mode.cameraActor?.rig.setMouseScreen(screenX, screenY)
    const map = this.toMap(screenX, screenY)
    if (map) {
      this.lastMap = map
      this.mode.onMapPointerMove(map)
    }
  }
}
