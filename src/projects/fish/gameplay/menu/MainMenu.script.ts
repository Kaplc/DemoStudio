/**
 * MainMenuScript — ClashMaster 主菜单行为脚本
 *
 * 挂载于 main_menu.widget.html 的开始按钮（data-script="gameplay/menu/MainMenu"）：
 *  1. 绑定按钮 onClick → FishMainMenuGameMode.startGame()（进入基地阶段）
 *  2. 消费编译器透传的交互态色（源文件 .StartButton:hover/:active → UIScript.args），
 *     轮询按钮状态机给背景 Image 上色（UIButtonComponent 不代理颜色，见其文件头）
 */
import { BehaviourScript, UIButtonComponent, UIImageComponent, logger } from '@/engine'
import { FishMainMenuGameMode } from './FishMainMenuGameMode'

/** 编译器 emitButtonStates 透传的交互态（仅 color/opacity） */
interface InteractiveStateArgs {
  hover?: { color?: string; opacity?: number }
  pressed?: { color?: string; opacity?: number }
}

export default class MainMenuScript extends BehaviourScript {
  private button: UIButtonComponent | null = null
  private image: UIImageComponent | null = null
  private baseColor: string | null = null
  private hoverColor: string | null = null
  private pressedColor: string | null = null

  override onStart(args?: Record<string, unknown>): void {
    this.button = this.actor.getComponent(UIButtonComponent)
    this.image = this.actor.getComponent(UIImageComponent)
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

    const states = (args ?? {}) as InteractiveStateArgs
    this.hoverColor = states.hover?.color ?? null
    this.pressedColor = states.pressed?.color ?? null
    this.baseColor = this.image?.color ?? null
  }

  override onUpdate(_deltaTime: number): void {
    if (!this.button || !this.image) return
    const target =
      this.button.state === 'pressed' ? this.pressedColor
      : this.button.state === 'hover' ? this.hoverColor
      : this.baseColor
    if (target && this.image.color !== target) this.image.color = target
  }
}
