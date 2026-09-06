/**
 * CountrySelectScript — 开局选国面板
 */
import { BehaviourScript, UIImageComponent, UILayoutComponent, logger, ActorComponent } from '@/engine'
import { hoi4Mode, findButton, findText } from './uiCommon'

const ROW_WIDGET = 'asset/blueprints/ui/country_row.widget.json'

export default class CountrySelectScript extends BehaviourScript {
  private built = false
  private rows: Array<{ tag: string; btn: import('@/engine').UIButtonComponent; swatch: UIImageComponent | null }> = []

  override onStart(): void {
    const mode = hoi4Mode()
    if (!mode) return
    // 关闭按钮：只关面板（TopBar 尊重 dismissed 标记不再自动弹）
    const close = findButton(this.actor, 'Btn_close')
    if (close) {
      close.onClick = () => {
        const m = hoi4Mode()
        if (m) m.countrySelectDismissed = true
        this.world?.ui.destroyUIActor(this.actor)
      }
    }
  }

  /** 面板每次变为可见时重建行（onUpdate 里由 TopBar 显示；此处延迟到首帧可见后构建） */
  override onUpdate(): void {
    if (this.built) return
    const mode = hoi4Mode()
    if (!mode?.bootedFlag) return
    const state = mode.coreState
    const tables = mode.getTables()
    const list = this.findInChildren('CountryList')
    if (!state || !list) return
    this.built = true
    for (const tag of Object.keys(tables.countries)) {
      const def = tables.countries[tag]
      const row = this.world?.ui.spawnUIActor(ROW_WIDGET, list)
      if (!row) continue
      const name = findText(row, 'NameText')
      if (name) name.text = def.name
      const info = findText(row, 'InfoText')
      if (info) {
        const states = mode.map.statesOfTag(tag).length
        const vp = mode.map.statesOfTag(tag).reduce((s, st) => s + st.vp, 0)
        info.text = `${tag} · ${states}州 · 胜利点${vp} · ${ideologyName(def.ideology)}`
      }
      const swatch = findChildComp(row, 'Swatch', UIImageComponent)
      const btn = findButton(row, 'Btn_pick')
      if (swatch) swatch.color = def.color
      if (btn) {
        btn.onClick = () => {
          const m = hoi4Mode()
          if (!m) return
          m.cmdSelectCountry(tag)
          m.setPaused(false)
          logger.info(`[CountrySelect] 选择国家 ${tag}`)
        }
        this.rows.push({ tag, btn, swatch })
      }
    }
    list.getComponent(UILayoutComponent)?.layout()
  }

  override onDestroy(): void {
    this.rows = []
  }
}

function ideologyName(i: string): string {
  return i === 'democratic' ? '民主' : i === 'communist' ? '共产' : i === 'fascist' ? '极端' : '中立'
}

function findChildComp<T extends import('@/engine').ActorComponent>(root: import('@/engine').Actor | null, name: string, cls: new (...args: any[]) => T): T | null {
  const walk = (a: import('@/engine').Actor): T | null => {
    for (const c of a.getChildren()) {
      if (c.root.name === name) return c.getComponent(cls)
      const hit = walk(c)
      if (hit) return hit
    }
    return null
  }
  return root ? walk(root) : null
}
