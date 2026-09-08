/**
 * BuildPanelScript — 建造面板 widget 行为脚本（build_panel.widget.json 根节点）
 *
 * 职责（入口按钮在主 HUD 底部 bar，本脚本只管面板本体）：
 *  - 面板内「✕ 关闭」收起（open/close 自驱动显隐，open 由 HudScript 底部入口调用）
 *  - 建筑行固定行池（BUILD_ROWS 行，building.table.json 表驱动，行序 = B.buildings 键序）：
 *    行文案（名称/说明/造价）+「放置」按钮（进建筑模式，面板随之收起让星图可见）
 *  - 8Hz 差分同步：行文案/按钮可用性 + 放置模式提示行
 */
import { BehaviourScript, logger } from '@/engine'
import { ColorBinder, TextBinder, VisBinder, findButton, findText, wcMode } from './uiCommon'

/** 建造面板 widget 资产路径（HudScript 生成入口） */
export const BUILD_PANEL_WIDGET = 'asset/blueprints/ui/build_panel.widget.json'

/** 行池容量（超出 table 行数的建筑不显示，另见 ModeText 提示） */
const BUILD_ROWS = 4

export default class BuildPanelScript extends BehaviourScript {
  private binder = new TextBinder()
  private colors = new ColorBinder()
  private vis = new VisBinder()
  private acc = 1
  /** 行号 → 当前绑定建筑类型 id（'' = 空行；按钮回调经此取参，避免闭包过期） */
  private rowTypeIds: string[] = new Array(BUILD_ROWS).fill('')
  /** 面板开合状态（默认收起，HudScript 底部入口读取 isOpen 决定 open/close） */
  private openState = false

  /** 面板当前是否展开（HudScript 底部入口按钮读取） */
  get isOpen(): boolean { return this.openState }

  override onStart(): void {
    const bind = (name: string, fn: () => void): void => {
      const btn = findButton(this.actor, name)
      if (btn) btn.onClick = fn
    }
    // 默认收起（脚本置位 + seed json 双保险）
    this.openState = false
    this.applyVisible()
    // 面板内 ✕ 关闭
    bind('Btn_panel_close', () => {
      this.openState = false
      this.applyVisible()
      logger.info('[BuildPanelScript] 建造面板收起（面板内关闭）')
    })
    // 行「放置」按钮：进入建筑模式（成功即收起面板，星图网格放置接管）
    for (let i = 0; i < BUILD_ROWS; i++) {
      bind(`Btn_place_${i}`, () => {
        const typeId = this.rowTypeIds[i]
        if (!typeId) return
        const mode = wcMode()
        if (mode?.enterBuildMode(typeId)) this.close()
      })
    }
    this.syncNow()
    logger.info('[BuildPanelScript] 建造面板就绪（表驱动建筑行，默认收起）')
  }

  /** 应用显隐：BuildBody 整树开关 */
  private applyVisible(): void {
    this.vis.set(this.actor, 'BuildBody', this.openState)
  }

  /** 打开面板（HudScript 底部入口调用） */
  open(): void {
    if (this.openState) return
    this.openState = true
    this.applyVisible()
    logger.info('[BuildPanelScript] 建造面板打开')
  }

  /** 关闭面板（进入放置模式时也走这里） */
  close(): void {
    if (!this.openState) return
    this.openState = false
    this.applyVisible()
    logger.info('[BuildPanelScript] 建造面板关闭')
  }

  override onUpdate(dt: number): void {
    this.acc += dt
    if (this.acc < 0.12) return
    this.acc = 0
    this.syncNow()
  }

  /** 行文案 + 按钮可用性差分同步（口径与 BuildingsComponent.placementIssue/VM 一致） */
  private syncNow(): void {
    const mode = wcMode()
    if (!mode) return
    const vm = mode.buildViewModel()
    const rows = vm.buildRows
    for (let i = 0; i < BUILD_ROWS; i++) {
      const row = rows[i]
      this.rowTypeIds[i] = row?.id ?? ''
      this.vis.set(this.actor, `BuildRow_${i}`, !!row)
      if (!row) continue
      this.binder.set(findText(this.actor, `RowInfo_${i}`),
        `${row.name} · ${row.cost} H3\n${row.desc}${row.canPlace ? '' : ' · 暂不可放置'}`)
      this.vis.set(this.actor, `Btn_place_${i}`, row.canPlace)
    }
    // 放置模式提示行（面板收起时不可见，仅重开面板时能看到当前选型）
    const activeIdx = rows.findIndex((r) => r.id === vm.buildActive)
    this.binder.set(findText(this.actor, 'ModeText'),
      vm.buildActive ? `放置模式：${rows[activeIdx]?.name ?? vm.buildActive} —— 点击星图落位，Esc 取消` : '')
  }
}
