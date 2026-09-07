/**
 * ReserveInfoScript — 储量详情独立 widget 行为脚本（reserve_info.widget.json 根节点）
 *
 * 职责：
 *  - 默认隐藏（active=false），由 HudScript 调 open()/close() 切换
 *  - 打开时 8Hz 差分同步 GameMode.buildViewModel() 经济明细（储量/消耗/净流/延续度/环缓冲）
 *  - 遮罩点击 / ✕ 关闭按钮 → close()
 */
import { BehaviourScript, logger } from '@/engine'
import { ColorBinder, TextBinder, findButton, findText, wcMode } from './uiCommon'

/** 储量详情 widget 资产路径（HudScript 生成入口） */
export const RESERVE_INFO_WIDGET = 'asset/blueprints/ui/reserve_info.widget.json'

export default class ReserveInfoScript extends BehaviourScript {
  private binder = new TextBinder()
  private colors = new ColorBinder()
  private acc = 1
  private openState = false

  /** 面板当前是否打开（HudScript 入口按钮读取） */
  get isOpen(): boolean { return this.openState }

  override onStart(): void {
    // 默认隐藏（与 seed json active=false 双保险，SettleScript 同款）
    this.actor.root.visible = false
    // 绑定关闭通道：面板内 ✕ + 遮罩空白点击
    const bind = (name: string, fn: () => void): void => {
      const btn = findButton(this.actor, name)
      if (btn) btn.onClick = fn
    }
    bind('Btn_close_info', () => this.close())
    bind('Dim', () => this.close())
    logger.info('[ReserveInfoScript] 储量详情面板就绪（默认隐藏）')
  }

  /** 打开面板（HudScript 入口按钮调用） */
  open(): void {
    if (this.openState) return
    this.openState = true
    this.actor.root.visible = true
    logger.info('[ReserveInfoScript] 储量详情面板打开')
  }

  /** 关闭面板 */
  close(): void {
    if (!this.openState) return
    this.openState = false
    this.actor.root.visible = false
    logger.info('[ReserveInfoScript] 储量详情面板关闭')
  }

  override onUpdate(dt: number): void {
    if (!this.openState) return
    const mode = wcMode()
    if (!mode) return
    this.acc += dt
    if (this.acc < 0.12) return
    this.acc = 0
    const vm = mode.buildViewModel()

    this.binder.set(findText(this.actor, 'Val_reserve'), `${Math.floor(vm.reserve)} t`)
    this.binder.set(findText(this.actor, 'Val_demand'), `${vm.demand.toFixed(1)}/s`)
    const net = vm.netFlow
    this.binder.set(findText(this.actor, 'Val_net'), `${net >= 0 ? '+' : ''}${net.toFixed(1)}`)
    this.colors.set(findText(this.actor, 'Val_net'), net >= 0 ? '#ffe9a8' : '#ff8f7a')
    this.binder.set(findText(this.actor, 'Val_cont'), `${vm.continuity.toFixed(0)}%${vm.danger ? ' ⚠' : ''}`)
    this.colors.set(findText(this.actor, 'Val_cont'), vm.danger ? '#ff5a4a' : '#ffe9a8')
    this.binder.set(findText(this.actor, 'Val_buffer'), vm.ring === 'decaying'
      ? `${vm.bufferLeft.toFixed(0)}s`
      : '—')
  }
}
