/**
 * FishMainMenuPlayerController — 主菜单阶段 PlayerController
 *
 * 主菜单交互通过 React UI 按钮完成（点击"开始游戏"等），
 * 此 Controller 作为占位以保持引擎输入管线的一致性，
 * 无需处理鼠标输入。
 */
import { PlayerController } from '@/engine'

export class FishMainMenuPlayerController extends PlayerController {
  constructor() {
    super('FishMainMenuPlayerController')
  }
}
