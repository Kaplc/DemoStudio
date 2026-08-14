/**
 * MapPanelScript — 地图面板（关卡选择）行为脚本
 *
 * 通过 UIScriptComponent 挂载到 base_map.widget.json 的根节点：
 *  1. 关闭按钮（Btn_mapClose）→ FishBaseGameMode.closeMapPanel()
 *  2. 读取关卡配置表（fish.levels）动态生成关卡卡片：
 *     每个关卡 → world.ui.spawnUIActor('asset/blueprints/ui/level_card.blueprint.json')
 *     生成后改名 Level_{id}、填充名称/星级/描述文本、按配置表 pos 定位
 *     （anchor=center + anchorOffset=pos，地图节点位置可配置）、绑定点击
 *     → FishGameInstance.enterLevel(id)（切换 game 阶段 + 加载关卡场景）
 *
 * 由 FishBaseGameMode.toggleMapPanel 打开地图面板时生成（挂到 HUD）。
 */
import {
  BehaviourScript,
  UIButtonComponent,
  UITextComponent,
  logger,
  GameInstance,
  UITransformComponent,
} from '@/engine'
import type { Actor } from '@/engine'
import type { FishBaseGameMode } from './FishBaseGameMode'
import type { FishGameInstance } from '../FishGameInstance'

/** 关卡卡片蓝图路径（相对 src/projects/，由 BlueprintRegistry 注册） */
const LEVEL_CARD_BLUEPRINT = 'asset/blueprints/ui/level_card.blueprint.json'

/** 星级字符串（1~5 星） */
function starsText(stars: number): string {
  return '★'.repeat(Math.max(1, Math.min(5, stars)))
}

/** 在 Actor 子树中按 root.name 递归查找子 Actor */
function findChild(actor: Actor, name: string): Actor | null {
  for (const child of actor.getChildren()) {
    if (child.root.name === name) return child
    const hit = findChild(child, name)
    if (hit) return hit
  }
  return null
}

export default class MapPanelScript extends BehaviourScript {
  override onStart(): void {
    const mode = this.gameMode as FishBaseGameMode | null
    if (!mode) {
      logger.warn('[MapPanelScript] 未找到 FishBaseGameMode，跳过绑定')
      return
    }
    const inst = GameInstance.current as FishGameInstance | null

    // ─── 1. 关闭按钮 ───
    const closeActor = this.findInChildren('Btn_mapClose')
    const closeBtn = closeActor?.getComponent(UIButtonComponent)
    if (closeBtn) {
      closeBtn.onClick = () => mode.closeMapPanel()
      logger.info('[MapPanelScript] 已绑定关闭按钮 → closeMapPanel')
    } else {
      logger.warn('[MapPanelScript] 未找到关闭按钮 "Btn_mapClose"，跳过')
    }

    // ─── 2. 关卡列表（读表 → 动态生成卡片 → 按配置表 pos 定位） ───
    const levelTable = inst?.getLevelTable()
    const world = this.world
    const levelList = this.findInChildren('LevelList')
    if (!levelTable) {
      logger.warn('[MapPanelScript] 关卡表未加载（getTable 返回 undefined），关卡列表为空')
    } else if (!world) {
      logger.error('[MapPanelScript] world 为空，无法动态生成关卡卡片')
    } else if (!levelList) {
      logger.error('[MapPanelScript] 未找到关卡容器节点 "LevelList"，无法挂载卡片')
    } else {
      let created = 0
      for (const id of levelTable.getRowNames()) {
        const level = levelTable.getRow(id)
        if (!level) continue
        // 按路径从蓝图实例化卡片，挂到 LevelList
        const card = world.ui.spawnUIActor(LEVEL_CARD_BLUEPRINT, levelList)
        if (!card) {
          logger.error(`[MapPanelScript] 关卡卡片生成失败: "${id}"（蓝图 ${LEVEL_CARD_BLUEPRINT}）`)
          continue
        }
        // 节点名 = Level_{id}（便于按关卡定位）
        card.root.name = `Level_${id}`

        // 名称文本（含星级）
        const nameText = findChild(card, 'Name')?.getComponent(UITextComponent)
        if (nameText) nameText.text = `${level.name} ${starsText(level.stars)}`

        // 描述文本
        const infoText = findChild(card, 'Info')?.getComponent(UITextComponent)
        if (infoText) infoText.text = level.desc

        // 位置：anchor=center + anchorOffset=配置表 pos（地图节点位置可配置）
        const tsf = card.getComponent(UITransformComponent)
        if (tsf) {
          tsf.anchor = 'center'
          tsf.anchorOffset = [...level.pos]
        }

        // 点击 → 进入关卡（GameInstance 阶段切换：加载关卡场景）
        const cardBtn = card.getComponent(UIButtonComponent)
        if (cardBtn) {
          cardBtn.onClick = () => inst?.enterLevel(id)
        }

        created++
      }
      logger.info(`[MapPanelScript] 关卡卡片动态生成 ${created}/${levelTable.size} 个（位置来自配置表 pos）`)
    }
  }
}
