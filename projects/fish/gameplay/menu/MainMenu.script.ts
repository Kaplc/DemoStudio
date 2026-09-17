/**
 * MainMenuScript — ClashMaster 主菜单行为脚本
 *
 * 挂载于 main_menu.widget.html 的开始按钮（data-script="gameplay/menu/MainMenu"）：
 * 绑定按钮 onClick → FishMainMenuGameMode.startGame()（进入基地阶段）。
 * （按钮 hover/pressed 变色由 UIButtonComponent.stateColors 原生驱动，脚本不轮询）
 */
import { BehaviourScript, UIButtonComponent, logger } from '@/engine'
import { FishMainMenuGameMode } from './FishMainMenuGameMode'

export default class MainMenuScript extends BehaviourScript {
  private button: UIButtonComponent | null = null

  override onStart(_args?: Record<string, unknown>): void {
    this.button = this.actor.getComponent(UIButtonComponent)
    if (!this.button) {
      logger.warn('[MainMenuScript] 挂载节点缺少 UIButtonComponent（应挂在 button 元素上）')
      return
    }

    const mode = this.gameMode as FishMainMenuGameMode | null
    if (mode) {
      this.button.onClick = () => mode.startGame()
      logger.info('[MainMenuScript] 开始按钮已绑定 → FishMainMenuGameMode.startGame')
    } else {
      logger.error('[MainMenuScript] gameMode 非 FishMainMenuGameMode，开始按钮未绑定')
    }
  }
}
