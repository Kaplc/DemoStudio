/**
 * BuildingUpgradeScript — 建筑升级面板行为脚本
 *
 * 通过 UIScriptComponent 挂载到 building_upgrade.widget.json 的根节点：
 *  1. 显示当前建筑信息：名称、等级、当前属性、下一级属性
 *  2. 显示升级费用和时间
 *  3. 显示升级进度（如果正在升级）
 *  4. 提供三个按钮：
 *     - 升级按钮：开始升级（扣资源）
 *     - 宝石加速按钮：使用宝石立即完成升级
 *     - 取消按钮：取消升级（返还50%资源）
 *  5. 关闭按钮：关闭面板
 *
 * 由 FishBaseGameMode.openBuildingUpgradePanel 打开时生成。
 */
import {
  BehaviourScript,
  UIButtonComponent,
  UITextComponent,
  logger,
  GameInstance,
} from '@/engine'
import TipsScript from './Tips.script'
import type { Actor } from '@/engine'
import type { FishBaseGameMode } from './FishBaseGameMode'
import type { FishGameInstance } from '../FishGameInstance'
import { fastForwardGemCost } from './ProductionService'

/** 在 Actor 子树中按 root.name 递归查找子 Actor */
function findChild(actor: Actor, name: string): Actor | null {
  for (const child of actor.getChildren()) {
    if (child.root.name === name) return child
    const hit = findChild(child, name)
    if (hit) return hit
  }
  return null
}

export default class BuildingUpgradeScript extends BehaviourScript {
  /** 当前建筑ID（由外部设置） */
  buildingId: string = ''
  /** GameMode 引用 */
  private mode: FishBaseGameMode | null = null
  /** GameInstance 引用 */
  private inst: FishGameInstance | null = null

  // UI 组件引用
  private buildingNameText: UITextComponent | null = null
  private currentStatsText: UITextComponent | null = null
  private nextStatsText: UITextComponent | null = null
  private upgradeCostText: UITextComponent | null = null
  private upgradeProgressText: UITextComponent | null = null
  private upgradeButton: UIButtonComponent | null = null
  private fastForwardButton: UIButtonComponent | null = null
  private cancelButton: UIButtonComponent | null = null
  private upgradeLabel: UITextComponent | null = null
  private fastForwardLabel: UITextComponent | null = null

  override onStart(): void {
    this.mode = this.gameMode as FishBaseGameMode | null
    this.inst = GameInstance.current as FishGameInstance | null

    if (!this.mode || !this.inst) {
      logger.warn('[BuildingUpgradeScript] 未找到 GameMode 或 GameInstance，跳过绑定')
      return
    }

    // ─── 1. 关闭按钮 ───
    const closeBtnActor = this.findInChildren('Btn_close')
    if (closeBtnActor) {
      const closeBtn = closeBtnActor.getComponent(UIButtonComponent)
      if (closeBtn) {
        closeBtn.onClick = () => this.closePanel()
        logger.info('[BuildingUpgradeScript] 关闭按钮已绑定')
      }
    }

    // ─── 2. 获取UI组件引用 ───
    this.buildingNameText = this.findInChildren('BuildingNameText')?.getComponent(UITextComponent) ?? null
    this.currentStatsText = this.findInChildren('CurrentStatsText')?.getComponent(UITextComponent) ?? null
    this.nextStatsText = this.findInChildren('NextStatsText')?.getComponent(UITextComponent) ?? null
    this.upgradeCostText = this.findInChildren('UpgradeCostText')?.getComponent(UITextComponent) ?? null
    this.upgradeProgressText = this.findInChildren('UpgradeProgressText')?.getComponent(UITextComponent) ?? null

    // ─── 3. 升级按钮 ───
    const upgradeBtnActor = this.findInChildren('Btn_upgrade')
    if (upgradeBtnActor) {
      this.upgradeButton = upgradeBtnActor.getComponent(UIButtonComponent)
      this.upgradeLabel = this.findInChildren('Label_upgrade')?.getComponent(UITextComponent) ?? null
      if (this.upgradeButton) {
        this.upgradeButton.onClick = () => this.startUpgrade()
        logger.info('[BuildingUpgradeScript] 升级按钮已绑定')
      }
    }

    // ─── 4. 宝石加速按钮 ───
    const fastForwardBtnActor = this.findInChildren('Btn_fastForward')
    if (fastForwardBtnActor) {
      this.fastForwardButton = fastForwardBtnActor.getComponent(UIButtonComponent)
      this.fastForwardLabel = this.findInChildren('Label_fastForward')?.getComponent(UITextComponent) ?? null
      if (this.fastForwardButton) {
        this.fastForwardButton.onClick = () => this.fastForwardUpgrade()
        logger.info('[BuildingUpgradeScript] 宝石加速按钮已绑定')
      }
    }

    // ─── 5. 取消按钮 ───
    const cancelBtnActor = this.findInChildren('Btn_cancel')
    if (cancelBtnActor) {
      this.cancelButton = cancelBtnActor.getComponent(UIButtonComponent)
      if (this.cancelButton) {
        this.cancelButton.onClick = () => this.cancelUpgrade()
        logger.info('[BuildingUpgradeScript] 取消按钮已绑定')
      }
    }

    // ─── 6. 初始刷新显示 ───
    this.refreshDisplay()
  }

  /** 每帧刷新升级进度 */
  override onUpdate(_dt: number): void {
    this.refreshProgress()
  }

  /** 刷新整个面板显示 */
  private refreshDisplay(): void {
    if (!this.inst || !this.buildingId) return

    const production = this.inst.production
    const buildingLevel = production.getBuildingLevel(this.buildingId)
    const maxLevel = production.buildingMaxLevel(this.buildingId)
    const currentStats = production.buildingStats(this.buildingId, buildingLevel)
    const nextStats = buildingLevel < maxLevel ? production.buildingStats(this.buildingId, buildingLevel + 1) : null

    // 建筑名称和等级
    if (this.buildingNameText) {
      const buildingName = this.getBuildingName(this.buildingId)
      this.buildingNameText.text = `${buildingName} Lv.${buildingLevel}`
    }

    // 当前等级属性
    if (this.currentStatsText && currentStats) {
      this.currentStatsText.text = `当前等级属性:\nHP: ${currentStats.hp}\n产出: ${currentStats.produceRate}/分钟\n容量: ${currentStats.storage}`
    }

    // 下一级属性
    if (this.nextStatsText) {
      if (nextStats) {
        this.nextStatsText.text = `下一级属性:\nHP: ${nextStats.hp}\n产出: ${nextStats.produceRate}/分钟\n容量: ${nextStats.storage}`
      } else {
        this.nextStatsText.text = '已达到最高等级'
      }
    }

    // 升级费用和时间
    if (this.upgradeCostText) {
      if (nextStats) {
        const costResource = this.getUpgradeResource(this.buildingId)
        this.upgradeCostText.text = `升级费用: ${nextStats.upgradeCost} ${costResource === 'coins' ? '金币' : '药水'} | 时间: ${nextStats.upgradeTime}秒`
      } else {
        this.upgradeCostText.text = '已达到最高等级'
      }
    }

    // 按钮状态
    this.refreshButtons()
  }

  /** 刷新按钮状态 */
  private refreshButtons(): void {
    if (!this.inst) return

    const production = this.inst.production
    const upgrading = production.getUpgrading()
    const isUpgrading = upgrading?.targetId === this.buildingId
    const buildingLevel = production.getBuildingLevel(this.buildingId)
    const maxLevel = production.buildingMaxLevel(this.buildingId)
    const canUpgrade = buildingLevel < maxLevel && !upgrading

    // 升级按钮
    if (this.upgradeButton) {
      this.upgradeButton.state = canUpgrade ? 'normal' : 'disabled'
    }
    if (this.upgradeLabel) {
      this.upgradeLabel.text = canUpgrade ? '⬆️ 升级' : (isUpgrading ? '升级中...' : '无法升级')
    }

    // 宝石加速按钮（仅在升级中且是当前建筑时可用）
    if (this.fastForwardButton) {
      this.fastForwardButton.state = isUpgrading ? 'normal' : 'disabled'
    }
    if (this.fastForwardLabel) {
      if (isUpgrading && upgrading) {
        const remaining = Math.max(0, Math.ceil((upgrading.finishAt - Date.now()) / 1000))
        const gemCost = fastForwardGemCost(remaining)
        this.fastForwardLabel.text = `💎 ${gemCost}宝石加速`
      } else {
        this.fastForwardLabel.text = '💎 宝石加速'
      }
    }

    // 取消按钮（仅在升级中且是当前建筑时可用）
    if (this.cancelButton) {
      this.cancelButton.state = isUpgrading ? 'normal' : 'disabled'
    }
  }

  /** 刷新升级进度显示 */
  private refreshProgress(): void {
    if (!this.inst || !this.upgradeProgressText) return

    const production = this.inst.production
    const upgrading = production.getUpgrading()

    if (upgrading && upgrading.targetId === this.buildingId) {
      const remaining = Math.max(0, Math.ceil((upgrading.finishAt - Date.now()) / 1000))
      if (remaining > 0) {
        const minutes = Math.floor(remaining / 60)
        const seconds = remaining % 60
        this.upgradeProgressText.text = `升级中: ${minutes > 0 ? `${minutes}分` : ''}${seconds}秒 剩余`
      } else {
        this.upgradeProgressText.text = '升级完成!'
      }
    } else {
      this.upgradeProgressText.text = ''
    }
  }

  /** 开始升级 */
  private startUpgrade(): void {
    if (!this.inst || !this.buildingId) {
      logger.warn('[BuildingUpgradeScript] startUpgrade: inst或buildingId为空')
      return
    }

    logger.info(`[BuildingUpgradeScript] 尝试升级建筑: ${this.buildingId}`)
    const production = this.inst.production
    const resource = this.getUpgradeResource(this.buildingId)
    const nextLevel = production.getBuildingLevel(this.buildingId) + 1
    const stats = production.buildingStats(this.buildingId, nextLevel)
    
    logger.info(`[BuildingUpgradeScript] 升级信息: 资源=${resource}, 当前等级=${production.getBuildingLevel(this.buildingId)}, 下一级=${nextLevel}`)
    
    if (stats) {
      logger.info(`[BuildingUpgradeScript] 下一级属性: 费用=${stats.upgradeCost}, 时间=${stats.upgradeTime}s`)
    }

    if (production.startBuildingUpgrade(this.buildingId, resource)) {
      logger.info(`[BuildingUpgradeScript] 升级成功: ${this.buildingId}`)
      this.refreshDisplay()
    } else {
      // 显示失败提示
      const resourceName = resource === 'coins' ? '金币' : '药水'
      const required = stats?.upgradeCost ?? 0
      const current = this.inst.resources.get(resource)
      
      logger.info(`[BuildingUpgradeScript] 升级失败: 需要${required}${resourceName}, 当前有${current}${resourceName}`)
      
      TipsScript.showError(
        this.world!,
        '升级失败',
        `${resourceName}不足！需要 ${required} ${resourceName}，当前只有 ${current} ${resourceName}`
      )
      
      logger.warn(`[BuildingUpgradeScript] 已显示升级失败提示: ${this.buildingId}（${resourceName}不足）`)
    }
  }

  /** 宝石加速升级 */
  private fastForwardUpgrade(): void {
    if (!this.inst || !this.buildingId) return

    const mode = this.mode
    if (!mode) return

    if (mode.fastForwardUpgrade()) {
      logger.info(`[BuildingUpgradeScript] 宝石加速完成: ${this.buildingId}`)
      this.refreshDisplay()
    } else {
      logger.warn(`[BuildingUpgradeScript] 宝石加速失败: ${this.buildingId}`)
    }
  }

  /** 取消升级 */
  private cancelUpgrade(): void {
    if (!this.inst || !this.buildingId) return

    const production = this.inst.production
    const upgrading = production.getUpgrading()

    if (upgrading && upgrading.targetId === this.buildingId) {
      production.refundOnCancel(this.buildingId)
      // 清除升级队列
      this.inst.save.set('upgradeQueue', [])
      logger.info(`[BuildingUpgradeScript] 取消升级: ${this.buildingId}`)
      this.refreshDisplay()
    }
  }

  /** 关闭面板 */
  private closePanel(): void {
    if (this.mode) {
      this.mode.closeBuildingUpgradePanel()
    }
  }

  /** 获取建筑显示名称 */
  private getBuildingName(buildingId: string): string {
    const names: Record<string, string> = {
      townhall: '大本营',
      barracks: '兵营',
      laboratory: '实验室',
      goldmine: '金矿',
      elixir: '水库',
      cannon: '加农炮',
      wall: '城墙'
    }
    return names[buildingId] || buildingId
  }

  /** 获取升级消耗资源类型 */
  private getUpgradeResource(buildingId: string): 'coins' | 'elixir' {
    // 实验室和兵营使用药水，其他使用金币
    return (buildingId === 'laboratory' || buildingId === 'barracks') ? 'elixir' : 'coins'
  }

  /** 设置当前建筑ID（由外部调用） */
  setBuildingId(id: string): void {
    this.buildingId = id
    this.refreshDisplay()
  }
}