/**
 * ProvincePanelScript — 省信息侧栏（选中省数据 + 驻扎师列表 + 部署入口）
 */
import { BehaviourScript, UIButtonComponent, UITextComponent, logger, UILayoutComponent } from '@/engine'
import { hoi4Mode, findButton, findText, TextBinder } from './uiCommon'
import { divisionMaxOrg } from '../core/Combat'

const DIV_ROW_WIDGET = 'asset/blueprints/ui/division_row.widget.json'

export default class ProvincePanelScript extends BehaviourScript {
  private binder = new TextBinder()
  /** 已生成的师行（pid → rows） */
  private rows: Array<{ actor: import('@/engine').Actor; divId: string; name: UITextComponent | null; org: UITextComponent | null }> = []
  private builtForPid: number | null = null
  private onSelect = () => this.refresh(true)
  private onTick = () => this.refresh(false)

  override onStart(): void {
    const mode = hoi4Mode()
    if (!mode) {
      logger.warn('[ProvincePanelScript] GameMode 未就绪')
      return
    }
    mode.selectionListeners.add(this.onSelect)
    mode.hourTickListeners.add(this.onTick)
    // 关闭按钮：置 dismissed 标记（TopBar 不再自动弹出），取消选中并自毁；点地图选新省时重新打开
    const closeBtn = findButton(this.actor, 'Btn_close')
    if (closeBtn) {
      closeBtn.onClick = () => {
        const m = hoi4Mode()
        if (!m) return
        m.provincePanelDismissed = true
        this.world?.ui.destroyUIActor(this.actor)
        m.clearSelection()
      }
    }
    const deployBtn = findButton(this.actor, 'Btn_deploy')
    if (deployBtn) {
      deployBtn.onClick = () => {
        const m = hoi4Mode()
        if (!m?.coreState?.playerTag) return
        if (m.selectedProvince === null) return
        m.cmdSetDeployArmed(!m.deployArmed)
      }
    }
    mode.onDeployArmedChange = (armed) => this.binder.set(findText(this.actor, 'HintText'), armed ? '部署模式：点击一个己方省落下师' : '')
  }

  /** 重建师行（省切换时）；刷新数值（每 tick） */
  private refresh(rebuild: boolean): void {
    const mode = hoi4Mode()
    if (!mode?.coreState || !this.actor) return
    const state = mode.coreState
    const tables = mode.getTables()
    const pid = mode.selectedProvince
    this.binder.set(findText(this.actor, 'Title'), pid === null ? '未选中省份' : `省份 #${pid}`)

    if (pid === null) {
      this.binder.set(findText(this.actor, 'InfoText'), '点击地图上的省份查看详情')
      this.clearRows()
      return
    }
    const p = mode.map.province(pid)
    const st = mode.map.stateOfProvince(pid)
    const ctrl = state.provinceControl[pid]
    const ctrlName = ctrl ? tables.countries[ctrl]?.name ?? ctrl : '无主'
    const ownerName = st ? tables.countries[st.owner]?.name ?? st.owner : '-'
    const terrain = tables.terrains[p?.terrain ?? 'plains']
    if (rebuild || this.builtForPid !== pid) {
      this.builtForPid = pid
      this.clearRows()
      const list = this.findInChildren('DivList')
      if (list) {
        for (const d of Object.values(state.divisions)) {
          if (d.province !== pid) continue
          const row = this.world?.ui.spawnUIActor(DIV_ROW_WIDGET, list)
          if (!row) continue
          row.root.name = `DivRow_${d.id}`
          const nameT = findText(row, 'NameText')
          const orgT = findText(row, 'OrgText')
          // 整行按钮化选择：点行 = 切换选中（行根也是 button? 行是 div——挂按钮行为不可；
          // 用点击整行走 UIButtonComponent：division_row 根无按钮，改为点击行根不做，
          // 行内提供选择 via name text? MVP：点行根无响应，选中由省面板自动全选该省师。
          this.rows.push({ actor: row, divId: String(d.id), name: nameT, org: orgT })
        }
        list.getComponent(UILayoutComponent)?.layout()
      }
    }
    const info: string[] = []
    info.push(`地形：${terrain?.name ?? p?.terrain ?? '-'}（防御×${terrain?.defMod?.toFixed(1) ?? 1}）`)
    info.push(`核心归属：${ownerName}${ctrl !== st?.owner ? `（被 ${ctrlName} 占领）` : ''}`)
    if (st) {
      info.push(`州：${st.name} · 人口 ${st.pop} · 胜利点 ${st.vp}`)
      info.push(`建筑位 ${st.slots} · 钢 ${st.steel} · 油 ${st.oil}`)
    }
    if (p?.coastal) info.push('沿海省份')
    this.binder.set(findText(this.actor, 'InfoText'), info.join('\n'))

    // 师行数值
    for (const r of this.rows) {
      const d = state.divisions[r.divId]
      if (!d) continue
      const maxOrg = divisionMaxOrg(d, tables, state.countries[d.owner]?.modifiers, state.countries[d.owner]?.customTemplates)
      if (r.name) r.name.text = `${d.name}${d.battle !== 0 ? ' ⚔' : ''}${!d.supplied ? ' ⛌补给' : ''}`
      if (r.org) r.org.text = `组织 ${d.org.toFixed(0)}/${maxOrg} · 兵力 ${(d.strength * 100).toFixed(0)}%`
    }

    // 部署按钮文案
    const c = state.playerTag ? state.countries[state.playerTag] : null
    const pool = c?.deployPool.length ?? 0
    this.binder.set(findText(this.actor, 'HintText'), mode.deployArmed ? '部署模式：点击一个己方省落下师' : '')
    const deployText = findText(this.actor, 'Label_deploy')
    if (deployText) {
      deployText.text = pool > 0 ? `部署一个师到此省（待部署 ${pool}）` : '无待部署师'
    }
    const deployBtn = findButton(this.actor, 'Btn_deploy')
    if (deployBtn) deployBtn.onClick = () => {
      const m = hoi4Mode()
      if (!m?.coreState?.playerTag) return
      m.cmdSetDeployArmed(!m.deployArmed)
    }
  }

  private clearRows(): void {
    for (const r of this.rows) this.world?.ui.destroyUIActor(r.actor)
    this.rows = []
    this.builtForPid = null
  }

  override onDestroy(): void {
    const mode = hoi4Mode()
    mode?.selectionListeners.delete(this.onSelect)
    mode?.hourTickListeners.delete(this.onTick)
    this.clearRows()
  }
}
