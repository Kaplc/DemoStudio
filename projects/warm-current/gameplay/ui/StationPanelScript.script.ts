/**
 * StationPanelScript — 空间站舱段面板行为脚本（station_panel.widget.json 根节点）
 *
 * 职责（2026-09-16 空间站模块：玩家设计空间站布局，数据由 GameMode.stationSel 驱动，本脚本只做差分呈现）：
 *  - 星图点空间站 → GameMode.openStationPanel(id) → vm.station 非空 → 面板展开
 *  - 面板内 ✕ / 点空地 → GameMode.closeStationPanel() → vm.station 为 null → 收起
 *  - 舱段模块行（ModuleList 动态生成 station_module_row，station_module 表键序）：
 *      显示舱段名/效果/造价，点击 toggle（安装即时扣费入 ledger.stationModule；
 *      已装行 = 点击卸下免费；同型单件）
 *  - 已装行高亮（暖紫底）；未装行预算不足 = 按钮隐藏（VM canToggle 口径）
 *  - 8Hz 差分同步；站被拆 → vm null → 收起
 */
import { BehaviourScript, UIImageComponent, logger } from '@/engine'
import type { Actor } from '@/engine'
import { TextBinder, VisBinder, findButton, findChild, findText, wcMode } from './uiCommon'

/** 空间站舱段面板 widget 资产路径（HudScript 生成入口） */
export const STATION_PANEL_WIDGET = 'asset/blueprints/ui/station_panel.widget.json'
/** 舱段模块行子 widget 资产路径（动态生成） */
export const STATION_MODULE_ROW_WIDGET = 'asset/blueprints/ui/station_module_row.widget.json'

/** 舱段行常态/已装底色 */
const ROW_NORMAL = '#1a1430'
const ROW_INSTALLED = '#3a2f6c'

export default class StationPanelScript extends BehaviourScript {
  private binder = new TextBinder()
  private colors = new Map<Actor, string>()
  private vis = new VisBinder()
  private acc = 1
  /** 舱段行 Actor 池（station_module 表键序） */
  private rows: Actor[] = []
  /** 舱段行 id（与 rows 平行，点击回调取用） */
  private rowIds: string[] = []

  /** 面板当前是否展开（唯一权威 = GameMode.stationSel） */
  get isOpen(): boolean {
    return wcMode()?.stationSel != null
  }

  override onStart(): void {
    const bind = (name: string, fn: () => void): void => {
      const btn = findButton(this.actor, name)
      if (btn) btn.onClick = fn
    }
    // 面板内 ✕ 关闭 = 清空 GameMode.stationSel（点空地同链路）
    bind('Btn_panel_close', () => wcMode()?.closeStationPanel())
    this.vis.set(this.actor, 'StationBody', false)
    logger.info('[StationPanelScript] 空间站舱段面板就绪（默认收起）')
  }

  override onUpdate(dt: number): void {
    const mode = wcMode()
    if (!mode) return
    this.acc += dt
    if (this.acc < 0.12) return
    this.acc = 0
    const d = mode.buildViewModel().station
    this.vis.set(this.actor, 'StationBody', !!d)
    if (!d) {
      this.syncRows([])
      return
    }
    this.binder.set(findText(this.actor, 'TitleText'), d.built ? d.name : `${d.name} · 建造中 ${d.progressPct}%`)
    this.binder.set(findText(this.actor, 'AnchorText'), d.built ? d.anchorName : '建成后方可插配舱段')
    this.binder.set(findText(this.actor, 'LayoutText'),
      d.built ? `当前布局 ${d.moduleCount} 件 · 点舱段安装/卸下（卸下免费，已装造价不返还）` : '')
    this.syncRows(d.modules)
  }

  /** 舱段行池同步（行点击 = toggle 该舱段；已装行高亮） */
  private syncRows(modules: Array<{ id: string; name: string; desc: string; cost: number; installed: boolean; canToggle: boolean }>): void {
    const world = this.world
    const list = findChild(this.actor, 'ModuleList')
    if (!world || !list) return
    while (this.rows.length < modules.length) {
      const idx = this.rows.length
      const row = world.ui.spawnUIActor(STATION_MODULE_ROW_WIDGET, list)
      if (!row) { logger.warn('[StationPanelScript] 舱段行生成失败'); break }
      const btn = findButton(row, 'Btn_row')
      if (btn) {
        btn.onClick = () => {
          const m = wcMode()
          const id = this.rowIds[idx]
          if (m?.stationSel != null && id) m.orbitBuild.toggleStationModule(m.stationSel, id)
        }
      }
      this.rows.push(row)
      this.rowIds.push('')
    }
    while (this.rows.length > modules.length) {
      const row = this.rows.pop()
      this.rowIds.pop()
      if (row) world.actorMgr.DestroyActor(row)
    }
    for (let i = 0; i < modules.length; i++) {
      const m = modules[i]
      this.rowIds[i] = m.id
      const name = findText(this.rows[i], 'RowName')
      const desc = findText(this.rows[i], 'RowDesc')
      const cost = findText(this.rows[i], 'RowCost')
      if (name) this.binder.set(name, `${m.installed ? '✔ ' : ''}${m.name}`)
      if (desc) this.binder.set(desc, m.desc)
      if (cost) this.binder.set(cost, m.installed ? '已装入（点击卸下）' : `${m.cost} H3${m.canToggle ? '' : ' · 预算不足'}`)
      this.vis.set(this.rows[i], 'Btn_row', m.canToggle)
      const color = m.installed ? ROW_INSTALLED : ROW_NORMAL
      if (this.colors.get(this.rows[i]) !== color) {
        this.colors.set(this.rows[i], color)
        const img = findChild(this.rows[i], 'Btn_row')?.getComponent(UIImageComponent)
        if (img) img.color = color
      }
    }
  }

  override onDestroy(): void {
    this.rows.length = 0
    this.rowIds.length = 0
    this.colors.clear()
  }
}
