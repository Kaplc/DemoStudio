/**
 * BarracksUiScript — 兵营专属 UI 行为脚本（Unity MonoBehaviour 风格）
 *
 * 通过 UIScriptComponent 挂载到 barracks_ui.widget.json 的根节点：
 *  1. 接管兵营面板的关闭按钮：点击后调用 GameMode.closeBarracksPanel()
 *  2. 读取兵种 DataTable（ConfigRegistry 'fish.troop'），填充 TroopList 网格：
 *     每个兵种条目（Troop_{id}）更新名称/属性文本与背景色，并绑定训练点击
 *     → GameMode.trainTroop(id)
 *
 * 由 FishBaseGameMode.openBarracksPanel 打开兵营 UI 时生成。
 */
import { BehaviourScript, UIButtonComponent, UITextComponent, UIImageComponent, logger } from '@/engine'
import type { FishBaseGameMode } from './FishBaseGameMode'

/** 兵种色数字 → CSS hex（如 0xe53935 → "#e53935"） */
function colorToCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

export default class BarracksUiScript extends BehaviourScript {
  override onStart(): void {
    const mode = this.gameMode as FishBaseGameMode | null
    if (!mode) {
      logger.warn('[BarracksUiScript] 未找到 FishBaseGameMode，跳过绑定')
      return
    }

    // ─── 1. 关闭按钮 ───
    const btnActor = this.findInChildren('Btn_barracksClose')
    if (!btnActor) {
      logger.warn('[BarracksUiScript] 未找到关闭按钮节点 "Btn_barracksClose"')
    } else {
      const btn = btnActor.getComponent(UIButtonComponent)
      if (!btn) {
        logger.warn('[BarracksUiScript] 关闭按钮缺少 UIButtonComponent')
      } else {
        btn.onClick = () => mode.closeBarracksPanel()
        logger.info('[BarracksUiScript] 已绑定关闭按钮 → closeBarracksPanel')
      }
    }

    // ─── 2. 兵种列表（读表填充） ───
    const troops = mode.getTroopTable()
    if (!troops) {
      logger.warn('[BarracksUiScript] 兵种表未加载（getTable 返回 undefined），兵种列表保留资产默认值')
      return
    }

    let filled = 0
    for (const id of troops.getRowNames()) {
      const troop = troops.getRow(id)
      if (!troop) continue
      const troopActor = this.findInChildren(`Troop_${id}`)
      if (!troopActor) {
        logger.warn(`[BarracksUiScript] 未找到兵种条目节点 "Troop_${id}"，跳过`)
        continue
      }

      // 名称文本
      const nameActor = this.findInChildren(`Name_${id}`)
      const nameText = nameActor?.getComponent(UITextComponent)
      if (nameText) nameText.text = troop.name

      // 属性文本（HP · 伤害 · 费用）
      const infoActor = this.findInChildren(`Info_${id}`)
      const infoText = infoActor?.getComponent(UITextComponent)
      if (infoText) {
        infoText.text = `HP ${troop.hp} · ${troop.dps > 0 ? `伤 ${troop.dps}` : '治疗'} · 费 ${troop.cost}`
      }

      // 背景色（兵种色）
      const bg = troopActor.getComponent(UIImageComponent)
      if (bg) bg.color = colorToCss(troop.color)

      // 训练按钮
      const troopBtn = troopActor.getComponent(UIButtonComponent)
      if (troopBtn) {
        troopBtn.onClick = () => mode.trainTroop(id)
      }

      filled++
    }
    logger.info(`[BarracksUiScript] 兵种列表已填充 ${filled}/${troops.size} 个条目`)
  }
}
