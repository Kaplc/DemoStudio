/**
 * PauseMenuScript — 暂停菜单行为脚本（pause_menu.widget.json 根节点）
 *
 * 由 WarmCurrentGameMode.togglePauseMenu（Esc）动态 spawn；三槽位保存/读取：
 *  - Btn_save{1..3} → GameInstance.saveSlot(n)（深快照 → 强制落盘）
 *  - Btn_load{1..3} → GameInstance.loadSlot(n)（校验 → 恢复 sim + rng）
 *  - Btn_resume     → mode.togglePauseMenu()（关闭）
 *  - Btn_back       → GameInstance.switchToMenuScene()
 * 刷新时机：onStart 全量刷一遍 + 每次保存/读取后增量刷新。
 */
import { BehaviourScript, UIButtonComponent, UITextComponent, ToastSystem, logger, GameInstance } from '@/engine'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'
import type { WarmCurrentGameInstance } from '../../WarmCurrentGameInstance'
import { formatSlotInfo } from '../core/save'

export default class PauseMenuScript extends BehaviourScript {
  override onStart(): void {
    const mode = this.gameMode as WarmCurrentGameMode | null
    const inst = GameInstance.current as WarmCurrentGameInstance | null
    if (!mode) { logger.warn('[PauseMenuScript] gameMode 未就绪'); return }

    // 三槽位：保存 / 读取
    for (let n = 1; n <= 3; n++) {
      const saveBtn = this.findInChildren(`Btn_save${n}`)?.getComponent(UIButtonComponent)
      if (saveBtn && inst) {
        saveBtn.onClick = () => {
          void inst.saveSlot(n).then((ok) => {
            ToastSystem.instance.show(ok ? `💾 已保存到槽${n}` : `❌ 保存槽${n}失败`, { priority: 'normal' })
            this.refreshSlotLine(inst, n)
          })
        }
      } else {
        logger.warn(`[PauseMenuScript] Btn_save${n} 未绑定（inst=${!!inst}, btn=${!!saveBtn}）`)
      }
      const loadBtn = this.findInChildren(`Btn_load${n}`)?.getComponent(UIButtonComponent)
      if (loadBtn && inst) {
        loadBtn.onClick = () => {
          void inst.loadSlot(n).then((ok) => {
            if (ok) {
              ToastSystem.instance.show(`📂 已读取槽${n}`, { priority: 'normal' })
              mode.togglePauseMenu() // 读档成功自动关菜单
            } else {
              ToastSystem.instance.show(`⚠️ 槽${n}是空栏或读取失败`, { priority: 'normal' })
            }
          })
        }
      } else {
        logger.warn(`[PauseMenuScript] Btn_load${n} 未绑定（inst=${!!inst}, btn=${!!loadBtn}）`)
      }
    }

    // 继续游戏 / 回主菜单
    const resumeBtn = this.findInChildren('Btn_resume')?.getComponent(UIButtonComponent)
    if (resumeBtn) resumeBtn.onClick = () => mode.togglePauseMenu()
    else logger.warn('[PauseMenuScript] Btn_resume 未找到')
    const backBtn = this.findInChildren('Btn_back')?.getComponent(UIButtonComponent)
    if (backBtn && inst) backBtn.onClick = () => { mode.togglePauseMenu(); inst.switchToMenuScene() }
    else logger.warn('[PauseMenuScript] Btn_back 未找到')

    // 初始刷新三行摘要
    if (inst) for (let n = 1; n <= 3; n++) this.refreshSlotLine(inst, n)
    logger.info('[PauseMenuScript] 暂停菜单就绪（三槽位 + 继续 + 回主菜单）')
  }

  /** 刷新槽位 n 摘要行 */
  private refreshSlotLine(inst: WarmCurrentGameInstance, n: number): void {
    const info = this.findInChildren(`SlotInfo${n}`)?.getComponent(UITextComponent)
    if (!info) return
    info.text = `槽位 ${n} · ${formatSlotInfo(inst.slotMeta(n))}`
  }
}
