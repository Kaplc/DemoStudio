/**
 * BuildingCollectScript — 收集泡泡行为脚本（场景 UI / World-Space 面板）
 *
 * 挂载于 building_collect.widget.json 根节点（data-script="gameplay/base/BuildingCollect"）：
 * 金矿/水库积压资源达到容量 80% 时由 FishBaseGameMode 在建筑头顶生成
 * （spawnAnchoredWidget，mode='world'），点击泡泡一键收集该矿全部积压。
 * 积压回落后（收集/升级重建等）由 GameMode 逐帧巡检销毁。
 *
 * 泡泡的图标固定金币（池里金矿/水库共用同一份 widget 资产）——收集量由
 * ProductionService.collect 按矿内实际积压结算，图标仅作交互提示。
 */
import { BehaviourScript, UIButtonComponent, logger } from '@/engine'
import type { FishBaseGameMode } from './FishBaseGameMode'

export default class BuildingCollectScript extends BehaviourScript {
  /** GameMode 引用 */
  private mode: FishBaseGameMode | null = null
  private btn: UIButtonComponent | null = null

  override onStart(_args?: Record<string, unknown>): void {
    this.mode = this.gameMode as FishBaseGameMode | null
    logger.info('[BuildingCollectScript] onStart: 收集泡泡脚本已挂载')

    const bubbleActor = this.findInChildren('Bubble')
    if (!bubbleActor) {
      logger.error('[BuildingCollectScript] 未找到 Bubble 节点，跳过绑定')
      return
    }
    this.btn = bubbleActor.getComponent(UIButtonComponent)
    if (this.btn) {
      this.btn.onClick = () => this.collect()
      logger.info('[BuildingCollectScript] 收集按钮已绑定')
    }
  }

  /** 点击泡泡：一键收集——只把自身 actor 引用交给 GameMode，矿种由 GameMode 反查（多泡泡并存时全局态会串味） */
  private collect(): void {
    const mode = this.mode
    if (!mode) return
    const got = mode.collectFromBubble(this.actor)
    if (got > 0) {
      logger.info(`[BuildingCollectScript] 一键收集成功: +${got}`)
    }
  }
}
