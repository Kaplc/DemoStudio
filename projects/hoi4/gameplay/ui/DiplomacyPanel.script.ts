/**
 * DiplomacyPanelScript — 外交面板（列国关系 + 借口/宣战按钮）
 */
import { BehaviourScript, UILayoutComponent, UIImageComponent, logger, UIButtonComponent, UITextComponent, Actor, ActorComponent } from '@/engine'
import { Hoi4PanelScript, hoi4Mode, findButton, findText, TextBinder } from './uiCommon'

const ROW_WIDGET = 'asset/blueprints/ui/diplo_row.widget.json'

export default class DiplomacyPanelScript extends Hoi4PanelScript {
  private binder = new TextBinder()
  private rows = new Map<string, { actor: Actor; swatch: UIImageComponent | null; btn: UIButtonComponent | null; label: UITextComponent | null }>()
  private onTick = (): void => this.refresh()

  override onStart(): void {
    const mode = hoi4Mode()
    if (!mode) {
      logger.warn('[DiplomacyPanelScript] GameMode 未就绪')
      return
    }
    this.bindClose()
    mode.hourTickListeners.add(this.onTick)
    const list = this.findInChildren('CountryList')
    const state = mode.coreState
    const tables = mode.getTables()
    if (list && state) {
      for (const tag of Object.keys(tables.countries)) {
        if (tag === state.playerTag) continue
        const row = this.world?.ui.spawnUIActor(ROW_WIDGET, list)
        if (!row) continue
        row.root.name = `DiploRow_${tag}`
        const swatch = row.getComponent(UIImageComponent)
        const nameT = findText(row, 'NameText')
        if (nameT) nameT.text = tables.countries[tag]?.name ?? tag
        const sw = findText(row, 'InfoText')
        void sw
        const swatchEl = findComp(row, 'Swatch', UIImageComponent)
        if (swatchEl) swatchEl.color = tables.countries[tag]?.color ?? '#888888'
        const btn = findButton(row, 'Btn_act')
        if (btn) {
          btn.onClick = () => {
            const m = hoi4Mode()
            if (!m?.coreState?.playerTag) return
            const c = m.coreState.countries[m.coreState.playerTag]
            if (c.warGoals.includes(tag) || c.wars.includes(tag)) m.cmdDeclareWar(tag)
            else m.cmdJustify(tag)
            this.refresh()
          }
        }
        this.rows.set(tag, { actor: row, swatch: swatchEl, btn, label: findText(row, 'Label_act') })
      }
      list.getComponent(UILayoutComponent)?.layout()
    }
    this.refresh()
  }

  private refresh(): void {
    const mode = hoi4Mode()
    if (!mode?.coreState) return
    const state = mode.coreState
    const c = state.playerTag ? state.countries[state.playerTag] : null
    if (!c) return
    for (const [tag, r] of this.rows) {
      const other = state.countries[tag]
      if (!other || other.capitulated) {
        if (r.label) r.label.text = '已投降'
        continue
      }
      const atWar = c.wars.includes(tag)
      const goal = c.warGoals.includes(tag)
      const justifying = c.justifying[tag]
      let rel = '和平'
      if (atWar) rel = '交战中'
      this.binder.set(findText(r.actor, 'RelText'), `${rel} · ${other.warSupport.toFixed(0)}%战支`)
      if (r.label) {
        if (atWar) r.label.text = '交战中'
        else if (goal) r.label.text = '宣战'
        else if (justifying) r.label.text = `借口 ${Math.ceil(justifying)}天`
        else r.label.text = '制造借口'
      }
      if (r.btn) {
        r.btn.onClick = atWar
          ? () => { /* 已在交战 */ }
          : () => {
              const m = hoi4Mode()
              if (!m?.coreState?.playerTag) return
              if (c.warGoals.includes(tag)) m.cmdDeclareWar(tag)
              else m.cmdJustify(tag)
              this.refresh()
            }
      }
    }
  }

  override onDestroy(): void {
    hoi4Mode()?.hourTickListeners.delete(this.onTick)
    for (const r of this.rows.values()) this.world?.ui.destroyUIActor(r.actor)
    this.rows.clear()
  }
}

function findComp<T extends ActorComponent>(root: Actor | null, name: string, cls: new (...args: any[]) => T): T | null {
  const walk = (a: Actor): T | null => {
    for (const c of a.getChildren()) {
      if (c.root.name === name) return c.getComponent(cls)
      const hit = walk(c)
      if (hit) return hit
    }
    return null
  }
  return root ? walk(root) : null
}
