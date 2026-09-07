/**
 * MainMenuScript — 主菜单行为脚本（main_menu.widget.json 根节点）
 *
 * 按钮 → WarmCurrentMenuGameMode.emitMenuAction 交 GameInstance 分发：
 *  - Btn_new  → 'new'  （新开局，覆盖性进入星图；旧档保留不删，可从暂停菜单读回）
 *  - Btn_load → 'load' （读最近存档，无档则提示停留菜单）
 *
 * 「读取存档」标签的扫槽逻辑复用 core/save.findLatestSlotMeta（GameInstance 同口径），
 * UI 只消费摘要结果，不自带扫描实现（七角色审查建议：避免两处口径漂移）。
 */
import { BehaviourScript, UIButtonComponent, UITextComponent, logger } from '@/engine'
import { findLatestSlotMeta } from '../core/save'
import type { WarmCurrentMenuGameMode } from './WarmCurrentMenuGameMode'

export default class MainMenuScript extends BehaviourScript {
  override onStart(): void {
    const mode = this.gameMode as WarmCurrentMenuGameMode | null
    const bind = (name: string, fn: () => void): void => {
      const actor = this.findInChildren(name)
      const btn = actor?.getComponent(UIButtonComponent)
      if (btn) btn.onClick = fn
      else logger.warn(`[MainMenuScript] 按钮 ${name} 未找到`)
    }
    bind('Btn_new', () => mode?.emitMenuAction('new'))
    bind('Btn_load', () => mode?.emitMenuAction('load'))
    logger.info('[MainMenuScript] 主菜单按钮已绑定')
    void this.refreshLoadButton()
  }

  /** 「读取存档」标签按最近档摘要刷新；三槽全空提示暂无存档 */
  private async refreshLoadButton(): Promise<void> {
    const label = this.findInChildren('Label_load')?.getComponent(UITextComponent)
    if (!label) return
    const api = window.electronAPI
    if (!api?.readJsonFile) {
      label.text = '读取存档（浏览器模式不可用）'
      return
    }
    const best = await findLatestSlotMeta(api.readJsonFile)
    if (best) {
      label.text = `读取存档（槽${best.slot}）`
      logger.info(`[MainMenuScript] 最近存档：槽${best.slot} @ ${best.savedAt}`)
    } else {
      label.text = '读取存档（暂无存档）'
    }
  }
}
