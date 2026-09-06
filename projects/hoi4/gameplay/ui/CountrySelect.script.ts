/**
 * CountrySelectScript — 开局选国面板
 *
 * 列表用 UIScrollList 对象池（itemWidget=country_row）：171 国按“10 个 playtag 在前
 * + 其余按人力降序”排序，totalCount 驱动池化生成，onItemSpawned 回调填充内容。
 */
import { BehaviourScript, UIScrollListComponent, UIImageComponent, logger, ActorComponent } from '@/engine'
import { hoi4Mode, findButton, findText } from './uiCommon'

const ROW_WIDGET = 'asset/blueprints/ui/country_row.widget.json'
const PLAYTAGS = ['GER', 'FRA', 'ENG', 'ITA', 'POL', 'SOV', 'HUN', 'ROM', 'YUG', 'SWI']

export default class CountrySelectScript extends BehaviourScript {
  private built = false
  private ordered: string[] = []

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
    const tables = mode.getTables()
    const list = this.findInChildren('CountryList')
    if (!tables || !list) return
    const listComp = list.getComponent(UIScrollListComponent)
    if (!listComp) return
    this.built = true
    this.ordered = Object.keys(tables.countries).sort((a, b) => {
      const pa = PLAYTAGS.indexOf(a), pb = PLAYTAGS.indexOf(b)
      if (pa >= 0 || pb >= 0) return (pa >= 0 ? pa : 99) - (pb >= 0 ? pb : 99)
      return (tables.countries[b].manpower ?? 0) - (tables.countries[a].manpower ?? 0)
    })
    listComp.onItemSpawned = (row, idx) => {
      const tag = this.ordered[idx]
      if (!tag) return
      const def = tables.countries[tag]
      const name = findText(row, 'NameText')
      if (name) name.text = def.name
      const info = findText(row, 'InfoText')
      if (info) {
        const states = mode.map.statesOfTag(tag).length
        const vp = mode.map.statesOfTag(tag).reduce((s, st) => s + st.vp, 0)
        info.text = `${tag} · ${states}州 · 胜利点${vp} · ${ideologyName(def.ideology)}`
      }
      const swatch = findChildComp(row, 'Swatch', UIImageComponent)
      if (swatch) swatch.color = def.color
      const btn = findButton(row, 'Btn_pick')
      if (btn) {
        btn.onClick = () => {
          const m = hoi4Mode()
          if (!m) return
          m.cmdSelectCountry(tag)
          m.setPaused(false)
          logger.info(`[CountrySelect] 选择国家 ${tag}`)
        }
      }
    }
    listComp.totalCount = this.ordered.length
  }

  override onDestroy(): void {
    this.ordered = []
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
