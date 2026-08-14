/**
 * BuildMenuScript — 建筑菜单行为脚本
 *
 * 挂载到 build_menu.widget.json 根节点（UIScriptComponent, script="gameplay/base/BuildMenu"）。
 * 建筑菜单是独立 widget 资产：默认隐藏（根节点 active:false），
 * 玩家点击 HUD 的"地图"按钮（FishBaseGameMode.toggleBuildMode）后才显示。
 *
 * 本脚本接管底部建筑按钮的点击绑定：按指定节点名（Btn_*）逐个查找按钮，
 * 把 UIButtonComponent 接到对应 GameMode 方法（选建筑类型 / 删除选中）。
 *
 * 文件名 `.script.ts` 后缀 + 默认导出：由 asset/index.ts 的 import.meta.glob 自动扫描
 * 注册，注册 id = `gameplay/base/BuildMenu`（路径式）。
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

export default class BuildMenuScript extends BehaviourScript {
  override onStart(): void {
    const mode = this.gameMode as FishBaseGameMode | null
    if (!mode) {
      logger.warn('[BuildMenuScript] 未找到 FishBaseGameMode，跳过按钮绑定')
      return
    }

    // 按指定 name 逐个获取按钮并绑定
    let bound = 0
    for (const [btnName, id] of Object.entries(BUILDING_BUTTONS)) {
      const btnActor = this.findInChildren(btnName)
      if (!btnActor) {
        logger.warn(`[BuildMenuScript] 未找到按钮节点 "${btnName}"，跳过`)
        continue
      }
      const btn = btnActor.getComponent(UIButtonComponent)
      if (!btn) {
        logger.warn(`[BuildMenuScript] 按钮节点 "${btnName}" 缺少 UIButtonComponent，跳过`)
        continue
      }
      // 沿用资产约定：再次点击同类型在 GameMode 内部取消；delete 走删除分支
      btn.onClick = id === 'delete'
        ? () => mode.deleteSelectedBuilding()
        : () => mode.selectBuildingType(id)
      bound++
    }

    logger.info(`[BuildMenuScript] 已绑定 ${bound} 个建筑菜单按钮`)
  }
}
