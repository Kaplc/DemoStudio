/**
 * ProductionPanelScript — 生产面板（生产线列表 + 新建产线按钮）
 */
import { BehaviourScript, UILayoutComponent, UIImageComponent, logger, UIProgressBarComponent, UITextComponent, Actor } from '@/engine'
import { Hoi4PanelScript, hoi4Mode, findButton, findText, TextBinder } from './uiCommon'
import { resourceIncome } from '../core/Economy'

const ROW_WIDGET = 'asset/blueprints/ui/queue_row.widget.json'

export default class ProductionPanelScript extends Hoi4PanelScript {
  private binder = new TextBinder()
  private rows: Array<{ actor: Actor; bar: UIProgressBarComponent | null; info: UITextComponent | null; actLabel: UITextComponent | null }> = []
  private addButtons: Array<{ actor: Actor; equip: string; label: UITextComponent | null; swatch: UIImageComponent | null }> = []
  private onTick = (): void => this.refresh()

  override onStart(): void {
    const mode = hoi4Mode()
    if (!mode) {
      logger.warn('[ProductionPanelScript] GameMode 未就绪')
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
    const inc = resourceIncome(state, mode.map, state.playerTag!)
    this.binder.set(findText(this.actor, 'MilText'), `军工厂 ${c.milFactories} · 钢 +${inc.steel}/日 · 油 +${inc.oil}/日 · 库存 ${equipSummary(c.equipmentStock, tables)}`)

    // 生产线行
    if (this.rows.length !== c.productionLines.length) {
      this.clearRows()
      const list = this.findInChildren('LineList')
      if (list) {
        for (const line of c.productionLines) {
          const row = this.world?.ui.spawnUIActor(ROW_WIDGET, list)
          if (!row) continue
          this.rows.push({
            actor: row,
            bar: findBarOf(row),
            info: findText(row, 'InfoText'),
            actLabel: findText(row, 'Label_act'),
          })
        }
        list.getComponent(UILayoutComponent)?.layout()
      }
    }
    c.productionLines.forEach((line, i) => {
      const r = this.rows[i]
      if (!r) return
      const nameT = findText(r.actor, 'NameText')
      if (nameT) nameT.text = tables.equipments[line.equipment]?.name ?? line.equipment
      if (r.bar) r.bar.value = line.efficiency * 100
      if (r.info) r.info.text = `${line.factories} 厂 · 效率 ${(line.efficiency * 100).toFixed(0)}%`
      if (r.actLabel) r.actLabel.text = `库存 ${Math.floor(c.equipmentStock[line.equipment] ?? 0)}`
    })

    // 新建产线按钮（已解锁装备各一枚）
    const box = this.findInChildren('AddBox')
    if (box && this.addButtons.length === 0) {
      for (const equip of Object.keys(tables.equipments)) {
        const btn = this.world?.ui.spawnUIActor('asset/blueprints/ui/equip_card.widget.json', box)
        if (!btn) continue
        const label = findText(btn, 'Label_equip')
        if (label) label.text = tables.equipments[equip].name
        this.addButtons.push({ actor: btn, equip, label, swatch: null })
        const b = findButton(btn, 'Btn_add')
        if (b) {
          b.onClick = () => {
            hoi4Mode()?.cmdAddProductionLine(equip, 5)
          }
        }
      }
    }
    for (const ab of this.addButtons) {
      const unlocked = c.unlockedEquipments.includes(ab.equip)
      const labelT = findText(ab.actor, 'SubLabel')
      if (labelT) labelT.text = unlocked ? '点击 +5 厂' : '需科技解锁'
    }
  }

  private clearRows(): void {
    for (const r of this.rows) this.world?.ui.destroyUIActor(r.actor)
    this.rows = []
  }

  override onDestroy(): void {
    hoi4Mode()?.hourTickListeners.delete(this.onTick)
    this.clearRows()
  }
}

function equipSummary(stock: Record<string, number>, tables: import('../../gameplay/core/tables').Hoi4Tables): string {
  return Object.keys(tables.equipments)
    .filter((k) => (stock[k] ?? 0) > 0)
    .map((k) => `${tables.equipments[k].name} ${Math.floor(stock[k])}`)
    .join(' · ') || '空'
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
