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
 *
 * 继承 BObject：纳入引擎对象体系（构造自动注册到 ObjectRegistry），
 * 由 GameInstance.teardown()（Game.shutdown 调用）驱动 EndPlay 终态化。
 */
import * as THREE from 'three'
import { PhySys } from '../physics/PhySys'
import { BObject } from '../entity/BObject'
import { InputPromptSystem } from '../ui/InputPromptSystem'
import type { PlayerController } from './PlayerController'

export class InputSys extends BObject {
  constructor() {
    super('InputSys')
  }
  // ════════════════════════════════════════════
  //   鼠标
  // ════════════════════════════════════════════

  /**
   * 鼠标按下。
   * @param button 鼠标按键（0=左键, 2=右键）。非左键不触发 ClickableComponent 点击检测，
   *               但会通过 controller.inputComponent.ProcessMouseButton 广播给订阅者（如摄像机右键平移）。
   * @returns 是否有 ClickableComponent 消费了点击
   */
  handlePointerDown(
    screenX: number,
    screenY: number,
    worldPos?: THREE.Vector3,
    controller?: PlayerController | null,
    button = 0,
  ): boolean {
    // 输入设备检测：鼠标按下 → 设备切换为 mouse（触发提示文本刷新）
    InputPromptSystem.instance.setDevice('mouse')
    // 仅左键参与点击检测（右键用于摄像机平移等，不应误触 UI/建筑点击）
    const consumed = button === 0 ? PhySys.raycastClick(screenX, screenY) : false
    // 广播鼠标按钮事件（外部组件可 BindMouseButton 订阅，如摄像机右键平移）
    controller?.inputComponent.ProcessMouseButton(button, 'pressed')
    // 已被 ClickableComponent 消费（UI 按钮/建筑点击）→ 不再下发 controller，
    // 避免同一击既触发按钮又触发放置/移动等地面逻辑（跨帧 clickConsumed 标记会吞掉下一次点击）
    if (consumed) return true
    // 左键才走控制器点击逻辑（右键语义交给订阅者）
    if (button === 0) {
      controller?.OnPointerDownScreen(screenX, screenY)
      if (worldPos) controller?.OnPointerDown(worldPos)
    }
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
    // 广播指针移动事件（外部组件可 BindPointerMove 订阅，如摄像机右键拖拽平移）
    controller?.inputComponent.ProcessPointerMove(screenX, screenY)
    if (worldPos) controller?.OnPointerMove(worldPos)
  }

  /**
   * 鼠标释放。
   * @param button 鼠标按键（0=左键, 2=右键），广播给 BindMouseButton 订阅者。
   */
  handlePointerUp(
    worldPos?: THREE.Vector3,
    controller?: PlayerController | null,
    button = 0,
  ): void {
    // 广播鼠标按钮事件（如摄像机右键平移结束）
    controller?.inputComponent.ProcessMouseButton(button, 'released')
    // 左键才走点击释放逻辑：分发按中对象的释放（长按保持按下，松手才恢复）
    if (button === 0) {
      PhySys.raycastRelease()
      if (worldPos) controller?.OnPointerUp(worldPos)
    }
  }

  // ════════════════════════════════════════════
  //   键盘
  // ════════════════════════════════════════════

  /** 键盘按下 */
  handleKeyDown(key: string, controller?: PlayerController | null): void {
    // 输入设备检测：键盘事件 → 设备切换为 keyboard（触发提示文本刷新）
    InputPromptSystem.instance.setDevice('keyboard')
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
    if (!controller) return
    // 输入系统触发到 Controller 的输入组件（外部组件可 BindScroll 订阅）
    controller.inputComponent.ProcessScroll(delta)
    // 兼容：仍调用 OnScroll 虚方法（子类旧实现）
    controller.OnScroll(delta)
  }
}
