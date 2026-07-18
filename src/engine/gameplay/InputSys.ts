/**
 * InputSys — 输入系统（由 GameInstance 管理）
 *
 * 职责：
 * Viewport 将鼠标事件转发至此，InputSys 负责：
 * 1. 调用 PhySys 单例做 ClickableComponent 射线检测
 * 2. 转发到当前阶段的 Controller（OnPointerDown/Move）
 */
import * as THREE from 'three'
import { PhySys } from './PhySys'
import type { PlayerController } from './PlayerController'

export class InputSys {
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
}
