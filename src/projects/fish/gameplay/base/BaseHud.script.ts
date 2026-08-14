/**
 * BaseHudScript — 基地 HUD 行为脚本（Unity MonoBehaviour 风格）
 *
 * 通过 UIScriptComponent 挂载到 base_hud.widget.json 的根节点，接管 HUD 常驻控件：
 *  - "建筑"按钮（Btn_build）：切换建筑模式（FishBaseGameMode.toggleBuildMode）——
 *    进入建筑模式后显示独立建筑菜单（build_menu.widget.json），退出后隐藏
 *  - "地图"按钮（Btn_map）：打开/关闭地图面板（FishBaseGameMode.toggleMapPanel）——
 *    关卡选择 UI（base_map.widget.json），打开时自动退出建筑模式
 *  - 金币文本：绑定 GameInstance 资源组件（跨阶段共享钱包）
 *
 * 建筑菜单按钮（选建筑类型/删除）由 BuildMenu.script.ts 接管（挂在 build_menu 资产上），
 * 地图面板的关卡节点由 MapPanel.script.ts 接管（挂在 base_map 资产上）——
 * HUD 只负责入口按钮，面板内容与 HUD 解耦。
 *
 * 文件名 `.script.ts` 后缀 + 默认导出：由 asset/index.ts 的 import.meta.glob 自动扫描
 * 注册，注册 id = `gameplay/base/BaseHud`（路径式）。
 */
import { BehaviourScript, UIButtonComponent, UITextComponent, logger, GameInstance } from '@/engine'
import type { FishBaseGameMode } from './FishBaseGameMode'
import type { FishGameInstance } from '../FishGameInstance'

export default class BaseHudScript extends BehaviourScript {
  override onStart(): void {
    const mode = this.gameMode as FishBaseGameMode | null
    if (mode) {
      // 建筑按钮：切换建筑模式（打开/关闭建筑菜单）
      const buildBtnActor = this.findInChildren('Btn_build')
      const buildBtn = buildBtnActor?.getComponent(UIButtonComponent)
      if (buildBtn) {
        buildBtn.onClick = () => mode.toggleBuildMode()
        logger.info('[BaseHudScript] 建筑按钮已绑定（切换建筑模式）')
      } else {
        logger.warn('[BaseHudScript] 未找到 Btn_build 按钮，跳过')
      }

      // 地图按钮：打开/关闭地图面板（关卡选择）
      const mapBtnActor = this.findInChildren('Btn_map')
      const mapBtn = mapBtnActor?.getComponent(UIButtonComponent)
      if (mapBtn) {
        mapBtn.onClick = () => mode.toggleMapPanel()
        logger.info('[BaseHudScript] 地图按钮已绑定（打开地图面板）')
      } else {
        logger.warn('[BaseHudScript] 未找到 Btn_map 按钮，跳过')
      }
    } else {
      logger.warn('[BaseHudScript] 未找到 FishBaseGameMode，跳过按钮绑定')
    }

    // ─── 金币文本：绑定 GameInstance 资源组件（跨阶段共享钱包）───
    const inst = GameInstance.current as FishGameInstance | null
    // 资产节点名是 GoldLabel（Actor），GoldText 是其 UITextComponent 组件的 name
    const goldTextActor = this.findInChildren('GoldLabel')
    const goldText = goldTextActor?.getComponent(UITextComponent)
    if (inst && goldText) {
      // 立即刷新一次 + 资源变化自动更新
      goldText.text = `🪙 金币: ${inst.resources.get('coins')}`
      inst.resources.onChange = () => {
        goldText.text = `🪙 金币: ${inst.resources.get('coins')}`
      }
      logger.info('[BaseHudScript] 金币文本已绑定资源组件')
    } else {
      logger.warn(`[BaseHudScript] 金币文本未绑定（instance=${!!inst}, goldText=${!!goldText}）`)
    }
  }
}
