/**
 * FocusTreePanelScript — 国策树面板（节点状态着色 + 点选挂国策）
 */
import { BehaviourScript, UIButtonComponent, UIImageComponent, UITextComponent, logger, Actor } from '@/engine'
import { Hoi4PanelScript, hoi4Mode, findText, TextBinder } from './uiCommon'

const COLOR_DONE = '#55683a'
const COLOR_ACTIVE = '#7a6320'
const COLOR_AVAILABLE = '#31445c'
const COLOR_LOCKED = '#26303c'
const COLOR_AVAILABLE_HOVER = '#3d566f'

export default class FocusTreePanelScript extends Hoi4PanelScript {
  private binder = new TextBinder()
  private nodes = new Map<string, { btn: UIButtonComponent; img: UIImageComponent | null; days: UITextComponent | null }>()
  private onTick = (): void => this.refresh()
  private started = false

  override onStart(): void {
    const mode = hoi4Mode()
    if (!mode) {
      logger.warn('[FocusTreePanelScript] GameMode 未就绪')
      return
    }
    this.bindClose()
    mode.hourTickListeners.add(this.onTick)
    this.started = true
    // 收集节点（data-name = F_<focusId>）
    const walk = (a: Actor): void => {
      const name = a.root.name
      if (name.startsWith('F_')) {
        const btn = a.getComponent(UIButtonComponent)
        const img = a.getComponent(UIImageComponent)
        if (btn) {
          this.nodes.set(name.slice(2), { btn, img, days: findText(a, 'NodeDays') })
          btn.onClick = () => {
            hoi4Mode()?.cmdPickFocus(name.slice(2))
            this.refresh()
          }
        }
      }
      for (const c of a.getChildren()) walk(c)
    }
    walk(this.actor)
    this.refresh()
  }

  private refresh(): void {
    const mode = hoi4Mode()
    if (!mode?.coreState || !this.started) return
    const state = mode.coreState
    const tables = mode.getTables()
    const c = state.playerTag ? state.countries[state.playerTag] : null
    if (!c) return
    const current = c.focus.current
    const currentDef = current ? tables.focuses[current] : null
    this.binder.set(findText(this.actor, 'InfoText'), currentDef ? `当前国策：${currentDef.name} · 剩余 ${c.focus.daysLeft} 天` : '未挂国策（点击可用的节点开始）')
    for (const [id, node] of this.nodes) {
      const def = tables.focuses[id]
      if (!def) continue
      const done = c.focus.completed.includes(id)
      const active = current === id
      const excl = def.mutuallyExclusive.some((m) => c.focus.completed.includes(m))
      const prereqOk = def.prereq.every((p) => c.focus.completed.includes(p))
      const tagOk = !def.tags || def.tags.length === 0 || def.tags.includes(state.playerTag!)
      const available = !done && !active && !excl && prereqOk && tagOk && !current
      let color = COLOR_LOCKED
      if (done) color = COLOR_DONE
      else if (active) color = COLOR_ACTIVE
      else if (available) color = COLOR_AVAILABLE
      if (node.img) node.img.color = color
      const stateBtn = node.btn
      if (stateBtn) {
        // 可点集合：可用节点（点击挂上）；已完成/进行中点击无效果
        stateBtn.onClick = available
          ? () => {
              hoi4Mode()?.cmdPickFocus(id)
              this.refresh()
            }
          : () => { /* 已完成/不可用 */ }
        // hover 由 UIButton 状态机驱动（stateColors），此处不再改
        void COLOR_AVAILABLE_HOVER
      }
      if (node.days) {
        node.days.text = done ? '已完成' : active ? `剩余 ${c.focus.daysLeft} 天` : `${def.days} 天`
      }
    }
  }

  override onDestroy(): void {
    hoi4Mode()?.hourTickListeners.delete(this.onTick)
    this.nodes.clear()
  }
}
