/**
 * RingPanelScript — 聚能环详情面板行为脚本（ring_panel.widget.json 根节点）
 *
 * 2026-09-11 槽位化改版（方案 V1：25 级 = 25 环段槽位）：
 *  - 25 段槽位图（SlotStrip 动态生成 ring_slot_cell，5×5）：暗=未建成、蓝=当前建设格、
 *    橙=已建成空槽、亮橙=已装建筑、红=拆除中目标格；点格选中查看/安装
 *  - 安装流：选中已建成空槽 → InstallList 按 ring_building 表生成安装行（点击即扣）
 *  - 拆除流：选中已装槽 → 拆除按钮（费用 = 造价×demolishCostPct，走建设泵反向灌入）；
 *    泵目标切换：点建设格回灌建设、点拆除格续拆（双侧进度保留）
 *  - 升级瞬间：slot_built 事件 toast 由 GameMode 发；面板对应格状态色即闪现
 * 数据全部来自 GameMode.buildViewModel()，0.15s 差分刷新。
 */
import { BehaviourScript, UIButtonComponent, UIImageComponent, UIProgressBarComponent, logger } from '@/engine'
import type { Actor } from '@/engine'
import { B, ringBuildingDefOf } from '../core/balance'
import { ColorBinder, TextBinder, VisBinder, findButton, findChild, findText, wcMode } from './uiCommon'

/** 聚能环面板 widget 资产路径（HudScript spawn 用） */
export const RING_PANEL_WIDGET = 'asset/blueprints/ui/ring_panel.widget.json'
/** 槽位格子 / 安装行子 widget 资产路径（动态生成） */
export const RING_SLOT_CELL_WIDGET = 'asset/blueprints/ui/ring_slot_cell.widget.json'
export const RING_INSTALL_ROW_WIDGET = 'asset/blueprints/ui/ring_install_row.widget.json'

const STATE_RUNNING_COLOR = '#ffb03d'
const STATE_COOLING_COLOR = '#ff5a4a'
const STATE_DONE_COLOR = '#43d17c'
const WARN_COLOR = '#ff5a4a'
const IDLE_COLOR = '#9fc4d8'
const CORE_FILL_WARM = '#ffb03d'
const CORE_FILL_COOL = '#ff5a4a'
const LEVEL_COLOR = '#ffb03d'

/** 槽位格状态色（暗=未建成 / 蓝=当前建设格 / 橙=建成空槽 / 亮橙=已装 / 红=拆除中） */
const CELL_UNBUILT = '#22303c'
const CELL_BUILDING = '#1d4a66'
const CELL_EMPTY = '#8a5a34'
const CELL_INSTALLED = '#ffb03d'
const CELL_DEMOLISH = '#7a2e2e'
const CELL_NUM_UNBUILT = '#5a707f'
const CELL_NUM_BUILT = '#ffe9a8'

export default class RingPanelScript extends BehaviourScript {
  private binder = new TextBinder()
  private colors = new ColorBinder()
  private vis = new VisBinder()
  private acc = 0.15
  /** 面板开合状态（默认收起，HudScript 底部入口读取 isOpen 决定 open/close） */
  private openState = false
  /** 当前选中槽位（-1 = 未选；点格选中，安装/拆除按它走） */
  private selectedSlot = -1
  /** 槽位格 Actor 池（与 25 格一一对应） */
  private cells: Actor[] = []
  /** 安装行 Actor 池（ring_building 表键序） */
  private installRows: Actor[] = []
  /** 安装行 id（与 installRows 平行，点击回调取用） */
  private installIds: string[] = []

  /** 面板当前是否展开（HudScript 底部入口按钮读取） */
  get isOpen(): boolean { return this.openState }

  override onStart(): void {
    const mode = wcMode()
    if (!mode) logger.warn('[RingPanelScript] GameMode 未就绪')
    // 默认收起（脚本置位 + 编译产物默认态双保险）
    this.openState = false
    this.applyVisible()
    const bind = (name: string, fn: () => void): void => {
      const btn = findButton(this.actor, name)
      if (btn) btn.onClick = fn
    }
    // 面板内 ✕ 关闭（对齐 ResearchPanel 惯例）
    bind('Btn_panel_close', () => {
      this.openState = false
      this.applyVisible()
      logger.info('[RingPanelScript] 聚能环详情面板收起（面板内关闭）')
    })
    // 建设点数 +/−（min 封底由组件内 hint 提示）
    bind('Btn_build_inc', () => wcMode()?.ringBuild.allocateBuildPoints(1))
    bind('Btn_build_dec', () => wcMode()?.ringBuild.allocateBuildPoints(-1))
    // 拆除按钮：对当前选中已装槽发起/续拆（费用走建设泵反向灌入）
    bind('Btn_slot_demo', () => {
      const m = wcMode()
      if (!m || this.selectedSlot < 0) return
      m.ringBuild.startDemolish(this.selectedSlot)
    })
    logger.info('[RingPanelScript] 聚能环详情面板就绪（25 槽位图，默认收起）')
  }

  /** 应用显隐：Panel 整树开关 */
  private applyVisible(): void {
    this.vis.set(this.actor, 'Panel', this.openState)
  }

  /** 打开面板（HudScript 底部入口调用） */
  open(): void {
    if (this.openState) return
    this.openState = true
    this.applyVisible()
    logger.info('[RingPanelScript] 聚能环详情面板打开')
  }

  /** 关闭面板 */
  close(): void {
    if (!this.openState) return
    this.openState = false
    this.applyVisible()
    logger.info('[RingPanelScript] 聚能环详情面板关闭')
  }

  override onUpdate(dt: number): void {
    this.acc += dt
    if (this.acc < 0.15) return
    this.acc = 0
    this.refresh()
  }

  /** 差分刷新面板各字段（仅变化才写组件） */
  private refresh(): void {
    const mode = wcMode()
    if (!mode) return
    const vm = mode.buildViewModel()

    // ─── 状态徽标：运转 / 降温 / 已建成（25 环段闭环） ───
    const stateText = findText(this.actor, 'StateText')
    if (vm.coreState === 'cooling') {
      this.binder.set(stateText, '降温中')
      this.colors.set(stateText, STATE_COOLING_COLOR)
    } else if (vm.ringLevel.maxed) {
      this.binder.set(stateText, '已建成')
      this.colors.set(stateText, STATE_DONE_COLOR)
    } else {
      this.binder.set(stateText, '运转中')
      this.colors.set(stateText, STATE_RUNNING_COLOR)
    }

    // ─── 等级行：聚能环等级 Lv/25 + 全球覆盖度 ───
    const lv = vm.ringLevel
    const levelText = findText(this.actor, 'LevelText')
    const coverage = `${Math.round(lv.coverage * 100)}%`
    if (lv.maxed) {
      this.binder.set(levelText, `全球组网 ${coverage}`)
      this.colors.set(levelText, STATE_DONE_COLOR)
    } else {
      this.binder.set(levelText, `${lv.name}/${lv.maxLevel} 覆盖${coverage}`)
      this.colors.set(levelText, LEVEL_COLOR)
    }
    this.setProgress('LevelBar', lv.progress, 1)

    // ─── 槽位行（25 槽位制物理口径） ───
    this.binder.set(findText(this.actor, 'SlotsText'), `环段 ${vm.ringSlots}/${vm.ringSlotsTotal}`)
    this.setProgress('SlotsBar', vm.ringSlots, vm.ringSlotsTotal)

    // ─── 25 段槽位图（状态色逐格刷） ───
    this.syncCells(vm)
    // 选中格高亮由文本标记（▸ 前缀）承担，避免引依赖状态机样式

    // ─── 建设控制区：当前格建设进度 + 点数 +/− + 计费速率 ───
    this.binder.set(findText(this.actor, 'BuildText'), `建设 ${(vm.ringBuildProgress * 100).toFixed(0)}%`)
    this.setProgress('BuildBar', vm.ringBuildProgress, 1)
    const pts = findText(this.actor, 'BuildPtsText')
    this.binder.set(pts, `建设 ${vm.ringBuildPoints} 点`)
    this.colors.set(pts, vm.ringBuildPoints <= vm.ringBuildMin ? IDLE_COLOR : '#ffe9a8')
    const cost = findText(this.actor, 'BuildCostText')
    this.binder.set(cost, `${vm.ringBuildCost.toFixed(1)}/s · ${vm.ringBuildRate > 0 ? `${(vm.ringBuildRate * 100).toFixed(1)}%/s` : '停建'}`)
    this.colors.set(cost, vm.ringBuildRate > 0 ? '#7fdcff' : WARN_COLOR)

    // ─── 选中格详情 + 安装/拆除流 ───
    this.refreshDetail(vm)

    // ─── 堆心温度（0-100%）：满温运转，断环缓降，归零 = 堆心熄灭 = 终结 ───
    const temp = Math.max(0, Math.min(100, vm.coreTemp))
    const tempText = findText(this.actor, 'CoreText')
    this.binder.set(tempText, `堆心温度 ${temp.toFixed(0)}%`)
    this.colors.set(tempText, vm.coreState === 'cooling' ? STATE_COOLING_COLOR : '#ffe9a8')
    this.setProgress('CoreBar', temp, 100)
    const coreFill = findChild(this.actor, 'CoreBar')?.getChildren().find((c) => c.root.name === 'CoreFill')
    const coreImg = coreFill?.getComponent(UIImageComponent)
    if (coreImg) {
      const c = vm.coreState === 'cooling' ? CORE_FILL_COOL : CORE_FILL_WARM
      if (coreImg.color !== c) coreImg.color = c
    }

    // ─── 堆心状态行：升温中/降温中 + 预计抵达满温/熄灭的秒数（蓄热井乘区含在内） ───
    const ring = vm.ringMods
    const rate = vm.coreState === 'cooling'
      ? 100 / Math.max(1, B.coreCoolSeconds * ring.coolTimeMult)
      : 100 / Math.max(1, B.coreWarmSeconds * ring.warmTimeMult)
    const remain = vm.coreState === 'cooling' ? temp / rate : (100 - temp) / rate
    const stateLine = findText(this.actor, 'CoreStateText')
    this.binder.set(stateLine, vm.coreState === 'cooling'
      ? `降温中 · ${remain.toFixed(0)}s 后熄灭`
      : temp >= 100 ? '满温运转' : `升温中 · ${remain.toFixed(0)}s 后满温`)
    this.colors.set(stateLine, vm.coreState === 'cooling' ? WARN_COLOR : '#ffe9a8')

    // ─── 净流 / 需求-储量 ───
    const flow = vm.netFlow
    this.binder.set(findText(this.actor, 'FlowText'),
      `净流 ${flow >= 0 ? '+' : ''}${flow.toFixed(1)}/s`)
    this.colors.set(findText(this.actor, 'FlowText'), flow >= 0 ? '#ffe9a8' : WARN_COLOR)
    this.binder.set(findText(this.actor, 'DemandText'),
      `需求 ${vm.demand.toFixed(1)} t/s · 储量 ${Math.floor(vm.reserve)} t`)

    // ─── 危险警示（储量低于危险阈值） ───
    const warn = findText(this.actor, 'WarnText')
    this.vis.set(this.actor, 'WarnText', vm.danger)
    if (vm.danger) {
      this.binder.set(warn, '⚠ 储量不足，聚能环濒临断环')
      this.colors.set(warn, WARN_COLOR)
    } else {
      this.binder.set(warn, '')
      this.colors.set(warn, IDLE_COLOR)
    }
  }

  /** 25 槽位格池同步 + 状态色刷新 */
  private syncCells(vm: {
    ringSlots: number
    ringSlotsTotal: number
    ringBuildings: (string | null)[]
    ringDemolish: { slot: number; progress: number; active: boolean } | null
  }): void {
    const total = Math.max(1, vm.ringSlotsTotal)
    // 池容量对齐（槽位总数表驱动；运行时收缩罕见，防御性重建）
    while (this.cells.length < total) {
      const world = this.world
      const strip = findChild(this.actor, 'SlotStrip')
      if (!world || !strip) break
      const cell = world.ui.spawnUIActor(RING_SLOT_CELL_WIDGET, strip)
      if (!cell) { logger.warn('[RingPanelScript] 槽位格生成失败'); break }
      const idx = this.cells.length
      const btn = findButton(cell, 'Btn_cell')
      if (btn) {
        btn.onClick = () => this.onCellClick(idx)
      }
      const num = findText(cell, 'CellNum')
      if (num) num.text = String(idx + 1)
      this.cells.push(cell)
    }
    for (let i = 0; i < this.cells.length; i++) {
      const built = i < vm.ringSlots
      const installed = vm.ringBuildings[i] ?? null
      const demolishing = vm.ringDemolish?.active && vm.ringDemolish.slot === i
      const fill = findChild(this.cells[i], 'CellFill')?.getComponent(UIImageComponent)
      const color = !built ? CELL_UNBUILT
        : demolishing ? CELL_DEMOLISH
        : installed ? CELL_INSTALLED
        : CELL_EMPTY
      if (fill && fill.color !== color) fill.color = color
      const num = findText(this.cells[i], 'CellNum')
      if (num) {
        const text = (i === this.selectedSlot ? '▸' : '') + String(i + 1) + (installed ? '◆' : '')
        if (num.text !== text) num.text = text
        const tc = !built ? CELL_NUM_UNBUILT : CELL_NUM_BUILT
        this.colors.set(num, tc)
      }
    }
  }

  /** 点槽位格：选中查看；泵目标切换（点建设格回灌建设 / 点拆除格续拆） */
  private onCellClick(idx: number): void {
    const mode = wcMode()
    if (!mode) return
    this.selectedSlot = idx
    const vm = mode.buildViewModel()
    if (vm.ringDemolish) {
      // 同一时刻泵只灌一个目标：点拆除格 = 续拆，点其它格 = 回灌建设（进度保留）
      mode.ringBuild.setDemolishActive(vm.ringDemolish.slot === idx)
    }
  }

  /** 详情区刷新：选中格状态文案 + 安装行（空槽）+ 拆除提示（已装/拆除中） */
  private refreshDetail(vm: {
    ringSlots: number
    ringSlotsTotal: number
    ringBuildings: (string | null)[]
    ringDemolish: { slot: number; progress: number; active: boolean } | null
    ringInstallRows: Array<{ id: string; name: string; desc: string; cost: number; canInstall: boolean }>
  }): void {
    const info = findText(this.actor, 'SlotInfoText')
    const demoBtn = findButton(this.actor, 'Btn_slot_demo')
    const demoText = findText(this.actor, 'DemoText')
    if (this.selectedSlot < 0 || this.selectedSlot >= vm.ringSlotsTotal) {
      this.binder.set(info, '点槽位查看 · 橙=空槽可安装 · 亮=已装 · 红=拆除中')
      this.vis.set(this.actor, 'InstallList', true)
      this.syncInstallRows([])
      if (demoBtn) demoBtn.onClick = null
      this.binder.set(demoText, '')
      return
    }
    const slot = this.selectedSlot
    const built = slot < vm.ringSlots
    const installed = vm.ringBuildings[slot] ?? null
    if (!built) {
      this.binder.set(info, `第 ${slot + 1} 环段未建成（建设流交付后可安装）`)
      this.syncInstallRows([])
      if (demoBtn) demoBtn.onClick = null
      this.binder.set(demoText, '')
      return
    }
    if (installed) {
      const def = ringBuildingDefOf(installed)
      this.binder.set(info, `第 ${slot + 1} 环段 · ${def?.name ?? installed} — ${def?.desc ?? ''}`)
      this.syncInstallRows([])
      const fee = mode0()?.ringBuild.demolishFeeOf(slot) ?? 0
      const demoActive = vm.ringDemolish?.active && vm.ringDemolish.slot === slot
      const demoPause = vm.ringDemolish && !vm.ringDemolish.active && vm.ringDemolish.slot === slot
      if (demoBtn) {
        demoBtn.onClick = () => mode0()?.ringBuild.startDemolish(slot)
      }
      this.binder.set(demoText, demoActive
        ? `拆除中 ${(vm.ringDemolish!.progress * 100).toFixed(0)}%（费用 ${fee} H3 随泵扣）`
        : demoPause
          ? `拆除暂停 ${(vm.ringDemolish!.progress * 100).toFixed(0)}% — 再点续拆`
          : `拆除费 ${fee} H3 · 走建设泵反向灌入`)
      this.colors.set(demoText, demoActive || demoPause ? WARN_COLOR : '#9fc4d8')
      return
    }
    // 建成空槽：安装列表
    this.binder.set(info, `第 ${slot + 1} 环段 · 空槽 — 选建筑安装（点击即扣费）`)
    const playable = vm.ringInstallRows
    this.syncInstallRows(playable)
    if (demoBtn) demoBtn.onClick = null
    this.binder.set(demoText, '')
  }

  /** 安装行池同步（ring_building 表键序，行文本 = 名称+造价；点击安装到选中槽） */
  private syncInstallRows(rows: Array<{ id: string; name: string; cost: number; canInstall: boolean }>): void {
    const world = this.world
    const list = findChild(this.actor, 'InstallList')
    if (!world || !list) return
    while (this.installRows.length < rows.length) {
      const row = world.ui.spawnUIActor(RING_INSTALL_ROW_WIDGET, list)
      if (!row) { logger.warn('[RingPanelScript] 安装行生成失败'); break }
      const idx = this.installRows.length
      const btn = findButton(row, 'Btn_row')
      if (btn) {
        btn.onClick = () => {
          const m = mode0()
          const id = this.installIds[idx]
          if (m && id) m.ringBuild.installBuilding(this.selectedSlot, id)
        }
      }
      this.installRows.push(row)
      this.installIds.push('')
    }
    while (this.installRows.length > rows.length) {
      const row = this.installRows.pop()
      this.installIds.pop()
      if (row) world.actorMgr.DestroyActor(row)
    }
    for (let i = 0; i < rows.length; i++) {
      this.installIds[i] = rows[i].id
      const name = findText(this.installRows[i], 'RowName')
      const cost = findText(this.installRows[i], 'RowCost')
      if (name) this.binder.set(name, rows[i].name)
      if (cost) this.binder.set(cost, `${rows[i].cost} H3`)
    }
  }

  /** 设置进度条值（找不到组件时静默跳过） */
  private setProgress(name: string, value: number, max: number): void {
    const bar = findChild(this.actor, name)?.getComponent(UIProgressBarComponent)
    if (!bar) return
    if (bar.max !== max) bar.max = max
    bar.value = value
  }
}

/** 模式访问捷径（onStart 前 wcMode 可能未就绪，回调内实时取） */
function mode0(): ReturnType<typeof wcMode> {
  return wcMode()
}
