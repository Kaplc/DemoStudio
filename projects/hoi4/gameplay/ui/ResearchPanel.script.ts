/**
 * ResearchPanelScript — 科研面板（在研进度 + 可选科技列表）
 */
import { BehaviourScript, logger, UIProgressBarComponent, UIButtonComponent, UITextComponent, Actor, UILayoutComponent } from '@/engine'
import { Hoi4PanelScript, hoi4Mode, findButton, findText, TextBinder } from './uiCommon'

const ROW_WIDGET = 'asset/blueprints/ui/queue_row.widget.json'
const TECH_ROW_WIDGET = 'asset/blueprints/ui/tech_row.widget.json'
const CAT_NAMES: Record<string, string> = { infantry: '步兵', artillery: '火炮', armor: '装甲', industry: '工业', doctrine: '学说' }

export default class ResearchPanelScript extends Hoi4PanelScript {
  private binder = new TextBinder()
  private currentRows: Array<{ actor: Actor; bar: UIProgressBarComponent | null; info: UITextComponent | null }> = []
  private availRows: Array<{ actor: Actor; techId: string }> = []
  private onTick = (): void => this.refresh()

  override onStart(): void {
    const mode = hoi4Mode()
    if (!mode) {
      logger.warn('[ResearchPanelScript] GameMode 未就绪')
      return
    }
    this.bindClose()
    mode.hourTickListeners.add(this.onTick)
  }

  private refresh(): void {
    const mode = hoi4Mode()
    if (!mode?.coreState) return
    const state = mode.coreState
    const tables = mode.getTables()
    const c = state.playerTag ? state.countries[state.playerTag] : null
    if (!c) return
    this.binder.set(findText(this.actor, 'SlotText'), `研究槽位 ${c.techs.researching.length}/3 · 已完成 ${c.techs.completed.length}/${Object.keys(tables.techs).length}`)

    // 在研行
    if (this.currentRows.length !== c.techs.researching.length) {
      this.clearCurrent()
      const list = this.findInChildren('CurrentList')
      if (list) {
        for (const r of c.techs.researching) {
          const row = this.world?.ui.spawnUIActor(ROW_WIDGET, list)
          if (!row) continue
          this.currentRows.push({ actor: row, bar: findBarOf(row), info: findText(row, 'InfoText') })
          const nameT = findText(row, 'NameText')
          if (nameT) nameT.text = tables.techs[r.id]?.name ?? r.id
        }
        list.getComponent(UILayoutComponent)?.layout()
      }
    }
    c.techs.researching.forEach((r, i) => {
      const row = this.currentRows[i]
      if (!row) return
      const def = tables.techs[r.id]
      if (row.bar) row.bar.value = def ? (1 - r.daysLeft / def.days) * 100 : 0
      if (row.info) row.info.text = `剩余 ${Math.ceil(r.daysLeft)} 天`
    })

    // 可选科技（重建每次但只在集合变化时）
    const avail = Object.keys(tables.techs).filter((id) => techSelectable(state, tables, state.playerTag!, id))
    const sig = avail.join(',')
    if (sig !== this.availSig) {
      this.availSig = sig
      this.clearAvail()
      const list = this.findInChildren('AvailList')
      if (list) {
        for (const id of avail) {
          const def = tables.techs[id]
          const row = this.world?.ui.spawnUIActor(TECH_ROW_WIDGET, list)
          if (!row) continue
          this.availRows.push({ actor: row, techId: id })
          const nameT = findText(row, 'NameText')
          if (nameT) nameT.text = `${def.name}（${CAT_NAMES[def.category] ?? def.category}）`
          const actLabel = findText(row, 'Label_act')
          if (actLabel) actLabel.text = '研究'
          const actBtn = findButtonOf(row, 'Btn_act')
          if (actBtn) {
            actBtn.onClick = () => {
              hoi4Mode()?.cmdStartResearch(id)
            }
          }
        }
      }
    }
    for (const r of this.availRows) {
      const def = tables.techs[r.techId]
      const info = findText(r.actor, 'InfoText')
      if (info) info.text = `${def.days} 天${def.prereq.length ? ' · 前置 ' + def.prereq.map((p) => tables.techs[p]?.name ?? p).join(',') : ''}`
    }
  }

  private availSig = ''

  private clearCurrent(): void {
    for (const r of this.currentRows) this.world?.ui.destroyUIActor(r.actor)
    this.currentRows = []
  }

  private clearAvail(): void {
    for (const r of this.availRows) this.world?.ui.destroyUIActor(r.actor)
    this.availRows = []
  }

  override onDestroy(): void {
    hoi4Mode()?.hourTickListeners.delete(this.onTick)
    this.clearCurrent()
    this.clearAvail()
  }
}

/** 可选科技（含槽位空位检查） */
function techSelectable(state: import('../../gameplay/core/types').Hoi4State, tables: import('../../gameplay/core/tables').Hoi4Tables, tag: string, techId: string): boolean {
  const c = state.countries[tag]
  const t = tables.techs[techId]
  if (!c || !t) return false
  if (c.techs.completed.includes(techId) || c.techs.researching.some((r) => r.id === techId)) return false
  if (c.techs.researching.length >= 3) return false
  for (const p of t.prereq) if (!c.techs.completed.includes(p)) return false
  for (const m of t.mutuallyExclusive ?? []) if (c.techs.completed.includes(m)) return false
  return true
}

function findBarOf(root: Actor): UIProgressBarComponent | null {
  const walk = (a: Actor): UIProgressBarComponent | null => {
    const own = a.getComponents(UIProgressBarComponent)
    if (own.length > 0) return own[0]
    for (const ch of a.getChildren()) {
      const hit = walk(ch)
      if (hit) return hit
    }
    return null
  }
  return walk(root)
}

function findButtonOf(root: Actor, name: string): UIButtonComponent | null {
  const walk = (a: Actor): UIButtonComponent | null => {
    for (const ch of a.getChildren()) {
      if (ch.root.name === name) return ch.getComponent(UIButtonComponent)
      const hit = walk(ch)
      if (hit) return hit
    }
    return null
  }
  return walk(root)
}
