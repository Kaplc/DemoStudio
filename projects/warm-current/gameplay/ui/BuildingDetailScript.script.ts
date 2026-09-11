/**
 * BuildingDetailScript — 建筑详情浮层行为脚本（building_detail.widget.json 根节点）
 *
 * 职责（玩家设计权扩展：建筑强化一槽二选一装拆流）：
 *  - 点地图建筑 → GameMode.openBuildingDetail(id)（同时保留旧选中口径）→ vm.buildingDetail 非空 → 展开
 *  - 面板内 ✕ / 点空地 → GameMode.closeBuildingDetail() → 收起
 *  - 强化分支行（BranchList 动态生成 building_branch_row，building 表 upgrades 键序）：
 *      显示各分支效果 + 造价，点击安装（即时扣费即时生效；已装同支 = hint，换支先拆）
 *  - 拆强化：拆除费 = 分支造价 × upgradeDemolishCostPct，不返还（拆除返还公式经 invested 自动折算）
 *  - 拆除建筑：沿用 BuildingsComponent.tryDemolish（返还按投入折算）
 *  - 8Hz 差分同步；建筑被拆 → vm null → 收起
 */
import { BehaviourScript, UIImageComponent, logger } from '@/engine'
import type { Actor } from '@/engine'
import { TextBinder, VisBinder, findButton, findChild, findText, wcMode } from './uiCommon'

/** 建筑详情浮层 widget 资产路径（HudScript 生成入口） */
export const BUILDING_DETAIL_WIDGET = 'asset/blueprints/ui/building_detail.widget.json'
/** 强化分支行子 widget 资产路径（动态生成） */
export const BUILDING_BRANCH_ROW_WIDGET = 'asset/blueprints/ui/building_branch_row.widget.json'

/** 分支行常态/已装底色 */
const ROW_NORMAL = '#1d3a52'
const ROW_INSTALLED = '#3a5a2a'

export default class BuildingDetailScript extends BehaviourScript {
  private binder = new TextBinder()
  private colors = new Map<Actor, string>()
  private vis = new VisBinder()
  private acc = 1
  /** 分支行 Actor 池（building 表 upgrades 键序） */
  private rows: Actor[] = []
  /** 分支行 id（与 rows 平行，点击回调取用） */
  private rowIds: string[] = []

  /** 面板当前是否展开（唯一权威 = GameMode.buildingDetailSel） */
  get isOpen(): boolean {
    return wcMode()?.buildingDetailSel != null
  }

  override onStart(): void {
    const bind = (name: string, fn: () => void): void => {
      const btn = findButton(this.actor, name)
      if (btn) btn.onClick = fn
    }
    bind('Btn_bd_close', () => wcMode()?.closeBuildingDetail())
    bind('Btn_bd_remove', () => {
      const mode = wcMode()
      if (mode?.buildingDetailSel != null) mode.buildings.tryRemoveUpgrade(mode.buildingDetailSel)
    })
    bind('Btn_bd_demolish', () => {
      const mode = wcMode()
      if (mode?.buildingDetailSel != null) mode.buildings.tryDemolish(mode.buildingDetailSel)
    })
    this.vis.set(this.actor, 'Panel', false)
    logger.info('[BuildingDetailScript] 建筑详情浮层就绪（默认收起）')
  }

  override onUpdate(dt: number): void {
    const mode = wcMode()
    if (!mode) return
    this.acc += dt
    if (this.acc < 0.12) return
    this.acc = 0
    const d = mode.buildViewModel().buildingDetail
    this.vis.set(this.actor, 'Panel', !!d)
    if (!d) {
      this.syncRows([])
      return
    }
    this.binder.set(findText(this.actor, 'TitleText'), `${d.name} ${d.id}`)
    const stat = d.bufferCap > 0
      ? `缓存 ${d.stock}/${d.bufferCap} · 航线可链接`
      : `护盾半径 ${d.radius.toFixed(0)} · 保全容量 ${d.cap} 艘 · 耀斑罩内保全`
    this.binder.set(findText(this.actor, 'StatText'), stat + (d.upgrade ? `\n已装强化：${d.upgrade.name}（${d.upgrade.desc}）` : '\n未强化'))
    this.syncRows(d.branches)
    const hasUp = !!d.upgrade
    this.vis.set(this.actor, 'Btn_bd_remove', hasUp && d.canDemolish)
    this.binder.set(findText(this.actor, 'RemoveText'), hasUp ? `拆强化费 ${d.removeFee} H3（不返还）` : '')
    this.vis.set(this.actor, 'Btn_bd_demolish', d.canDemolish)
    this.binder.set(findText(this.actor, 'DemolishLabel'), '拆除建筑（按投入返还）')
  }

  /** 分支行池同步（行点击 = 安装该分支；已装分支行高亮） */
  private syncRows(branches: Array<{ id: string; name: string; desc: string; cost: number; installed: boolean; canInstall: boolean }>): void {
    const world = this.world
    const list = findChild(this.actor, 'BranchList')
    if (!world || !list) return
    while (this.rows.length < branches.length) {
      const idx = this.rows.length
      const row = world.ui.spawnUIActor(BUILDING_BRANCH_ROW_WIDGET, list)
      if (!row) { logger.warn('[BuildingDetailScript] 强化分支行生成失败'); break }
      const btn = findButton(row, 'Btn_row')
      if (btn) {
        btn.onClick = () => {
          const m = wcMode()
          const id = this.rowIds[idx]
          if (m && m.buildingDetailSel != null && id) m.buildings.tryInstallUpgrade(m.buildingDetailSel, id)
        }
      }
      this.rows.push(row)
      this.rowIds.push('')
    }
    while (this.rows.length > branches.length) {
      const row = this.rows.pop()
      this.rowIds.pop()
      if (row) world.actorMgr.DestroyActor(row)
    }
    for (let i = 0; i < branches.length; i++) {
      const b = branches[i]
      this.rowIds[i] = b.id
      const name = findText(this.rows[i], 'RowName')
      const desc = findText(this.rows[i], 'RowDesc')
      const cost = findText(this.rows[i], 'RowCost')
      if (name) this.binder.set(name, `${b.installed ? '✔ ' : ''}${b.name}`)
      if (desc) this.binder.set(desc, b.desc)
      if (cost) this.binder.set(cost, b.installed ? '已装入' : `${b.cost} H3${b.canInstall ? '' : ' · 预算不足'}`)
      const color = b.installed ? ROW_INSTALLED : ROW_NORMAL
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
