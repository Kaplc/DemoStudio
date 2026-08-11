/**
 * BarracksUiScript — 兵营专属 UI 行为脚本（Unity MonoBehaviour 风格）
 *
 * 通过 UIScriptComponent 挂载到 barracks_ui.widget.json 的根节点，
 * 接管兵营面板的关闭按钮：点击后调用 GameMode.closeBarracksPanel()
 * （销毁兵营面板 + 恢复建造菜单 base_hud）。
 *
 * 由 FishBaseGameMode.openBarracksPanel 打开兵营 UI 时生成。
 */
import { BehaviourScript, UIButtonComponent, logger } from '@/engine'
import type { FishBaseGameMode } from './FishBaseGameMode'

export default class BarracksUiScript extends BehaviourScript {
  override onStart(): void {
    const mode = this.gameMode as FishBaseGameMode | null
    if (!mode) {
      logger.warn('[BarracksUiScript] 未找到 FishBaseGameMode，跳过按钮绑定')
      return
    }

    const btnActor = this.findInChildren('Btn_barracksClose')
    if (!btnActor) {
      logger.warn('[BarracksUiScript] 未找到关闭按钮节点 "Btn_barracksClose"')
      return
    }
    const btn = btnActor.getComponent(UIButtonComponent)
    if (!btn) {
      logger.warn('[BarracksUiScript] 关闭按钮缺少 UIButtonComponent')
      return
    }

    btn.onClick = () => mode.closeBarracksPanel()
    logger.info('[BarracksUiScript] 已绑定关闭按钮 → closeBarracksPanel')
  }
}
