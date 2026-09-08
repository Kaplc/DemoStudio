/**
 * RingPanelScript — 聚能环详情面板行为脚本（ring_panel.widget.json 根节点）
 *
 * 2026-09-08 改版（用户拍板：聚能环建设脱离科研）：
 *  - 独立 widget 居中大面板（对齐 ResearchPanel 520x442 居中规格），底部 HUD「聚能环」入口
 *    toggleCenterPanel 开关，面板内「✕ 关闭」收起（ResearchPanel 同款 open/close）
 *  - 新增建设控制区：交点建设进度条（建设流 = 交点解锁唯一来源）+ 建设点数 +/−（默认 1、最低 1）
 *    + 每点 H3 计费速率显示；点数下限提示走 toast（GameMode.hint）
 *  - 保留原有状态徽标/等级/交点/延续度/缓冲/净流/危险警示展示
 * 数据全部来自 GameMode.buildViewModel()，0.15s 差分刷新（TextBinder/ColorBinder 避免逐帧重绘）。
 */
import { BehaviourScript, UIProgressBarComponent, UIImageComponent, logger } from '@/engine'
import { ColorBinder, TextBinder, VisBinder, findButton, findChild, findText, wcMode } from './uiCommon'

/** 聚能环面板 widget 资产路径（HudScript spawn 用） */
export const RING_PANEL_WIDGET = 'asset/blueprints/ui/ring_panel.widget.json'

const STATE_RUNNING_COLOR = '#ffb03d'
const STATE_DECAYING_COLOR = '#ff5a4a'
const STATE_DONE_COLOR = '#43d17c'
const WARN_COLOR = '#ff5a4a'
const IDLE_COLOR = '#9fc4d8'
const BUFFER_FILL_NORMAL = '#ffe9a8'
const BUFFER_FILL_WARN = '#ff5a4a'
const LEVEL_COLOR = '#ffb03d'

export default class RingPanelScript extends BehaviourScript {
  private binder = new TextBinder()
  private colors = new ColorBinder()
  private vis = new VisBinder()
  private acc = 0.15
  /** 面板开合状态（默认收起，HudScript 底部入口读取 isOpen 决定 open/close） */
  private openState = false

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
    logger.info('[RingPanelScript] 聚能环详情面板就绪（默认收起，底部入口开关）')
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

    // ─── 状态徽标：运转 / 衰减 / 已建成（12 交点闭环） ───
    const done = vm.nodes >= 12
    const stateText = findText(this.actor, 'StateText')
    if (vm.ring === 'decaying') {
      this.binder.set(stateText, `衰减 ${Math.ceil(vm.bufferLeft)}s`)
      this.colors.set(stateText, STATE_DECAYING_COLOR)
    } else if (done) {
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

    // ─── 交点进度条 ───
    this.binder.set(findText(this.actor, 'NodesText'), `交点 ${vm.nodes}/12`)
    this.setProgress('NodesBar', vm.nodes, 12)

    // ─── 建设控制区：交点建设进度 + 点数 +/− + 计费速率 ───
    this.binder.set(findText(this.actor, 'BuildText'), `建设 ${(vm.ringBuildProgress * 100).toFixed(0)}%`)
    this.setProgress('BuildBar', vm.ringBuildProgress, 1)
    const pts = findText(this.actor, 'BuildPtsText')
    this.binder.set(pts, `建设 ${vm.ringBuildPoints} 点`)
    this.colors.set(pts, vm.ringBuildPoints <= vm.ringBuildMin ? IDLE_COLOR : '#ffe9a8')
    const cost = findText(this.actor, 'BuildCostText')
    this.binder.set(cost, `${vm.ringBuildCost.toFixed(1)}/s · ${vm.ringBuildRate > 0 ? `${(vm.ringBuildRate * 100).toFixed(1)}%/s` : '停建'}`)
    this.colors.set(cost, vm.ringBuildRate > 0 ? '#7fdcff' : WARN_COLOR)

    // ─── 延续度（0-100%） ───
    const cont = Math.max(0, Math.min(100, Math.round(vm.continuity)))
    this.binder.set(findText(this.actor, 'ContText'), `延续 ${cont}%`)
    this.setProgress('ContBar', cont, 100)

    // ─── 缓冲条：running 时隐藏（无缓冲概念），decaying 时显示剩余/总量 ───
    const showBuffer = vm.ring === 'decaying' && vm.bufferTotal > 0
    this.vis.set(this.actor, 'BufferRow', showBuffer)
    if (showBuffer) {
      this.binder.set(findText(this.actor, 'BufferText'),
        `缓冲 ${Math.ceil(vm.bufferLeft)}/${Math.ceil(vm.bufferTotal)}s`)
      this.setProgress('BufferBar', vm.bufferLeft, vm.bufferTotal)
      // 缓冲告急（<30%）填充条变红
      const fill = findChild(this.actor, 'BufferBar')?.getChildren().find((c) => c.root.name === 'Fill')
      const img = fill?.getComponent(UIImageComponent)
      if (img) {
        const c = vm.bufferLeft / vm.bufferTotal < 0.3 ? BUFFER_FILL_WARN : BUFFER_FILL_NORMAL
        if (img.color !== c) img.color = c
      }
    }

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

  /** 设置进度条值（找不到组件时静默跳过） */
  private setProgress(name: string, value: number, max: number): void {
    const bar = findChild(this.actor, name)?.getComponent(UIProgressBarComponent)
    if (!bar) return
    if (bar.max !== max) bar.max = max
    bar.value = value
  }
}
