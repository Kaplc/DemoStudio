/**
 * WarmCurrentMenuPlayerController — 主菜单阶段 PlayerController（fish 同款占位）
 * 菜单交互全部由 UI 按钮完成，此 Controller 保持引擎输入管线一致性。
 */
import { PlayerController } from '@/engine'

export class WarmCurrentMenuPlayerController extends PlayerController {
  constructor() {
    super('WarmCurrentMenuPlayerController')
  }
}
