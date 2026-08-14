/**
 * InputPromptSystem — 输入提示系统（极简版：输入设备检测 + 提示文本切换）
 *
 * 能力：
 *  - 检测最近使用的输入设备（keyboard / mouse / touch），由 InputSys 事件驱动
 *  - prompt(kbLabel, mouseLabel)：返回当前设备对应的提示文本（"按 E 交互" / "点击交互"）
 *  - onDeviceChanged：设备切换回调（UI 提示文本刷新用）
 *
 * 设计说明：
 *  - 极简版不含手柄图标集（无 Gamepad API）；未来上手柄时在此扩展设备类型
 *  - 引擎层无设置持久化；设备为运行时状态，默认 mouse
 *
 * 用法：
 *   InputPromptSystem.instance.onDeviceChanged = (device) => refreshPrompts()
 *   textComp.text = InputPromptSystem.instance.prompt('按 E 交互', '点击交互')
 *
 * 驱动：InputSys.handleKeyDown → setDevice('keyboard')；handlePointerDown/Move/Up → setDevice('mouse')
 */
import { logger } from '../Logger'

export type InputDevice = 'keyboard' | 'mouse' | 'touch'

export class InputPromptSystem {
  private static _instance: InputPromptSystem | null = null

  /** 全局单例（懒创建） */
  static get instance(): InputPromptSystem {
    if (!InputPromptSystem._instance) InputPromptSystem._instance = new InputPromptSystem()
    return InputPromptSystem._instance
  }

  private _device: InputDevice = 'mouse'
  /** 设备切换回调（参数为新的设备类型） */
  onDeviceChanged: ((device: InputDevice) => void) | null = null

  /** 当前设备 */
  get device(): InputDevice { return this._device }

  /**
   * 更新最近使用的输入设备（由 InputSys 事件驱动）。
   * 仅在设备类型变化时触发 onDeviceChanged。
   */
  setDevice(device: InputDevice): void {
    if (device === this._device) return
    logger.info(`[InputPromptSystem] 输入设备切换: ${this._device} → ${device}`)
    this._device = device
    this.onDeviceChanged?.(device)
  }

  /**
   * 返回当前设备对应的提示文本。
   * @param kbLabel    键盘提示（如 '按 E 交互'）
   * @param mouseLabel 鼠标/触控提示（如 '点击交互'）
   */
  prompt(kbLabel: string, mouseLabel: string): string {
    return this._device === 'keyboard' ? kbLabel : mouseLabel
  }
}
