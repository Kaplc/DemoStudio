/**
 * BaseHudScript — 基地 HUD 行为脚本（Unity MonoBehaviour 风格）
 *
 * 通过 UIScriptComponent 挂载到 base_hud.widget.json 的根节点，接管底部建筑菜单按钮
 * 的点击绑定：按指定节点名（Btn_*）逐个查找按钮，把 UIButtonComponent 接到对应
 * GameMode 方法（选建筑类型 / 删除选中）。
 *
 * 替代原先在 FishGameInstance.setupBasePhase 里手写遍历 UI 树、按名字绑定的代码——
 * UI 结构（资产）与行为（脚本）解耦。
 *
 * 文件名 `.script.ts` 后缀 + 默认导出：由 asset/index.ts 的 import.meta.glob 自动扫描
 * 注册，注册 id = `gameplay/base/BaseHud`（路径式）。
 */
import { BehaviourScript, UIButtonComponent, logger } from '@/engine'
import type { FishBaseGameMode } from './FishBaseGameMode'

/** 建筑菜单按钮映射：资产节点名 → 建筑类型 id（delete 走删除分支） */
const BUILDING_BUTTONS: Readonly<Record<string, string>> = {
  Btn_townhall: 'townhall',
  Btn_barracks: 'barracks',
  Btn_goldmine: 'goldmine',
  Btn_elixir: 'elixir',
  Btn_cannon: 'cannon',
  Btn_wall: 'wall',
  Btn_delete: 'delete',
}

export default class BaseHudScript extends BehaviourScript {
  override onStart(): void {
    const mode = this.gameMode as FishBaseGameMode | null
    if (!mode) {
      logger.warn('[BaseHudScript] 未找到 FishBaseGameMode，跳过按钮绑定')
      return
    }

    // 按指定 name 逐个获取按钮并绑定
    let bound = 0
    for (const [btnName, id] of Object.entries(BUILDING_BUTTONS)) {
      const btnActor = this.findInChildren(btnName)
      if (!btnActor) {
        logger.warn(`[BaseHudScript] 未找到按钮节点 "${btnName}"，跳过`)
        continue
      }
      const btn = btnActor.getComponent(UIButtonComponent)
      if (!btn) {
        logger.warn(`[BaseHudScript] 按钮节点 "${btnName}" 缺少 UIButtonComponent，跳过`)
        continue
      }
      // 沿用资产约定：再次点击同类型在 GameMode 内部取消；delete 走删除分支
      btn.onClick = id === 'delete'
        ? () => mode.deleteSelectedBuilding()
        : () => mode.selectBuildingType(id)
      bound++
    }

    logger.info(`[BaseHudScript] 已绑定 ${bound} 个建筑菜单按钮`)
  }
}
