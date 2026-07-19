/**
 * InputSys — 输入系统（由 GameInstance 管理）
 *
 * 职责：
 * Viewport 将全部输入转发至此，InputSys 负责：
 * 1. 调用 PhySys 单例做 ClickableComponent 射线检测
 * 2. 转发到当前阶段的 Controller
 *
 * 所有输入方法统一经由 GameInstance.inputSys 路由，
 * GameViewport 不再直接调用 PlayerController。
 */
import * as THREE from 'three'
import { PhySys } from '../physics/PhySys'
import type { PlayerController } from './PlayerController'

export class InputSys {
  // ════════════════════════════════════════════
  //   鼠标
  // ════════════════════════════════════════════

  /**
   * 鼠标按下。
   * @returns 是否有 ClickableComponent 消费了点击
   */
  handlePointerDown(
    screenX: number,
    screenY: number,
    worldPos?: THREE.Vector3,
    controller?: PlayerController | null,
  ): boolean {
    const consumed = PhySys.raycastClick(screenX, screenY)
    controller?.OnPointerDownScreen(screenX, screenY)
    if (worldPos) controller?.OnPointerDown(worldPos)
    return consumed
  }

  /** 鼠标移动 */
  handlePointerMove(
    screenX: number,
    screenY: number,
    worldPos?: THREE.Vector3,
    controller?: PlayerController | null,
  ): void {
    PhySys.raycastHover(screenX, screenY)
    controller?.OnPointerMoveScreen(screenX, screenY)
    if (worldPos) controller?.OnPointerMove(worldPos)
  }

  /** 鼠标释放 */
  handlePointerUp(
    worldPos?: THREE.Vector3,
    controller?: PlayerController | null,
  ): void {
    if (worldPos) controller?.OnPointerUp(worldPos)
  }

  // ════════════════════════════════════════════
  //   键盘
  // ════════════════════════════════════════════

  /** 键盘按下 */
  handleKeyDown(key: string, controller?: PlayerController | null): void {
    controller?.ProcessInput(key, 'pressed')
  }

  /** 键盘释放 */
  handleKeyUp(key: string, controller?: PlayerController | null): void {
    controller?.ProcessInput(key, 'released')
  }

  // ════════════════════════════════════════════
  //   滚轮
  // ════════════════════════════════════════════

  /** 滚轮滚动 */
  handleScroll(delta: number, controller?: PlayerController | null): void {
    controller?.OnScroll(delta)
  }
}
