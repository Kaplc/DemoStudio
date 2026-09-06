/**
 * ConstructionPanelScript — 建造面板（排建筑 + 队列进度）
 */
import { BehaviourScript, UILayoutComponent, UIProgressBarComponent, logger, UITextComponent, Actor } from '@/engine'
import { Hoi4PanelScript, hoi4Mode, findButton, findText, TextBinder } from './uiCommon'

const ROW_WIDGET = 'asset/blueprints/ui/queue_row.widget.json'

export default class ConstructionPanelScript extends Hoi4PanelScript {
  private binder = new TextBinder()
  private rows: Array<{ actor: Actor; bar: UIProgressBarComponent | null; info: UITextComponent | null }> = []

  override onStart(): void {
    const mode = hoi4Mode()
    if (!mode) {
      logger.warn('[ConstructionPanelScript] GameMode 未就绪')
      return
    }
    this.bindClose()
    mode.hourTickListeners.add(this.onTick)
    const civBtn = findButton(this.actor, 'Btn_civ')
    if (civBtn) civBtn.onClick = () => hoi4Mode()?.cmdQueueConstruction('civilian_factory')
    const milBtn = findButton(this.actor, 'Btn_mil')
    if (milBtn) milBtn.onClick = () => hoi4Mode()?.cmdQueueConstruction('military_factory')
    const infraBtn = findButton(this.actor, 'Btn_infra')
    if (infraBtn) infraBtn.onClick = () => hoi4Mode()?.cmdQueueConstruction('infrastructure')
  }

  private onTick = (): void => {
    const mode = hoi4Mode()
    if (!mode?.coreState) return
    const state = mode.coreState
    const tables = mode.getTables()
    const c = state.playerTag ? state.countries[state.playerTag] : null
    if (!c) return
    const civEff = c.civFactories * (1 - (tables.laws.economy.find((l) => l.id === c.laws.economy)?.cg ?? 0.3))
    this.binder.set(findText(this.actor, 'CivText'), `民用工厂 ${c.civFactories}（扣消费品后可用 ${civEff.toFixed(1)}）· 建造吞吐 ${Math.floor(civEff * tables.combat.civFactoryOutput)} 点/日`)

    // 队列行同步（数量变化重建，数值刷新）
    if (this.rows.length !== c.constructionQueue.length) {
      this.clearRows()
      const list = this.findInChildren('QueueList')
      if (list) {
        for (const item of c.constructionQueue) {
          const row = this.world?.ui.spawnUIActor(ROW_WIDGET, list)
          if (!row) continue
          this.rows.push({ actor: row, bar: this.findBar(row), info: findText(row, 'InfoText') })
          const nameT = findText(row, 'NameText')
          if (nameT) nameT.text = tables.buildings[item.building]?.name ?? item.building
          const stateName = mode.map.state(item.stateId)?.name ?? `州${item.stateId}`
          const st = findText(row, 'Label_act')
          if (st) st.text = ''
          void stateName
        }
        list.getComponent(UILayoutComponent)?.layout()
      }
    }
    c.constructionQueue.forEach((item, i) => {
      const r = this.rows[i]
      if (!r) return
      if (r.bar) r.bar.value = Math.min(100, (item.progress / item.cost) * 100)
      if (r.info) r.info.text = `${Math.floor(item.progress)}/${item.cost} 点`
    })
  }

  private findBar(root: Actor): UIProgressBarComponent | null {
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

  private clearRows(): void {
    for (const r of this.rows) this.world?.ui.destroyUIActor(r.actor)
    this.rows = []
  }

  override onDestroy(): void {
    hoi4Mode()?.hourTickListeners.delete(this.onTick)
    this.clearRows()
  }
}

