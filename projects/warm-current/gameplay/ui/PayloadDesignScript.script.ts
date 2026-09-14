/**
 * PayloadDesignScript — 荷载设计工坊 widget 行为脚本（payload_design.widget.json 根节点）
 *
 * 职责（数据由 GameMode.payloadDesignOpen 驱动，本脚本只做差分呈现）：
 *  - 火箭设计工坊「荷载设计」按钮 → GameMode.openPayloadDesign() → vm.payloadDesign 非空 → 面板展开
 *  - 三步流（2026-09-13 火箭三部位改版：荷载单独设计，主体+附件合成一件自定义荷载）：
 *      ① 左 荷载主体（ChassisList：ship_module payloadRole='chassis' 行，单选 → mode.selectPayloadChassis）
 *      ② 中 舱内附件（AttachmentList：payloadRole='attachment' 行，多选勾选 → mode.togglePayloadAttachment）
 *      ③ 右 合成预览（SynthText：合成描述+效果+造价×组装溢价）+ 存为荷载模板 / 已存清单（载入/删除）
 *  - 保存 → GameMode.savePayloadDesign()（uid 稳定 id 入 payloadDesigns 随档走）；
 *    火箭设计工坊「荷载」槽位部位清单即可选装该合成件（占 1 荷载槽，旁路 allowed 只受槽位闸）
 *  - 删除引用保护在 GameMode（现役飞船/船型模板/当前装配引用时拒绝）
 *  - 8Hz 差分同步
 */
import { BehaviourScript, UIButtonComponent, logger } from '@/engine'
import type { Actor } from '@/engine'
import type { HudPayloadDesign } from '../base/WarmCurrentGameMode'
import { ColorBinder, TextBinder, VisBinder, findButton, findChild, findText, wcMode } from './uiCommon'
import { SHIP_MODULE_CELL_WIDGET } from './ShipyardPanelScript.script'

/** 荷载设计面板 widget 资产路径（HudScript 生成入口） */
export const PAYLOAD_DESIGN_WIDGET = 'asset/blueprints/ui/payload_design.widget.json'

export default class PayloadDesignScript extends BehaviourScript {
  private binder = new TextBinder()
  private colors = new ColorBinder()
  private vis = new VisBinder()
  private acc = 1
  /** 主体/附件/模板格 Actor 池（表键序，只增不毁） */
  private chassisCells: Actor[] = []
  private attachCells: Actor[] = []
  private designCells: Actor[] = []
  /** 格子 → 条目映射（点击闭包只持 idx，杜绝捕获陈旧 viewmodel） */
  private chassisIds: string[] = []
  private attachIds: string[] = []
  private designIdxs: number[] = []
  /** 勾选态/显隐差分（按 Actor 实例做键） */
  private checkedMap = new Map<Actor, boolean>()
  private visMap = new Map<Actor, boolean>()
  /** 附件勾选态差分键（Actor → 上次选中组合串） */
  private attachSelMap = new Map<Actor, string>()
  /** 最近载入的模板下标（删除按钮目标；null = 删最后一个） */
  private lastLoadedDesign: number | null = null

  /** 面板当前是否展开（HudScript 居中互斥读取；唯一权威 = GameMode.payloadDesignOpen） */
  get isOpen(): boolean {
    return wcMode()?.payloadDesignOpen === true
  }

  override onStart(): void {
    const bind = (name: string, fn: () => void): void => {
      const btn = findButton(this.actor, name)
      if (btn) btn.onClick = fn
    }
    bind('Btn_pd_close', () => wcMode()?.closePayloadDesign())
    bind('Btn_pd_save', () => wcMode()?.savePayloadDesign())
    // 部位页签（2026-09-14 三部位工坊：荷载/燃料/引擎统一设计流）
    bind('Btn_pd_tab_payload', () => wcMode()?.selectPayloadTab('payload'))
    bind('Btn_pd_tab_fuel', () => wcMode()?.selectPayloadTab('fuel'))
    bind('Btn_pd_tab_engine', () => wcMode()?.selectPayloadTab('engine'))
    bind('Btn_pd_ddel', () => {
      const mode = wcMode()
      if (!mode) return
      const designs = mode.simState.state.payloadDesigns
      if (designs.length === 0) return
      const idx = this.lastLoadedDesign != null && this.lastLoadedDesign < designs.length
        ? this.lastLoadedDesign
        : designs.length - 1
      mode.deletePayloadDesign(idx)
      this.lastLoadedDesign = null
    })
    // 默认收起（脚本置位，先于首帧渲染）
    this.vis.set(this.actor, 'PayloadBody', false)
    logger.info('[PayloadDesignScript] 荷载设计工坊就绪（主体+附件合成流，默认收起）')
  }

  /** 页签高亮差分键（Actor → 上次选中部位） */
  private tabSelMap = new Map<Actor, string>()

  override onUpdate(dt: number): void {
    const mode = wcMode()
    if (!mode) return
    this.acc += dt
    if (this.acc < 0.12) return
    this.acc = 0
    const vm = mode.buildViewModel().payloadDesign
    this.vis.set(this.actor, 'PayloadBody', !!vm)
    if (!vm) return

    this.binder.set(findText(this.actor, 'TitleText'), '🧩 设计工坊')
    this.binder.set(findText(this.actor, 'StatusText'),
      `已存 ${vm.designs.length} 件设计 · 火箭设计工坊对应部位槽可选装`)
    // 部位页签高亮（选中 = 名称提亮）
    const tabBtnNames: Record<string, string> = { payload: 'Btn_pd_tab_payload', fuel: 'Btn_pd_tab_fuel', engine: 'Btn_pd_tab_engine' }
    for (const tab of vm.tabs) {
      const btnActor = findChild(this.actor, tabBtnNames[tab.type] ?? '')
      if (!btnActor) continue
      const on = vm.selTab === tab.type
      if (this.tabSelMap.get(btnActor) !== (on ? '1' : '0')) {
        this.tabSelMap.set(btnActor, on ? '1' : '0')
        this.colors.set(findText(btnActor, `Label_pd_tab_${tab.type}`), on ? '#4fd8ff' : '#9fd8ef')
      }
    }
    const partName = vm.selTab === 'fuel' ? '燃料' : vm.selTab === 'engine' ? '引擎' : '荷载'
    this.binder.set(findText(this.actor, 'ChassisTitle'), `① ${partName}主体（单选）`)
    this.binder.set(findText(this.actor, 'AttachTitle'), '② 改装件（多选勾选，须契合主体）')
    this.binder.set(findText(this.actor, 'Btn_save_label'), `💾 存为${partName}模板（火箭「${partName}」槽可选装）`)
    this.syncChassisCells(vm)
    this.syncAttachmentCells(vm)
    this.binder.set(findText(this.actor, 'SynthText'), vm.synthDesc ? `${vm.synthName}\n${vm.synthDesc}\n合成造价：${vm.synthCost} H3（含组装溢价）` : `请选择${partName}主体`)
    this.syncDesignCells(vm)
  }

  /** 主体格池（单选；点击 = mode.selectPayloadChassis） */
  private syncChassisCells(vm: HudPayloadDesign): void {
    const world = this.world
    const list = findChild(this.actor, 'ChassisList')
    const mode = wcMode()
    if (!world || !list || !mode) return
    this.chassisIds = vm.chassis.map((c) => c.id)
    while (this.chassisCells.length < vm.chassis.length) {
      const idx = this.chassisCells.length
      const cell = world.ui.spawnUIActor(SHIP_MODULE_CELL_WIDGET, list)
      if (!cell) { logger.warn('[PayloadDesignScript] 主体格生成失败'); break }
      const btn = findButton(cell, 'Btn_cell')
      if (btn) btn.onClick = () => {
        const id = this.chassisIds[idx]
        if (id) mode.selectPayloadChassis(id)
      }
      this.chassisCells.push(cell)
    }
    for (let i = 0; i < this.chassisCells.length; i++) {
      const cell = this.chassisCells[i]
      const c = vm.chassis[i]
      this.setCellVisible(cell, !!c)
      if (!c) continue
      this.setCellText(cell, 'CellName', c.name)
      this.setCellText(cell, 'CellDesc', c.desc)
      this.setCellText(cell, 'CellCost', `${c.cost} H3`)
      this.setCellChecked(cell, vm.selChassis === c.id)
    }
  }

  /** 附件格池（多选勾选；点击 = mode.togglePayloadAttachment） */
  private syncAttachmentCells(vm: HudPayloadDesign): void {
    const world = this.world
    const list = findChild(this.actor, 'AttachmentList')
    const mode = wcMode()
    if (!world || !list || !mode) return
    this.attachIds = vm.attachments.map((a) => a.id)
    while (this.attachCells.length < vm.attachments.length) {
      const idx = this.attachCells.length
      const cell = world.ui.spawnUIActor(SHIP_MODULE_CELL_WIDGET, list)
      if (!cell) { logger.warn('[PayloadDesignScript] 附件格生成失败'); break }
      const btn = findButton(cell, 'Btn_cell')
      if (btn) btn.onClick = () => {
        const id = this.attachIds[idx]
        if (id) mode.togglePayloadAttachment(id)
      }
      this.attachCells.push(cell)
    }
    for (let i = 0; i < this.attachCells.length; i++) {
      const cell = this.attachCells[i]
      const a = vm.attachments[i]
      this.setCellVisible(cell, !!a)
      if (!a) continue
      this.setCellText(cell, 'CellName', a.name)
      this.setCellText(cell, 'CellDesc', a.desc)
      this.setCellText(cell, 'CellCost', `${a.cost} H3`)
      const on = vm.selAttachments.includes(a.id)
      const selKey = on ? '1' : '0'
      if (this.attachSelMap.get(cell) !== selKey) {
        this.attachSelMap.set(cell, selKey)
        // 勾选反馈 = 名称提亮（格底色编译期固化，运行时改文字色是安全口径）
        this.colors.set(findText(cell, 'CellName'), on ? '#4fd8ff' : '#bfe8ff')
      }
      this.setCellChecked(cell, on)
    }
  }

  /** 已存荷载模板格池（点击 = 载入编辑区） */
  private syncDesignCells(vm: HudPayloadDesign): void {
    const world = this.world
    const list = findChild(this.actor, 'DesignList')
    const mode = wcMode()
    if (!world || !list || !mode) return
    this.designIdxs = vm.designs.map((d) => d.idx)
    while (this.designCells.length < vm.designs.length) {
      const idx = this.designCells.length
      const cell = world.ui.spawnUIActor(SHIP_MODULE_CELL_WIDGET, list)
      if (!cell) { logger.warn('[PayloadDesignScript] 模板格生成失败'); break }
      const btn = findButton(cell, 'Btn_cell')
      if (btn) {
        btn.onClick = () => {
          const di = this.designIdxs[idx]
          if (di != null && mode.loadPayloadDesign(di)) this.lastLoadedDesign = di
        }
      }
      this.designCells.push(cell)
    }
    for (let i = 0; i < this.designCells.length; i++) {
      const cell = this.designCells[i]
      const d = vm.designs[i]
      this.setCellVisible(cell, !!d)
      if (!d) continue
      this.setCellText(cell, 'CellName', d.name)
      this.setCellText(cell, 'CellDesc', d.summary)
      this.setCellText(cell, 'CellCost', `${d.cost} H3`)
      this.setCellChecked(cell, this.lastLoadedDesign === d.idx)
    }
  }

  private setCellText(cell: Actor, name: string, text: string): void {
    const t = findText(cell, name)
    if (t) this.binder.set(t, text)
  }

  private setCellChecked(cell: Actor, on: boolean): void {
    if (this.checkedMap.get(cell) === on) return
    this.checkedMap.set(cell, on)
    const btn = findButton(cell, 'Btn_cell')
    if (btn) btn.checked = on
  }

  private setCellVisible(cell: Actor, on: boolean): void {
    if (this.visMap.get(cell) === on) return
    this.visMap.set(cell, on)
    cell.root.visible = on
  }

  override onDestroy(): void {
    this.chassisCells.length = 0
    this.attachCells.length = 0
    this.designCells.length = 0
    this.chassisIds.length = 0
    this.attachIds.length = 0
    this.designIdxs.length = 0
    this.checkedMap.clear()
    this.visMap.clear()
    this.attachSelMap.clear()
    this.tabSelMap.clear()
  }
}
