/**
 * BuildingInfoScript — 建筑信息牌行为脚本（场景 UI / World-Space 面板）
 *
 * 挂载于 building_info.widget.json 根节点（data-script="gameplay/base/BuildingInfo"）：
 *  1. 显示建筑名称与等级（buildingId 由 BuildingPanelState 静态暂存传入，
 *     因脚本实例经 UIManager.commitSpawn 异步创建，无法 spawn 后同步 setBuildingId）
 *  2. 收集按钮（仅金矿/水库显示）→ 一键收集该矿积压
 *  3. 升级按钮 → 关闭信息牌 + 打开建筑升级面板（面板打开时传入 buildingId）
 *  4. 关闭按钮 → 关闭信息牌
 *  5. 消费编译器透传的交互态色（.Btn_*:hover/:active → UIScript.args），
 *     轮询按钮状态机给背景 Image 上色（UIButtonComponent 不代理颜色，见其文件头）
 *
 * 由 FishBaseGameMode.openBuildingInfoPanel 经 spawnAnchoredWidget 打开
 * （mode='world' 场景 UI：面板摆在建筑上方，billboard 正对相机，近大远小）。
 */
import { BehaviourScript, UIButtonComponent, UITextComponent, UIImageComponent, UIScriptComponent, logger } from '@/engine'
import { BuildingInfoState } from './BuildingPanelState'
import type { FishBaseGameMode } from './FishBaseGameMode'

/** 编译器 emitButtonStates 透传的交互态（仅 color/opacity） */
interface InteractiveStateArgs {
  hover?: { color?: string; opacity?: number }
  pressed?: { color?: string; opacity?: number }
}

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
  private upgradeImage: UIImageComponent | null = null
  private closeImage: UIImageComponent | null = null
  private collectImage: UIImageComponent | null = null
  /** 交互态色（编译器透传） */
  private upgradeStates: InteractiveStateArgs = {}
  private closeStates: InteractiveStateArgs = {}
  private collectStates: InteractiveStateArgs = {}
  private upgradeBaseColor: string | null = null
  private closeBaseColor: string | null = null
  private collectBaseColor: string | null = null

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
      this.upgradeImage = upgradeActor.getComponent(UIImageComponent)
      if (this.upgradeBtn) {
        this.upgradeBtn.onClick = () => this.openUpgradePanel()
        logger.info('[BuildingInfoScript] 升级按钮已绑定')
      }
      this.upgradeStates = (upgradeActor.getComponent(UIScriptComponent)?.args ?? {}) as InteractiveStateArgs
    }

    // ─── 收集按钮（仅金矿/水库显示）───
    const collectActor = this.findInChildren('Btn_collect')
    if (collectActor) {
      this.collectBtn = collectActor.getComponent(UIButtonComponent)
      this.collectImage = collectActor.getComponent(UIImageComponent)
      if (this.collectBtn) {
        this.collectBtn.onClick = () => this.collect()
        logger.info('[BuildingInfoScript] 收集按钮已绑定')
      }
      this.collectStates = (collectActor.getComponent(UIScriptComponent)?.args ?? {}) as InteractiveStateArgs
      const isMine = buildingId === 'goldmine' || buildingId === 'elixir'
      collectActor.bActive = isMine
      if (!isMine) logger.info('[BuildingInfoScript] 非矿建筑：收集按钮已隐藏')
    }

    // ─── 关闭按钮 ───
    const closeActor = this.findInChildren('Btn_close')
    if (closeActor) {
      this.closeBtn = closeActor.getComponent(UIButtonComponent)
      this.closeImage = closeActor.getComponent(UIImageComponent)
      if (this.closeBtn) {
        this.closeBtn.onClick = () => this.mode?.closeBuildingInfoPanel()
        logger.info('[BuildingInfoScript] 关闭按钮已绑定')
      }
      this.closeStates = (closeActor.getComponent(UIScriptComponent)?.args ?? {}) as InteractiveStateArgs
    }

    this.upgradeBaseColor = this.upgradeImage?.color ?? null
    this.closeBaseColor = this.closeImage?.color ?? null
    this.collectBaseColor = this.collectImage?.color ?? null
  }

  /** 每帧：轮询按钮状态机应用交互态色（MainMenuScript 同款先例） */
  override onUpdate(_deltaTime: number): void {
    if (this.upgradeBtn && this.upgradeImage) {
      const target =
        this.upgradeBtn.state === 'pressed' ? this.upgradeStates.pressed?.color ?? null
        : this.upgradeBtn.state === 'hover' ? this.upgradeStates.hover?.color ?? null
        : this.upgradeBaseColor
      if (target && this.upgradeImage.color !== target) this.upgradeImage.color = target
    }
    if (this.closeBtn && this.closeImage) {
      const target =
        this.closeBtn.state === 'pressed' ? this.closeStates.pressed?.color ?? null
        : this.closeBtn.state === 'hover' ? this.closeStates.hover?.color ?? null
        : this.closeBaseColor
      if (target && this.closeImage.color !== target) this.closeImage.color = target
    }
    if (this.collectBtn && this.collectImage) {
      const target =
        this.collectBtn.state === 'pressed' ? this.collectStates.pressed?.color ?? null
        : this.collectBtn.state === 'hover' ? this.collectStates.hover?.color ?? null
        : this.collectBaseColor
      if (target && this.collectImage.color !== target) this.collectImage.color = target
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
