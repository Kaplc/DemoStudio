/**
 * BuildingInfoScript — 建筑信息牌行为脚本（场景 UI / World-Space 面板）
 *
 * 挂载于 building_info.widget.json 根节点（data-script="gameplay/base/BuildingInfo"）：
 *  1. 显示建筑名称与等级（buildingId 由 BuildingPanelState 静态暂存传入，
 *     因脚本实例经 UIManager.commitSpawn 异步创建，无法 spawn 后同步 setBuildingId）
 *  2. 收集按钮（仅金矿/水库显示）→ 一键收集该矿积压
 *  3. 升级按钮 → 关闭信息牌 + 打开建筑升级面板（面板打开时传入 buildingId）
 *  4. 关闭按钮 → 关闭信息牌
 * （按钮 hover/pressed 变色由 UIButtonComponent.stateColors 原生驱动，脚本不轮询）
 *
 * 由 FishBaseGameMode.openBuildingInfoPanel 经 spawnAnchoredWidget 打开
 * （mode='world' 场景 UI：面板摆在建筑上方，billboard 正对相机，近大远小）。
 */
import { BehaviourScript, UIButtonComponent, UITextComponent, logger } from '@/engine'
import { BuildingInfoState } from './BuildingPanelState'
import type { FishBaseGameMode } from './FishBaseGameMode'

/** 建筑显示名（与 BuildingUpgradeScript.getBuildingName 同口径） */
const BUILDING_NAMES: Record<string, string> = {
  townhall: '大本营',
  barracks: '兵营',
  laboratory: '实验室',
  goldmine: '金矿',
  elixir: '水库',
  cannon: '加农炮',
  wall: '城墙',
}

export default class BuildingInfoScript extends BehaviourScript {
  /** GameMode 引用 */
  private mode: FishBaseGameMode | null = null
  /** UI 组件引用 */
  private nameText: UITextComponent | null = null
  private levelText: UITextComponent | null = null
  private upgradeBtn: UIButtonComponent | null = null
  private closeBtn: UIButtonComponent | null = null
  private collectBtn: UIButtonComponent | null = null

  override onStart(_args?: Record<string, unknown>): void {
    this.mode = this.gameMode as FishBaseGameMode | null
    const buildingId = BuildingInfoState.currentBuildingId
    logger.info(`[BuildingInfoScript] onStart: buildingId=${buildingId}`)

    // ─── 文本 ───
    this.nameText = this.findInChildren('BuildingName')?.getComponent(UITextComponent) ?? null
    this.levelText = this.findInChildren('BuildingLevel')?.getComponent(UITextComponent) ?? null

    if (this.nameText) {
      this.nameText.text = BUILDING_NAMES[buildingId] ?? buildingId
    }
    if (this.levelText) {
      const level = this.mode?.gameInstance?.production.getBuildingLevel(buildingId) ?? 1
      this.levelText.text = `Lv.${level}`
    }

    // ─── 升级按钮 ───
    const upgradeActor = this.findInChildren('Btn_upgrade')
    if (upgradeActor) {
      this.upgradeBtn = upgradeActor.getComponent(UIButtonComponent)
      if (this.upgradeBtn) {
        this.upgradeBtn.onClick = () => this.openUpgradePanel()
        logger.info('[BuildingInfoScript] 升级按钮已绑定')
      }
    }

    // ─── 收集按钮（仅金矿/水库显示）───
    const collectActor = this.findInChildren('Btn_collect')
    if (collectActor) {
      this.collectBtn = collectActor.getComponent(UIButtonComponent)
      if (this.collectBtn) {
        this.collectBtn.onClick = () => this.collect()
        logger.info('[BuildingInfoScript] 收集按钮已绑定')
      }
      const isMine = buildingId === 'goldmine' || buildingId === 'elixir'
      collectActor.bActive = isMine
      if (!isMine) logger.info('[BuildingInfoScript] 非矿建筑：收集按钮已隐藏')
    }

    // ─── 关闭按钮 ───
    const closeActor = this.findInChildren('Btn_close')
    if (closeActor) {
      this.closeBtn = closeActor.getComponent(UIButtonComponent)
      if (this.closeBtn) {
        this.closeBtn.onClick = () => this.mode?.closeBuildingInfoPanel()
        logger.info('[BuildingInfoScript] 关闭按钮已绑定')
      }
    }
  }

  /** 收集按钮：一键收集当前建筑积压（校验在 ProductionService.collect，非矿按钮已隐藏） */
  private collect(): void {
    const buildingId = BuildingInfoState.currentBuildingId
    const got = this.mode?.collectFromBuilding(buildingId) ?? 0
    if (got > 0) {
      logger.info(`[BuildingInfoScript] 信息牌收集成功: ${buildingId} +${got}`)
    }
  }

  /** 升级按钮：关闭信息牌 → 打开建筑升级面板（buildingId 由 GameMode.openBuildingUpgradePanel 统一暂存） */
  private openUpgradePanel(): void {
    const buildingId = BuildingInfoState.currentBuildingId
    logger.info(`[BuildingInfoScript] 点击升级: ${buildingId}`)
    this.mode?.closeBuildingInfoPanel()
    this.mode?.openBuildingUpgradePanel(buildingId)
  }
}
