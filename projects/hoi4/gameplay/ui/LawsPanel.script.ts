/**
 * LawsPanelScript — 法律面板（三列阶梯切换）
 */
import { BehaviourScript, UIImageComponent, logger, UIButtonComponent, UITextComponent, Actor, ActorComponent } from '@/engine'
import { Hoi4PanelScript, hoi4Mode, findText, TextBinder } from './uiCommon'

const ROW_WIDGET = 'asset/blueprints/ui/law_row.widget.json'

export default class LawsPanelScript extends Hoi4PanelScript {
  private binder = new TextBinder()
  private rows = new Map<string, { actor: Actor; label: UITextComponent | null; info: UITextComponent | null; swatch: UIImageComponent | null }>()
  private onTick = (): void => this.refresh()

  override onStart(): void {
    const mode = hoi4Mode()
    if (!mode) {
      logger.warn('[LawsPanelScript] GameMode 未就绪')
      return
    }
    this.bindClose()
    mode.hourTickListeners.add(this.onTick)
    const state = mode.coreState
    const tables = mode.getTables()
    if (!state) return
    for (const cat of ['economy', 'conscription', 'trade'] as const) {
      const list = this.findInChildren(`List_${cat}`)
      if (!list) continue
      for (const law of tables.laws[cat]) {
        const row = this.world?.ui.spawnUIActor(ROW_WIDGET, list)
        if (!row) continue
        row.root.name = `Law_${law.id}`
        const nameT = findText(row, 'NameText')
        if (nameT) nameT.text = law.name
        const infoT = findText(row, 'InfoText')
        const swatch = findComp(row, 'Root', UIImageComponent)
        const btn = findComp(row, 'Btn_switch', UIButtonComponent)
        const label = findText(row, 'Label_switch')
        if (infoT) infoT.text = lawDesc(law.id, cat)
        if (btn) {
          btn.onClick = () => {
            hoi4Mode()?.cmdSwitchLaw(cat, law.id)
            this.refresh()
          }
        }
        this.rows.set(law.id, { actor: row, label, info: infoT, swatch })
      }
    }
    this.refresh()
  }

  private refresh(): void {
    const mode = hoi4Mode()
    if (!mode?.coreState) return
    const state = mode.coreState
    const c = state.playerTag ? state.countries[state.playerTag] : null
    if (!c) return
    this.binder.set(findText(this.actor, 'PpText'), `政治点 ${Math.floor(c.pp)}（当前经济法消费占比 ${(c.laws.economy === 'war_economy' ? 0.15 : c.laws.economy === 'partial_mobilitation' ? 0.25 : c.laws.economy === 'early_mobilitation' ? 0.3 : 0.35) * 100}%）`)
    const current = new Set([c.laws.economy, c.laws.conscription, c.laws.trade])
    for (const [id, r] of this.rows) {
      const isCurrent = current.has(id)
      if (r.label) r.label.text = isCurrent ? '生效中' : '切换'
      if (r.swatch) r.swatch.color = isCurrent ? '#55683a' : '#2c3b4c'
    }
  }

  override onDestroy(): void {
    hoi4Mode()?.hourTickListeners.delete(this.onTick)
    for (const r of this.rows.values()) this.world?.ui.destroyUIActor(r.actor)
    this.rows.clear()
  }
}

function lawDesc(id: string, _cat: string): string {
  const map: Record<string, string> = {
    civilian_economy: '消费35%',
    early_mobilitation: '消费30%',
    partial_mobilitation: '消费25%',
    war_economy: '消费15%',
    voluntary: '人力×1',
    limited: '人力×1.6',
    extensive: '人力×2.2',
    free_trade: '科研×1.1',
    export_focus: '科研×1',
    limited_export: '科研×0.95',
  }
  return map[id] ?? ''
}

function findComp<T extends ActorComponent>(root: Actor | null, name: string, cls: new (...args: any[]) => T): T | null {
  const walk = (a: Actor): T | null => {
    if (a.root.name === name) return a.getComponent(cls)
    for (const c of a.getChildren()) {
      const hit = walk(c)
      if (hit) return hit
    }
    return null
  }
  return root ? walk(root) : null
}
