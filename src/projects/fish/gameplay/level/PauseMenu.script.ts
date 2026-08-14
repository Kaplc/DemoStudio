/**
 * PauseMenuScript — 关卡暂停菜单行为脚本
 *
 * 通过 UIScriptComponent 挂载到 pause_menu.widget.json 的根节点：
 *  1. "继续游戏"按钮（Btn_resume）→ FishLevelGameMode.closePauseMenu()（仅关闭菜单）
 *  2. "返回基地"按钮（Btn_returnBase）→ FishGameInstance.returnToBase()
 *     （复用三阶段流程：清理关卡 GameMode/controller → switchToPhase('base')）
 *
 * 由 FishLevelGameMode.togglePauseMenu（Esc）打开时生成。
 */
import { BehaviourScript, UIButtonComponent, logger, GameInstance } from '@/engine'
import type { FishLevelGameMode } from './FishLevelGameMode'
import type { FishGameInstance } from '../FishGameInstance'

export default class PauseMenuScript extends BehaviourScript {
  override onStart(): void {
    const mode = this.gameMode as FishLevelGameMode | null
    const inst = GameInstance.current as FishGameInstance | null

    // ─── 1. 继续游戏：关闭暂停菜单 ───
    const resumeActor = this.findInChildren('Btn_resume')
    const resumeBtn = resumeActor?.getComponent(UIButtonComponent)
    if (resumeBtn && mode) {
      resumeBtn.onClick = () => mode.closePauseMenu()
      logger.info('[PauseMenuScript] 已绑定"继续游戏" → closePauseMenu')
    } else {
      logger.warn(`[PauseMenuScript] "继续游戏"未绑定（mode=${!!mode}, btn=${!!resumeBtn}）`)
    }

    // ─── 2. 返回基地：走 FishGameInstance 阶段切换 ───
    const backActor = this.findInChildren('Btn_returnBase')
    const backBtn = backActor?.getComponent(UIButtonComponent)
    if (backBtn && inst) {
      backBtn.onClick = () => inst.returnToBase()
      logger.info('[PauseMenuScript] 已绑定"返回基地" → returnToBase')
    } else {
      logger.warn(`[PauseMenuScript] "返回基地"未绑定（inst=${!!inst}, btn=${!!backBtn}）`)
    }
  }
}
