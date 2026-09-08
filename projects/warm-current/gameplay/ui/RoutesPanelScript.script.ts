/**
 * RoutesPanelScript — 航线管理面板 widget 行为脚本（routes_panel.widget.json 根节点）
 *
 * 职责（入口按钮在主 HUD 底部 bar，本脚本只管面板本体）：
 *  - 面板内「✕ 关闭」收起（open/close 自驱动显隐，open 由 HudScript 底部入口调用）
 *  - 全航线固定 6 行差分刷新（结构上限 = 3 正向星线 + 3 反向供应线，超出走 MoreText 兜底提示）
 *  - 行按钮：派船（空闲池 +1）/ 召回（配船 −1，优先召回装货船）/ 删线（在途船就近返航卸货）
 *  - 点行名 = 选中该航线（星图高亮 + 左下选中面板联动），选中行名变金色
 * 数据全部来自 GameMode.buildViewModel().routes，0.12s 差分刷新；耀斑通讯中断期间
 * 操作按钮隐藏（权威判定在 TransportComponent.tryXxx，这里只做显隐镜像）。
 */
import { BehaviourScript, logger } from '@/engine'
import { ColorBinder, TextBinder, VisBinder, findButton, findText, wcMode } from './uiCommon'

/** 航线管理面板 widget 资产路径（HudScript 生成入口） */
export const ROUTES_PANEL_WIDGET = 'asset/blueprints/ui/routes_panel.widget.json'

/** 面板行池容量（结构上限：3 正向星线 + 3 反向供应线） */
const ROUTE_ROWS = 6

export default class RoutesPanelScript extends BehaviourScript {
  private binder = new TextBinder()
  private colors = new ColorBinder()
  private vis = new VisBinder()
  private acc = 1
  /** 行号 → 当前绑定航线 id（-1 = 空行；按钮回调经此取参，避免闭包过期） */
  private rowRouteIds: number[] = new Array(ROUTE_ROWS).fill(-1)
  /** 面板开合状态（默认收起，HudScript 底部入口读取 isOpen 决定 open/close） */
  private openState = false

  /** 面板当前是否展开（HudScript 底部入口按钮读取） */
  get isOpen(): boolean { return this.openState }

  override onStart(): void {
    if (!wcMode()) {
      logger.warn('[RoutesPanelScript] GameMode 未就绪')
    }
    const bind = (name: string, fn: () => void): void => {
      const btn = findButton(this.actor, name)
      if (btn) btn.onClick = fn
    }
    // 默认收起（脚本置位，先于首帧渲染）
    this.openState = false
    this.applyVisible()
    // 面板内 ✕ 关闭
    bind('Btn_panel_close', () => {
      this.openState = false
      this.applyVisible()
      logger.info('[RoutesPanelScript] 航线管理面板收起（面板内关闭）')
    })
    for (let i = 0; i < ROUTE_ROWS; i++) {
      bind(`Btn_add_${i}`, () => {
        const id = this.rowRouteIds[i]
        if (id >= 0) wcMode()?.transport.tryAddShip(id)
      })
      bind(`Btn_recall_${i}`, () => {
        const id = this.rowRouteIds[i]
        if (id >= 0) wcMode()?.transport.tryRemoveShip(id)
      })
      bind(`Btn_del_${i}`, () => {
        const id = this.rowRouteIds[i]
        if (id >= 0) wcMode()?.transport.tryDeleteRoute(id)
      })
      // 点行名 = 选中该航线（星图高亮 + 选中面板联动）
      bind(`Btn_name_${i}`, () => {
        const id = this.rowRouteIds[i]
        const m = wcMode()
        if (id >= 0 && m) m.selection = { type: 'route', id }
      })
    }
    logger.info('[RoutesPanelScript] 航线管理面板就绪（默认收起）')
  }

  /** 应用显隐：RoutesBody 整树开关 */
  private applyVisible(): void {
    this.vis.set(this.actor, 'RoutesBody', this.openState)
  }

  /** 打开面板（HudScript 底部入口调用） */
  open(): void {
    if (this.openState) return
    this.openState = true
    this.applyVisible()
    logger.info('[RoutesPanelScript] 航线管理面板打开')
  }

  /** 关闭面板 */
  close(): void {
    if (!this.openState) return
    this.openState = false
    this.applyVisible()
    logger.info('[RoutesPanelScript] 航线管理面板关闭')
  }

  override onUpdate(dt: number): void {
    const mode = wcMode()
    if (!mode) return
    this.acc += dt
    if (this.acc < 0.12) return
    this.acc = 0
    const vm = mode.buildViewModel()

    // 船队概况行（派船前先看空闲数）
    this.binder.set(findText(this.actor, 'FleetText'),
      `船队 ${vm.fleet.total}（空闲 ${vm.fleet.idle} · 在途 ${vm.fleet.flying} · 冻毁 ${vm.fleet.frozen}）`
      + ` · 维护 ${vm.fleet.maintPerS}/s`)

    const flare = vm.flarePhase === 'active'
    const selectedId = mode.selection?.type === 'route' ? mode.selection.id : -1
    const rows = vm.routes
    for (let i = 0; i < ROUTE_ROWS; i++) {
      const row = rows[i]
      this.rowRouteIds[i] = row ? row.id : -1
      this.vis.set(this.actor, `RouteRow_${i}`, !!row)
      if (!row) continue
      const name = findText(this.actor, `Label_name_${i}`)
      this.binder.set(name, row.name)
      this.colors.set(name, row.id === selectedId ? '#ffe9a8' : '#7fdcff')
      const netLine = row.direction === 'forward' ? `单船净 +${Math.round(row.net)}t` : `载建材 ${Math.round(row.net)}`
      this.binder.set(findText(this.actor, `RouteInfo_${i}`),
        `配船 ${row.ships} · 往返 ${row.cycle.toFixed(0)}s\n${netLine}`)
      this.vis.set(this.actor, `Btn_add_${i}`, !flare && vm.fleet.idle > 0)
      this.vis.set(this.actor, `Btn_recall_${i}`, !flare && row.ships > 0)
      this.vis.set(this.actor, `Btn_del_${i}`, !flare)
    }
    this.vis.set(this.actor, 'EmptyText', rows.length === 0)
    this.binder.set(findText(this.actor, 'MoreText'),
      rows.length > ROUTE_ROWS ? `另有 ${rows.length - ROUTE_ROWS} 条航线未显示` : '')
  }
}
