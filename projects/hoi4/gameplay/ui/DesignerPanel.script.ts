/**
 * DesignerPanelScript — 编制设计器（加减营/支援连 + 属性预览 + 保存模板）
 */
import { BehaviourScript, UIImageComponent, logger, UITextComponent, UITextInputComponent } from '@/engine'
import { Hoi4PanelScript, hoi4Mode, findButton, findText, TextBinder } from './uiCommon'
import { computeTemplateStats } from '../core/Combat'
import { saveCustomTemplate } from '../core/Military'
import { templateEquipmentNeed, templateManpower } from '../core/Military'

const BAT_ROW_WIDGET = 'asset/blueprints/ui/bat_row.widget.json'
const SUPPORTS = ['engineer', 'recon', 'artillery_support', 'logistics']

export default class DesignerPanelScript extends Hoi4PanelScript {
  private binder = new TextBinder()
  private battalions: Record<string, number> = {}
  private supports = new Set<string>()
  private rows = new Map<string, UITextComponent | null>()
  private supButtons = new Map<string, { img: UIImageComponent | null; label: UITextComponent | null }>()

  override onStart(): void {
    const mode = hoi4Mode()
    if (!mode) {
      logger.warn('[DesignerPanelScript] GameMode 未就绪')
      return
    }
    this.bindClose()
    mode.hourTickListeners.add(this.onTick)
    const state = mode.coreState
    const tables = mode.getTables()
    const list = this.findInChildren('BatList')
    if (list && state) {
      for (const bid of Object.keys(tables.battalions)) {
        const row = this.world?.ui.spawnUIActor(BAT_ROW_WIDGET, list)
        if (!row) continue
        row.root.name = `Bat_${bid}`
        const nameT = findText(row, 'NameText')
        if (nameT) nameT.text = tables.battalions[bid].name
        this.rows.set(bid, findText(row, 'CountText'))
        const addBtn = findButton(row, 'Btn_add')
        if (addBtn) addBtn.onClick = () => this.adjust(bid, 1)
        const subBtn = findButton(row, 'Btn_sub')
        if (subBtn) subBtn.onClick = () => this.adjust(bid, -1)
        this.battalions[bid] = 0
      }
    }
    for (const sid of SUPPORTS) {
      const btn = findButton(this.actor, `Sup_${sid}`)
      if (btn) {
        btn.onClick = () => {
          if (this.supports.has(sid)) this.supports.delete(sid)
          else this.supports.add(sid)
          this.refresh()
        }
        this.supButtons.set(sid, { img: this.findInChildren('Sup_' + sid)?.getComponent(UIImageComponent) ?? null, label: null })
      }
    }
    const saveBtn = findButton(this.actor, 'Btn_save')
    if (saveBtn) {
      saveBtn.onClick = () => {
        const m = hoi4Mode()
        if (!m?.coreState?.playerTag) return
        const inputActor = this.findInChildren('NameInput')
        const name = (inputActor?.getComponent(UITextInputComponent)?.value ?? '').trim()
        const batt: Record<string, number> = {}
        for (const [bid, n] of Object.entries(this.battalions)) if (n > 0) batt[bid] = n
        const id = saveCustomTemplate(m.coreState, m.getTables(), m.coreState.playerTag, name, batt, [...this.supports])
        if (!id) logger.warn('[Designer] 保存失败（营数 1-25 或含未解锁营）')
        else logger.info(`[Designer] 编制已保存: ${id}`)
        this.refresh()
      }
    }
    this.refresh()
  }

  private adjust(bid: string, delta: number): void {
    const cur = this.battalions[bid] ?? 0
    this.battalions[bid] = Math.max(0, cur + delta)
    this.refresh()
  }

  private onTick = (): void => this.refresh()

  private refresh(): void {
    const mode = hoi4Mode()
    if (!mode?.coreState) return
    const state = mode.coreState
    const tables = mode.getTables()
    const c = state.playerTag ? state.countries[state.playerTag] : null
    if (!c) return
    for (const [bid, comp] of this.rows) {
      if (comp) comp.text = String(this.battalions[bid] ?? 0)
    }
    for (const [sid, btn] of this.supButtons) {
      if (btn.img) btn.img.color = this.supports.has(sid) ? '#55683a' : '#31445c'
    }
    // 属性预览（含全 0 营守卫）
    const batt: Record<string, number> = {}
    for (const [bid, n] of Object.entries(this.battalions)) if (n > 0) batt[bid] = n
    if (Object.keys(batt).length === 0) {
      this.binder.set(findText(this.actor, 'StatsText'), '点击左侧 + 添加营')
      return
    }
    const tpl = { name: 'preview', battalions: batt, supports: [...this.supports] }
    const stats = computeTemplateStats(tpl, tables, c.modifiers)
    const need = templateEquipmentNeed(tables, tpl)
    const mp = templateManpower(tables, tpl)
    const width = Math.min(25, stats.battalionCount)
    const lines = [
      `营数 ${width}/25 · 宽度 ${stats.width} · 人力 ${(mp / 1000).toFixed(1)}k`,
      `组织 ${stats.org} · 血量 ${stats.hp} · 装甲 ${stats.armor} · 硬度 ${(stats.hardness * 100).toFixed(0)}%`,
      `软攻 ${stats.softAttack.toFixed(0)} · 硬攻 ${stats.hardAttack.toFixed(0)}`,
      `防御 ${stats.defense.toFixed(0)} · 突破 ${stats.breakthrough.toFixed(0)}`,
      `装备需求：${Object.entries(need).map(([k, v]) => `${tables.equipments[k]?.name ?? k}×${v}`).join(' ')}`,
    ]
    this.binder.set(findText(this.actor, 'StatsText'), lines.join('\n'))
  }

  override onDestroy(): void {
    hoi4Mode()?.hourTickListeners.delete(this.onTick)
    this.rows.clear()
    this.supButtons.clear()
  }
}
