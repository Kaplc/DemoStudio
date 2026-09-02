/**
 * BarracksUiScript — 兵营专属 UI 行为脚本（Unity MonoBehaviour 风格）
 *
 * 通过 UIScriptComponent 挂载到 barracks_ui.widget.json 的根节点：
 *  1. 接管兵营面板的关闭按钮：点击后调用 GameMode.closeBarracksPanel()
 *  2. 从 FishGameInstance 取训练组件 + 兵种表，按表动态生成兵种卡片：
 *     每个兵种 → world.ui.spawnUIActor('asset/blueprints/ui/troop_card.widget.json')
 *     生成后改名 Troop_{id}、填充名称/属性文本与兵种色、绑定训练点击
 *     → GameInstance.trainTroop(id)；卡片挂到 TroopList，由 UILayoutComponent
 *     （grid 5 列）自动排布
 *  3. onUpdate 每帧刷新三行状态显示（各占一个独立文本控件）：
 *     - QueueLabel（训练队列）：队列项名称 + 剩余秒数
 *     - ArmyLabel（当前军队）：军队兵种摘要（如 野蛮人x3）
 *     - CapacityLabel（军队容量）：已占用（含队列）/ 上限
 *
 * 由 FishBaseGameMode.openBarracksPanel 打开兵营 UI 时生成。
 */
import {
  BehaviourScript,
  UIButtonComponent,
  UITextComponent,
  UIImageComponent,
  UILayoutComponent,
  logger,
  GameInstance,
} from '@/engine'
import type { Actor } from '@/engine'
import type { FishBaseGameMode } from './FishBaseGameMode'
import type { FishGameInstance } from '../FishGameInstance'

/** 兵种卡片蓝图路径（相对 src/projects/，由 BlueprintRegistry 注册） */
const TROOP_CARD_BLUEPRINT = 'asset/blueprints/ui/troop_card.widget.json'

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

export default class BarracksUiScript extends BehaviourScript {
  /** 队列文本组件（onStart 缓存，onUpdate 刷新） */
  private queueText: UITextComponent | null = null
  /** 当前军队文本组件（onStart 缓存，onUpdate 刷新） */
  private armyText: UITextComponent | null = null
  /** 军队容量文本组件（onStart 缓存，onUpdate 刷新） */
  private capacityText: UITextComponent | null = null
  /** 训练组件（GameInstance 跨阶段共享） */
  private inst: FishGameInstance | null = null
  /** 上次显示的各文本（仅变化时重设，避免每帧触发 troika 字形重排） */
  private lastText = { queue: '', army: '', capacity: '' }

  override onStart(): void {
    const mode = this.gameMode as FishBaseGameMode | null
    if (!mode) {
      logger.warn('[BarracksUiScript] 未找到 FishBaseGameMode，跳过绑定')
      return
    }
    // 训练/资源组件挂在 GameInstance（跨阶段共享），直接取组件使用
    const inst = GameInstance.current as FishGameInstance | null
    this.inst = inst

    // ─── 1. 关闭按钮 ───
    const btnActor = this.findInChildren('Btn_barracksClose')
    if (!btnActor) {
      logger.warn('[BarracksUiScript] 未找到关闭按钮节点 "Btn_barracksClose"')
    } else {
      const btn = btnActor.getComponent(UIButtonComponent)
      if (!btn) {
        logger.warn('[BarracksUiScript] 关闭按钮缺少 UIButtonComponent')
      } else {
        btn.onClick = () => mode.closeBarracksPanel()
        logger.info('[BarracksUiScript] 已绑定关闭按钮 → closeBarracksPanel')
      }
    }

    // ─── 2. 兵种列表（读表 → 按蓝图动态生成卡片 → 布局组件排布） ───
    const troopTable = inst?.getTroopTable()
    const world = this.world
    const troopList = this.findInChildren('TroopList')
    if (!troopTable) {
      logger.warn('[BarracksUiScript] 兵种表未加载（getTable 返回 undefined），兵种列表为空')
    } else if (!world) {
      logger.error('[BarracksUiScript] world 为空，无法动态生成兵种卡片')
    } else if (!troopList) {
      logger.error('[BarracksUiScript] 未找到兵种容器节点 "TroopList"，无法挂载卡片')
    } else {
      let created = 0
      for (const id of troopTable.getRowNames()) {
        const troop = troopTable.getRow(id)
        if (!troop) continue
        // 按路径从蓝图实例化卡片，直接挂到 TroopList（UILayoutComponent 负责网格排布）
        const card = world.ui.spawnUIActor(TROOP_CARD_BLUEPRINT, troopList)
        if (!card) {
          logger.error(`[BarracksUiScript] 兵种卡片生成失败: "${id}"（蓝图 ${TROOP_CARD_BLUEPRINT}）`)
          continue
        }
        // 节点名 = Troop_{id}（沿用旧命名，便于按兵种定位）
        card.root.name = `Troop_${id}`

        // 名称文本
        const nameText = findChild(card, 'Name')?.getComponent(UITextComponent)
        if (nameText) nameText.text = troop.name

        // 属性文本（HP · 伤害 · 费用）
        const infoText = findChild(card, 'Info')?.getComponent(UITextComponent)
        if (infoText) {
          infoText.text = `HP ${troop.hp} · ${troop.dps > 0 ? `伤 ${troop.dps}` : '治疗'} · 费 ${troop.cost}`
        }

        // 背景色（兵种色）：改节点自身 image 的颜色（视觉归 image，按钮只管交互）
        const bg = card.getComponent(UIImageComponent)
        if (bg) bg.color = colorToCss(troop.color)
        const troopBtn = card.getComponent(UIButtonComponent)
        if (troopBtn) {
          troopBtn.onClick = () => inst?.trainTroop(id)
        }

        created++
      }
      // 布局组件：主动布局一次（autoLayout 在 Tick 检测子项变化也会重排，这里兜底即时生效）
      const layout = troopList.getComponent(UILayoutComponent)
      if (layout) {
        layout.layout()
        logger.info(`[BarracksUiScript] 兵种卡片动态生成 ${created}/${troopTable.size} 个（grid 布局 ${layout.columns} 列）`)
      } else {
        logger.warn(`[BarracksUiScript] 兵种卡片动态生成 ${created}/${troopTable.size} 个，但 TroopList 未挂 UILayoutComponent，未排布`)
      }
    }

    // ─── 3. 训练队列/军队/容量显示（三个独立文本控件，各占一行，onUpdate 每帧刷新） ───
    const queueActor = this.findInChildren('QueueLabel')
    const queueText = queueActor?.getComponent(UITextComponent)
    if (queueText) {
      this.queueText = queueText
      logger.info('[BarracksUiScript] 训练队列文本已绑定')
    } else {
      logger.warn('[BarracksUiScript] 未找到队列文本节点 "QueueLabel"，跳过队列显示')
    }
    const armyActor = this.findInChildren('ArmyLabel')
    const armyText = armyActor?.getComponent(UITextComponent)
    if (armyText) {
      this.armyText = armyText
      logger.info('[BarracksUiScript] 当前军队文本已绑定')
    } else {
      logger.warn('[BarracksUiScript] 未找到军队文本节点 "ArmyLabel"，跳过军队显示')
    }
    const capacityActor = this.findInChildren('CapacityLabel')
    const capacityText = capacityActor?.getComponent(UITextComponent)
    if (capacityText) {
      this.capacityText = capacityText
      logger.info('[BarracksUiScript] 军队容量文本已绑定')
    } else {
      logger.warn('[BarracksUiScript] 未找到容量文本节点 "CapacityLabel"，跳过容量显示')
    }
    this.refreshQueue()
  }

  /** 每帧刷新训练队列显示（名称 + 剩余秒数 + 军队摘要） */
  override onUpdate(_dt: number): void {
    this.refreshQueue()
  }

  /**
   * 刷新三行状态文本：
   *  - 训练队列：'训练队列: 野蛮人 8s · 巨人 45s'（空闲显示"空闲"）
   *  - 当前军队：'当前军队: 野蛮人x1 巨人x2'（无兵显示"无"）
   *  - 军队容量：'军队容量: 12/40'
   */
  private refreshQueue(): void {
    if (!this.inst) return
    const training = this.inst.training

    // 训练队列行
    const queue = training.getQueue()
    const queueTextValue = queue.length === 0
      ? '训练队列: 空闲'
      : `训练队列: ${queue.map((t) => `${t.name} ${Math.ceil(t.remaining)}s`).join(' · ')}`
    this.applyText(this.queueText, 'queue', queueTextValue)

    // 当前军队行
    const army = training.getArmySummary()
    this.applyText(this.armyText, 'army', `当前军队: ${army}`)

    // 军队容量行（已占用 + 队列中占用 / 上限）
    const used = training.getArmyHousing() + queue.reduce((s, t) => s + t.housing, 0)
    this.applyText(this.capacityText, 'capacity', `军队容量: ${used}/${training.maxHousing}`)
  }

  /** 文本仅变化时重设（UIText setter 会触发 troika sync，避免每帧无谓重排） */
  private applyText(comp: UITextComponent | null, key: 'queue' | 'army' | 'capacity', value: string): void {
    if (!comp || this.lastText[key] === value) return
    this.lastText[key] = value
    comp.text = value
    // 高频路径（训练倒计时每秒变化触发 queue 刷新）：降为 debug，关键流程在绑定日志
    logger.debug(`[BarracksUiScript] 状态显示刷新[${key}]: ${value}`)
  }
}
