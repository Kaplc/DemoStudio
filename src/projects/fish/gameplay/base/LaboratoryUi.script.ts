/**
 * LaboratoryUiScript — 实验室面板行为脚本（兵种研究入口）
 *
 * 通过 UIScriptComponent 挂载到 laboratory_ui.widget.json 的根节点：
 *  1. 关闭按钮（Btn_labClose）→ FishBaseGameMode.closeLaboratoryPanel()
 *  2. 读取兵种表（fish.troop）动态生成研究卡片（复用 troop_card 蓝图）：
 *     卡片显示 兵种名 / 当前等级 → 下一级 / 研究费用（药水）/ 耗时
 *     点击 → FishGameInstance.researchTroop(id)（校验+扣费+计时在服务内）
 *  3. ResearchLabel 每帧刷新研究状态（进行中倒计时 / 空闲）
 *
 * 由 FishBaseGameMode.openLaboratoryPanel 打开实验室 UI 时生成。
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

/** 兵种卡片蓝图路径（复用兵营训练卡片） */
const TROOP_CARD_BLUEPRINT = 'asset/blueprints/ui/troop_card.widget.json'

/** 兵种色数字 → CSS hex */
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

export default class LaboratoryUiScript extends BehaviourScript {
  private inst: FishGameInstance | null = null
  private researchText: UITextComponent | null = null
  private lastResearch = ''
  /** 研究卡片列表（onUpdate 刷新状态） */
  private cards: Array<{ troopId: string, btn: UIButtonComponent, infoText: UITextComponent | null }> = []
  private lastInfo = new Map<string, string>()

  override onStart(): void {
    const mode = this.gameMode as FishBaseGameMode | null
    if (!mode) {
      logger.warn('[LaboratoryUiScript] 未找到 FishBaseGameMode，跳过绑定')
      return
    }
    const inst = GameInstance.current as FishGameInstance | null
    this.inst = inst

    // ─── 1. 关闭按钮 ───
    const btnActor = this.findInChildren('Btn_labClose')
    const btn = btnActor?.getComponent(UIButtonComponent)
    if (btn) {
      btn.onClick = () => mode.closeLaboratoryPanel()
      logger.info('[LaboratoryUiScript] 已绑定关闭按钮 → closeLaboratoryPanel')
    } else {
      logger.warn('[LaboratoryUiScript] 未找到关闭按钮 "Btn_labClose"')
    }

    // ─── 2. 兵种研究列表 ───
    const troopTable = inst?.getTroopTable()
    const world = this.world
    const list = this.findInChildren('ResearchList')
    if (!troopTable || !world || !list) {
      logger.warn(`[LaboratoryUiScript] 研究列表初始化失败（table=${!!troopTable}, world=${!!world}, list=${!!list}）`)
      return
    }
    let created = 0
    for (const id of troopTable.getRowNames()) {
      const troop = troopTable.getRow(id)
      if (!troop?.levels) continue // 无等级表兵种不可研究
      const card = world.ui.spawnUIActor(TROOP_CARD_BLUEPRINT, list)
      if (!card) continue
      card.root.name = `Research_${id}`
      card.name = `Research_${id}`
      const nameText = findChild(card, 'Name')?.getComponent(UITextComponent)
      if (nameText) nameText.text = troop.name
      const infoText = findChild(card, 'Info')?.getComponent(UITextComponent) ?? null
      // 兵种色 + 点击：image/button 挂在 TrainButton 子节点（2026-09-02 资产重建后根节点不再直挂）
      const btnHost = findChild(card, 'TrainButton')
      const bg = btnHost?.getComponent(UIImageComponent)
      if (bg) bg.color = colorToCss(troop.color)
      const cardBtn = btnHost?.getComponent(UIButtonComponent)
      if (cardBtn) cardBtn.onClick = () => inst?.researchTroop(id)
      if (cardBtn) this.cards.push({ troopId: id, btn: cardBtn, infoText })
      created++
    }
    const layout = list.getComponent(UILayoutComponent)
    layout?.layout()
    logger.info(`[LaboratoryUiScript] 研究卡片生成 ${created} 个（实验室 ${inst?.production.getLabLevel() ?? 0} 级）`)

    // ─── 3. 研究状态行 ───
    const researchActor = this.findInChildren('ResearchLabel')
    this.researchText = researchActor?.getComponent(UITextComponent) ?? null
  }

  override onUpdate(_dt: number): void {
    const inst = this.inst
    if (!inst) return
    // 研究状态行
    const rs = inst.production.getResearching()
    const text = rs
      ? `研究中: ${rs.targetId}（剩 ${Math.max(0, Math.ceil((rs.finishAt - Date.now()) / 1000))}s）`
      : '研究状态: 空闲'
    if (this.researchText && text !== this.lastResearch) {
      this.lastResearch = text
      this.researchText.text = text
    }
    // 卡片信息（等级/费用/上限）
    for (const c of this.cards) {
      const troop = inst.getTroop(c.troopId)
      if (!troop?.levels) continue
      const cur = inst.production.getTroopLevel(c.troopId)
      const max = inst.production.troopMaxLevel(c.troopId)
      const next = troop.levels[cur] // levels[cur] = 下一级行（下标 0 = 1 级）
      let info: string
      if (!next) {
        info = `Lv${cur} MAX`
      } else if (cur >= max) {
        info = `Lv${cur} · 需实验室 Lv${cur + 1}`
      } else {
        info = `Lv${cur}→${cur + 1} · ${next.researchCost ?? 0}药水 · ${next.researchTime ?? 0}s`
      }
      if (this.lastInfo.get(c.troopId) !== info) {
        this.lastInfo.set(c.troopId, info)
        if (c.infoText) c.infoText.text = info
      }
    }
  }
}
