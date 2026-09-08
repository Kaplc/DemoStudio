/**
 * RingPanelScript — 聚能环信息面板行为脚本（ring_panel.widget.json 根节点）
 *
 * 右上角常驻面板，集中展示聚能环相关状态（原散在 HUD 顶栏的交点数迁入此处）：
 *  - 状态徽标：运转（橙）/ 衰减（红闪语义由文本+颜色表达）/ 已建成（绿）
 *  - 等级行：聚能环等级 Lv/25 + 全球覆盖度（= 交点/12）+ 升级进度条
 *    （五线研究最靠前进度，随时间连续推进、选卡冻结；满级 Lv25 = 全球组网）
 *  - 交点进度条（0-12，UIProgressBarComponent 驱动 Fill）
 *  - 延续度条（0-100%）+ 缓冲条（running 时显示剩余缓冲秒数占比）
 *  - 净流估算 / 需求-储量行 / 危险警示行（danger 时红色提示）
 * 数据全部来自 GameMode.buildViewModel()，0.15s 差分刷新（TextBinder/ColorBinder 避免逐帧重绘）。
 * 由 HudScript 一次 spawn（research_panel 同款惯例），自身自驱动，无按钮绑定。
 */
import { BehaviourScript, UIProgressBarComponent, UIImageComponent, logger } from '@/engine'
import { ColorBinder, TextBinder, VisBinder, findChild, findText, wcMode } from './uiCommon'

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

  override onStart(): void {
    logger.info('[RingPanelScript] 聚能环信息面板就绪（右上角常驻）')
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

    // ─── 等级行：聚能环等级 Lv/25 + 全球覆盖度 + 升级进度（研究随时间推进，选卡冻结） ───
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
