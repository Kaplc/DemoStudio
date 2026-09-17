/**
 * TasksUiScript — 任务面板行为脚本（成就 + 每日任务）
 *
 * 通过 UIScriptComponent 挂载到 tasks_ui.widget.json 的根节点：
 *  1. 关闭按钮（Btn_tasksClose）→ FishBaseGameMode.closeTasksPanel()
 *  2. 成就列表（AchievementList）：AchievementService 快照 → 卡片（名称/进度/领取按钮）
 *  3. 每日任务列表（DailyList）：每日 3 条 → 卡片（名称/进度/领取按钮）
 *  4. 领取 → ProgressionService.claimAchievement / claimDaily（幂等，奖励统一入仓）
 *
 * 由 FishBaseGameMode.openTasksPanel 打开任务面板时生成（HUD "任务"按钮入口）。
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

/** 任务卡片蓝图（复用 troop_card：Name + Info + UIButton） */
const TASK_CARD_BLUEPRINT = 'asset/blueprints/ui/troop_card.widget.json'

function findChild(actor: Actor, name: string): Actor | null {
  for (const child of actor.getChildren()) {
    if (child.root.name === name) return child
    const hit = findChild(child, name)
    if (hit) return hit
  }
  return null
}

export default class TasksUiScript extends BehaviourScript {
  private inst: FishGameInstance | null = null
  /** 成就/每日卡片（onUpdate 刷新进度与领取态） */
  private achCards: Array<{ id: string, info: UITextComponent | null, btn: UIButtonComponent }> = []
  private dailyCards: Array<{ id: string, info: UITextComponent | null, btn: UIButtonComponent }> = []
  private lastAch = new Map<string, string>()
  private lastDaily = new Map<string, string>()

  override onStart(): void {
    const mode = this.gameMode as FishBaseGameMode | null
    if (!mode) {
      logger.warn('[TasksUiScript] 未找到 FishBaseGameMode，跳过绑定')
      return
    }
    const inst = GameInstance.current as FishGameInstance | null
    this.inst = inst

    // ─── 1. 关闭按钮 ───
    const btn = this.findInChildren('Btn_tasksClose')?.getComponent(UIButtonComponent)
    if (btn) {
      btn.onClick = () => mode.closeTasksPanel()
      logger.info('[TasksUiScript] 已绑定关闭按钮 → closeTasksPanel')
    }

    // ─── 2. 成就卡片 ───
    const world = this.world
    const achList = this.findInChildren('AchievementList')
    const dailyList = this.findInChildren('DailyList')
    if (world && inst && achList) {
      for (const snap of inst.progression.getAchievementSnapshot()) {
        const card = world.ui.spawnUIActor(TASK_CARD_BLUEPRINT, achList)
        if (!card) continue
        card.root.name = `Ach_${snap.id}`
        card.name = `Ach_${snap.id}`
        const name = findChild(card, 'Name')?.getComponent(UITextComponent)
        if (name) name.text = snap.def.name.replace('{n}', String(snap.def.target))
        const info = findChild(card, 'Info')?.getComponent(UITextComponent) ?? null
        // 兵种色 + 点击：image/button 挂在 TrainButton 子节点（2026-09-02 资产重建后根节点不再直挂）
        const btnHost = findChild(card, 'TrainButton')
        const bg = btnHost?.getComponent(UIImageComponent)
        if (bg) bg.color = snap.claimable ? '#ffd700' : snap.claimed ? '#555555' : '#37474f'
        const cbtn = btnHost?.getComponent(UIButtonComponent)
        if (cbtn) {
          cbtn.onClick = () => {
            const ok = inst.progression.claimAchievement(snap.id)
            if (!ok) logger.warn(`[TasksUiScript] 成就 ${snap.id} 领取失败（未达标或已领取）`)
          }
        }
        if (cbtn) this.achCards.push({ id: snap.id, info, btn: cbtn })
      }
      achList.getComponent(UILayoutComponent)?.layout()
      logger.info(`[TasksUiScript] 成就卡片生成 ${this.achCards.length} 个`)
    }

    // ─── 3. 每日任务卡片 ───
    if (world && inst && dailyList) {
      for (const t of inst.progression.getDailyTasks()) {
        const card = world.ui.spawnUIActor(TASK_CARD_BLUEPRINT, dailyList)
        if (!card) continue
        card.root.name = `Daily_${t.taskId}`
        card.name = `Daily_${t.taskId}`
        const name = findChild(card, 'Name')?.getComponent(UITextComponent)
        if (name) name.text = t.name.replace('{n}', String(t.target))
        const info = findChild(card, 'Info')?.getComponent(UITextComponent) ?? null
        const btnHost = findChild(card, 'TrainButton')
        const bg = btnHost?.getComponent(UIImageComponent)
        if (bg) bg.color = t.claimed ? '#555555' : '#2e7d32'
        const cbtn = btnHost?.getComponent(UIButtonComponent)
        if (cbtn) {
          cbtn.onClick = () => {
            const ok = inst.progression.claimDaily(t.taskId)
            if (!ok) logger.warn(`[TasksUiScript] 每日任务 ${t.taskId} 领取失败（未完成或已领取）`)
          }
        }
        if (cbtn) this.dailyCards.push({ id: t.taskId, info, btn: cbtn })
      }
      dailyList.getComponent(UILayoutComponent)?.layout()
      logger.info(`[TasksUiScript] 每日任务卡片生成 ${this.dailyCards.length} 个`)
    }
  }

  override onUpdate(_dt: number): void {
    const inst = this.inst
    if (!inst) return
    // 成就进度/领取态刷新
    const snap = inst.progression.getAchievementSnapshot()
    for (const c of this.achCards) {
      const s = snap.find((x) => x.id === c.id)
      if (!s) continue
      const text = s.claimed ? '已领取' : s.claimable ? '✅ 可领取！' : `${s.progress}/${s.def.target}`
      if (this.lastAch.get(c.id) !== text) {
        this.lastAch.set(c.id, text)
        if (c.info) c.info.text = text
        if (c.btn) c.btn.state = s.claimable ? 'normal' : 'disabled'
      }
    }
    // 每日进度/领取态刷新
    for (const c of this.dailyCards) {
      const t = inst.progression.getDailyTasks().find((x) => x.taskId === c.id)
      if (!t) continue
      const text = t.claimed ? '已领取' : t.progress >= t.target ? '✅ 可领取！' : `${t.progress}/${t.target}`
      if (this.lastDaily.get(c.id) !== text) {
        this.lastDaily.set(c.id, text)
        if (c.info) c.info.text = text
        if (c.btn) c.btn.state = t.progress >= t.target && !t.claimed ? 'normal' : 'disabled'
      }
    }
  }
}
