/**
 * BattleResultScript — 战斗结算面板行为脚本
 *
 * 通过 UIScriptComponent 挂载到 battle_result.widget.json 的根节点：
 *  1. 读取 FishLevelGameMode.getBattleResult() → 填充胜负标题 + 掠夺明细
 *     （金币 + 药水数量，已在战斗结束时一次性入账）
 *  2. 「回基地」按钮（Btn_returnBase）→ FishGameInstance.returnToBase()
 *     （复用三阶段流程：清理战斗 GameMode/controller → switchToPhase('base')）
 *
 * 由 FishLevelGameMode.finishBattle 胜负判定后动态生成（挂到 HUD）。
 */
import { BehaviourScript, UIButtonComponent, UITextComponent, logger, GameInstance } from '@/engine'
import type { FishLevelGameMode } from '../level/FishLevelGameMode'
import type { FishGameInstance } from '../FishGameInstance'

export default class BattleResultScript extends BehaviourScript {
  override onStart(): void {
    const mode = this.gameMode as FishLevelGameMode | null
    const inst = GameInstance.current as FishGameInstance | null

    // ─── 1. 胜负标题 + 掠夺明细 ───
    const result = mode?.getBattleResult() ?? { win: null, lootCoins: 0, lootElixir: 0 }
    const titleActor = this.findInChildren('Title')
    const titleText = titleActor?.getComponent(UITextComponent)
    if (titleText) {
      titleText.text = result.win === true ? '🏆 战斗胜利' : result.win === false ? '💀 战斗失败' : '⚔ 战斗结束'
    } else {
      logger.warn('[BattleResultScript] 未找到标题节点 "Title"')
    }

    const lootActor = this.findInChildren('LootText')
    const lootText = lootActor?.getComponent(UITextComponent)
    if (lootText) {
      lootText.text = `掠夺入账：🪙 金币 +${result.lootCoins} · 🧪 药水 +${result.lootElixir}`
    } else {
      logger.warn('[BattleResultScript] 未找到掠夺明细节点 "LootText"')
    }

    // ─── 2. 回基地：走 FishGameInstance 阶段切换（清理战斗状态 → 基地） ───
    const backActor = this.findInChildren('Btn_returnBase')
    const backBtn = backActor?.getComponent(UIButtonComponent)
    if (backBtn && inst) {
      backBtn.onClick = () => inst.returnToBase()
      logger.info('[BattleResultScript] 已绑定"回基地" → returnToBase')
    } else {
      logger.warn(`[BattleResultScript] "回基地"未绑定（inst=${!!inst}, btn=${!!backBtn}）`)
    }
  }
}
