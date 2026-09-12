/**
 * WarmCurrentController — 指针事件 → 星图交互路由
 *
 * 3D 俯视相机下编辑器注入的 worldPos 是 z=0 平面交点（不适用），
 * 这里对齐 hoi4 的拾取方式：屏幕坐标 → 自身相机射线 ∩ y=0 地面 → 星图画布坐标。
 * 释放事件无 screen 通道，用最近一次已知光标位置兜底。
 * 全息勘探（2026-09-12）：矿点在球面 y≠0 平面上，地面射线拾取不适用 →
 * 左键轻点（down/up 位移 ≤ 阈值）以屏幕坐标直派 GameMode.onHologramTap 做投影拾取；
 * 位移超阈值 = 环绕拖拽（相机层消费），不触发点选。
 */
import * as THREE from 'three'
import { PlayerController } from '@/engine'
import type { WarmCurrentGameMode } from './WarmCurrentGameMode'
import { MAP_H, MAP_W } from '../core/balance'

/** 轻点判定位移阈值（px；超过 = 拖拽环绕） */
const TAP_SLOP_PX = 6

export class WarmCurrentPlayerController extends PlayerController {
  private mode: WarmCurrentGameMode
  private lastMap: { x: number; y: number } | null = null
  private readonly _ndc = new THREE.Vector2()
  private readonly _raycaster = new THREE.Raycaster()
  private readonly _hit = new THREE.Vector3()
  /** 最近已知光标屏幕坐标（释放事件无 screen 通道的兜底 + 轻点判定基准） */
  private lastScreen: { x: number; y: number } | null = null
  /** 本轮按下的屏幕坐标（null = 按下事件未经过此处） */
  private downScreen: { x: number; y: number } | null = null

  constructor(mode: WarmCurrentGameMode) {
    super()
    this.mode = mode
    // 释放（无 screen 通道）：用最后已知光标位置结算拖拽 / 全息轻点。
    // downScreen 只在 OnPointerDownScreen 记录（UI 消费的点击不会走到那里）——
    // 点面板按钮的释放不会误判为全息轻点。
    this.inputComponent.BindMouseButton((button, eventType) => {
      if (button !== 0 || eventType !== 'released' || !this.lastScreen) return
      if (this.mode.hologramSel) {
        const d0 = this.downScreen
        const moved = !d0 || Math.hypot(this.lastScreen.x - d0.x, this.lastScreen.y - d0.y) > TAP_SLOP_PX
        if (!moved) this.mode.onHologramTap(this.lastScreen.x, this.lastScreen.y)
        return
      }
      if (this.lastMap) this.mode.onMapPointerUp(this.lastMap)
    })
  }

  /** 屏幕坐标 → 星图画布坐标（射线 ∩ y=0 地面，再减当前视图舞台位移——行星系视角世界被搬到远景舞台） */
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
    const off = this.mode.viewStageOffset()
    return { x: this._hit.x + MAP_W / 2 - off.x, y: this._hit.z + MAP_H / 2 - off.z }
  }

  override OnPointerDownScreen(screenX: number, screenY: number): void {
    this.lastScreen = { x: screenX, y: screenY }
    this.downScreen = { x: screenX, y: screenY }
    const map = this.toMap(screenX, screenY)
    if (map) {
      this.lastMap = map
      this.mode.onMapPointerDown(map)
    }
  }

  override OnPointerMoveScreen(screenX: number, screenY: number): void {
    this.lastScreen = { x: screenX, y: screenY }
    // 转发给相机云台（屏幕边缘平移的鼠标位置源）
    this.mode.cameraActor?.rig.setMouseScreen(screenX, screenY)
    const map = this.toMap(screenX, screenY)
    if (map) {
      this.lastMap = map
      this.mode.onMapPointerMove(map)
    }
  }
}
