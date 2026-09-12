/**
 * MainMenuScript — 主菜单行为脚本（main_menu.widget.json 根节点）
 *
 * 按钮 → WarmCurrentMenuGameMode.emitMenuAction 交 GameInstance 分发：
 *  - Btn_new  → 'new'  （新开局，覆盖性进入星图；旧档保留不删，可从暂停菜单读回）
 *  - Btn_load → 'load' （读最近存档，无档则提示停留菜单）
 *
 * SETTINGS / EXIT TO DESKTOP 为设计稿占位项（纯 div、无 UIButton，天然不可点），
 * 接线后端时把 .ItemGhost div 换成 <button> 并在此处 bind 即可。
 *
 * 「CONTINUE」标签的扫槽逻辑复用 core/save.findLatestSlotMeta（GameInstance 同口径），
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

  /** 「CONTINUE」标签按最近档摘要刷新；三槽全空保持默认文案 */
  private async refreshLoadButton(): Promise<void> {
    const label = this.findInChildren('Label_load')?.getComponent(UITextComponent)
    if (!label) {
      logger.warn('[MainMenuScript] Label_load 未找到，跳过存档摘要刷新')
      return
    }
    const api = window.electronAPI
    if (!api?.readJsonFile) {
      logger.info('[MainMenuScript] electronAPI 不可用（浏览器模式），CONTINUE 保持默认文案')
      return
    }
    const best = await findLatestSlotMeta(api.readJsonFile)
    if (best) {
      // 短后缀：标签盒宽 250px（21px 字 + 4px 字距），"SLOT n" 全称会折行
      label.text = `CONTINUE · S${best.slot}`
      logger.info(`[MainMenuScript] 最近存档：槽${best.slot} @ ${best.savedAt}`)
    } else {
      label.text = 'CONTINUE'
      logger.info('[MainMenuScript] 三槽全空，CONTINUE 无可用存档')
    }
  }
}
