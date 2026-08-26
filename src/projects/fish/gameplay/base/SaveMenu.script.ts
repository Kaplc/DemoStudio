/**
 * SaveMenuScript — 存档管理菜单行为脚本
 *
 * 通过 UIScriptComponent 挂载到 save_menu.widget.json 的根节点：
 *  1. "保存存档"按钮（Btn_save）→ FishGameInstance.saveGame()（全量采集 → 强制落盘）
 *  2. "读取存档"按钮（Btn_load）→ FishGameInstance.loadGame()（load → 回填 → 基地布局重建）
 *  3. "关闭菜单"按钮（Btn_close）→ FishBaseGameMode.closeSaveMenu()
 *
 * 由 FishBaseGameMode.toggleSaveMenu（Esc）打开时生成；
 * 持久化模型为手动存/读——游戏过程只写内存 KV，仅在点击保存时写盘。
 */
import { BehaviourScript, UIButtonComponent, UITextComponent, ToastSystem, logger, GameInstance } from '@/engine'
import type { FishBaseGameMode } from './FishBaseGameMode'
import type { FishGameInstance } from '../FishGameInstance'

export default class SaveMenuScript extends BehaviourScript {
  override onStart(): void {
    const inst = GameInstance.current as FishGameInstance | null
    const mode = this.gameMode as FishBaseGameMode | null

    // ─── 1. 保存存档：全量采集 → 强制落盘，Toast 反馈 ───
    const saveActor = this.findInChildren('Btn_save')
    const saveBtn = saveActor?.getComponent(UIButtonComponent)
    if (saveBtn && inst) {
      saveBtn.onClick = () => {
        void inst.saveGame().then((ok) => {
          ToastSystem.instance.show(ok ? '💾 存档已保存' : '❌ 存档保存失败', { priority: 'normal' })
          logger.info(`[SaveMenuScript] 手动保存${ok ? '成功' : '失败'}`)
          this.refreshInfoLine(inst)
        })
      }
      logger.info('[SaveMenuScript] 已绑定"保存存档" → saveGame')
    } else {
      logger.warn(`[SaveMenuScript] "保存存档"未绑定（inst=${!!inst}, btn=${!!saveBtn}）`)
    }

    // ─── 2. 读取存档：load → 回填运行时 → 基地内触发布局重建；成功后关菜单看效果 ───
    const loadActor = this.findInChildren('Btn_load')
    const loadBtn = loadActor?.getComponent(UIButtonComponent)
    if (loadBtn && inst) {
      loadBtn.onClick = () => {
        void inst.loadGame().then((ok) => {
          ToastSystem.instance.show(ok ? '📂 存档已读取' : '⚠️ 没有可读取的存档', { priority: 'normal' })
          logger.info(`[SaveMenuScript] 手动读取${ok ? '成功' : '失败（无存档）'}`)
          if (ok) mode?.closeSaveMenu()
          else this.refreshInfoLine(inst)
        })
      }
      logger.info('[SaveMenuScript] 已绑定"读取存档" → loadGame')
    } else {
      logger.warn(`[SaveMenuScript] "读取存档"未绑定（inst=${!!inst}, btn=${!!loadBtn}）`)
    }

    // ─── 3. 关闭菜单 ───
    const closeActor = this.findInChildren('Btn_close')
    const closeBtn = closeActor?.getComponent(UIButtonComponent)
    if (closeBtn && mode) {
      closeBtn.onClick = () => mode.closeSaveMenu()
      logger.info('[SaveMenuScript] 已绑定"关闭菜单" → closeSaveMenu')
    } else {
      logger.warn(`[SaveMenuScript] "关闭菜单"未绑定（mode=${!!mode}, btn=${!!closeBtn}）`)
    }

    // ─── 信息行：上次保存时间 ───
    if (inst) this.refreshInfoLine(inst)
  }

  /** 刷新面板底部信息行（上次保存时间） */
  private refreshInfoLine(inst: FishGameInstance): void {
    const infoActor = this.findInChildren('InfoLine')
    const infoText = infoActor?.getComponent(UITextComponent)
    if (!infoText) return
    const at = inst.save.lastFlushedAt
    infoText.text = at ? `上次保存：${new Date(at).toLocaleString()}` : '上次保存：从未'
  }
}
