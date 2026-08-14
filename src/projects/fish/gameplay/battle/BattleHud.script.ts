/**
 * BattleHudScript — 战斗 HUD 行为脚本（攻打其他部落）
 *
 * 通过 UIScriptComponent 挂载到 battle_hud.widget.json 的根节点：
 *  1. 读取兵种表 + 训练组件军队，按表动态生成兵种卡片（复用 troop_card 蓝图）：
 *     每个卡片 → 名称/剩余数量文本、兵种色背景、点击 → FishLevelGameMode.selectTroop
 *     （进入放置模式）；数量不足（0）的兵种卡片置灰禁用
 *  2. 卡片挂到 CardList，由 UILayoutComponent（grid 8 列）自动排布
 *  3. onUpdate 每帧刷新：
 *     - 卡片剩余数量 + 禁用状态 + 放置中高亮
 *     - 已部署统计（DeployLabel：累计部署 / 场上存活 / 军队剩余）
 *  4. 无 dps 的兵种（治疗师）不生成卡片（无攻击能力，超出战斗范围）
 *
 * 由 World 场景切换（GameMode.HUDClass）自动创建。
 */
import { BehaviourScript, UIButtonComponent, UITextComponent, UIImageComponent, UILayoutComponent, logger, GameInstance } from '@/engine'
import type { Actor } from '@/engine'
import type { FishLevelGameMode } from '../level/FishLevelGameMode'
import type { FishGameInstance } from '../FishGameInstance'

/** 兵种卡片蓝图路径（复用兵营训练卡片，相对 src/projects/，由 BlueprintRegistry 注册） */
const TROOP_CARD_BLUEPRINT = 'asset/blueprints/ui/troop_card.blueprint.json'

/** 兵种色数字 → CSS hex（如 0xe53935 → "#e53935"） */
function colorToCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
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

/** 卡片运行时引用（onUpdate 刷新用） */
interface BattleCardEntry {
  troopId: string
  actor: Actor
  btn: UIButtonComponent
  infoText: UITextComponent | null
}

export default class BattleHudScript extends BehaviourScript {
  /** 战斗 GameMode（放兵/统计入口） */
  private gm: FishLevelGameMode | null = null
  /** GameInstance（训练军队组件跨阶段共享） */
  private inst: FishGameInstance | null = null
  /** 已部署统计文本组件（onUpdate 刷新） */
  private deployText: UITextComponent | null = null
  /** 兵种卡片列表（onUpdate 刷新数量/禁用/高亮） */
  private cards: BattleCardEntry[] = []
  /** 上次显示的统计文本（仅变化时重设，避免每帧触发 troika 字形重排） */
  private lastDeployText = ''

  override onStart(): void {
    const gm = this.gameMode as FishLevelGameMode | null
    const inst = GameInstance.current as FishGameInstance | null
    if (!gm) {
      logger.warn('[BattleHudScript] 未找到 FishLevelGameMode，跳过绑定')
      return
    }
    this.gm = gm
    this.inst = inst

    // ─── 1. 兵种卡片列表（读表 → 动态生成卡片 → grid 布局排布） ───
    const troopTable = inst?.getTroopTable()
    const world = this.world
    const cardList = this.findInChildren('CardList')
    if (!troopTable) {
      logger.warn('[BattleHudScript] 兵种表未加载（getTable 返回 undefined），卡片列表为空')
    } else if (!world) {
      logger.error('[BattleHudScript] world 为空，无法动态生成兵种卡片')
    } else if (!cardList) {
      logger.error('[BattleHudScript] 未找到卡片容器节点 "CardList"，无法挂载卡片')
    } else {
      let created = 0
      for (const id of troopTable.getRowNames()) {
        const troop = troopTable.getRow(id)
        if (!troop || troop.dps <= 0) continue // 无伤害兵种（治疗师）不参与战斗
        // 按路径从蓝图实例化卡片，挂到 CardList
        const card = world.ui.spawnUIActor(TROOP_CARD_BLUEPRINT, cardList)
        if (!card) {
          logger.error(`[BattleHudScript] 兵种卡片生成失败: "${id}"（蓝图 ${TROOP_CARD_BLUEPRINT}）`)
          continue
        }
        // 节点名 = BattleCard_{id}（同资产内唯一，便于定位）
        card.root.name = `BattleCard_${id}`

        // 名称文本
        const nameText = findChild(card, 'Name')?.getComponent(UITextComponent)
        if (nameText) nameText.text = troop.name

        // 属性/数量文本（onUpdate 刷新）
        const infoText = findChild(card, 'Info')?.getComponent(UITextComponent) ?? null

        // 背景色（兵种色）
        const bg = card.getComponent(UIImageComponent)
        if (bg) bg.color = colorToCss(troop.color)

        // 点击 → 选择兵种进入放置模式（数量 > 0 才响应）
        const troopBtn = card.getComponent(UIButtonComponent)
        if (troopBtn) {
          troopBtn.onClick = () => {
            const count = this.inst?.training.getArmyCount(id) ?? 0
            if (count > 0) this.gm?.selectTroop(id)
            else logger.warn(`[BattleHudScript] 兵种 "${troop.name}" 数量不足，无法选择`)
          }
        }

        if (troopBtn) this.cards.push({ troopId: id, actor: card, btn: troopBtn, infoText })
        created++
      }
      // 布局组件：主动布局一次（grid 自动排布）
      const layout = cardList.getComponent(UILayoutComponent)
      if (layout) {
        layout.layout()
        logger.info(`[BattleHudScript] 兵种卡片动态生成 ${created}/${troopTable.size} 个（grid 布局 ${layout.columns} 列）`)
      } else {
        logger.warn('[BattleHudScript] 卡片已生成，但 CardList 未挂 UILayoutComponent，未排布')
      }
    }

    // ─── 2. 已部署统计文本 ───
    const deployActor = this.findInChildren('DeployLabel')
    const deployText = deployActor?.getComponent(UITextComponent)
    if (deployText) {
      this.deployText = deployText
      logger.info('[BattleHudScript] 已部署统计文本已绑定')
    } else {
      logger.warn('[BattleHudScript] 未找到统计文本节点 "DeployLabel"，跳过统计显示')
    }
  }

  /** 每帧刷新：卡片数量/禁用/放置高亮 + 部署统计 */
  override onUpdate(_dt: number): void {
    const gm = this.gm
    const inst = this.inst
    if (!gm || !inst) return

    // ─── 卡片刷新：剩余数量 + 禁用/放置中状态 ───
    for (const entry of this.cards) {
      const count = inst.training.getArmyCount(entry.troopId)
      const placing = gm.placeTroopId === entry.troopId
      // 数量不足 → 禁用（置灰）；放置中 → 按压高亮；否则正常
      const state = count <= 0 ? 'disabled' : placing ? 'pressed' : 'normal'
      if (entry.btn.state !== state) entry.btn.state = state
      if (entry.infoText) {
        const troop = inst.getTroop(entry.troopId)
        const dpsText = troop && troop.dps > 0 ? `伤 ${troop.dps}` : ''
        const text = `剩 ${count}${dpsText ? ` · ${dpsText}` : ''}${placing ? ' ▶ 放置中' : ''}`
        if (entry.infoText.text !== text) entry.infoText.text = text
      }
    }

    // ─── 统计文本刷新（仅变化时重设） ───
    const army = inst.training.getArmySummary()
    const text = `已部署 ${gm.getDeployedCount()} · 场上 ${gm.getAliveTroopCount()} · 军队: ${army}`
    if (this.deployText && text !== this.lastDeployText) {
      this.lastDeployText = text
      this.deployText.text = text
    }
  }
}
