/**
 * HudScript — 主 HUD 行为脚本（hud.widget.json 根节点）
 *
 * 职责：
 *  - 绑定全部按钮（暂停/倍速/重开/造船/超频/建站/升级/拆除/火星任务）
 *  - 8Hz 差分同步 GameMode.buildViewModel()（文本/颜色/可见性三 binder，避免逐帧重绘）
 *  - toast 队列渲染（mode.toasts 末 4 条）
 *  - 生成海克斯三选一 / 结算两个子 widget（一次生成，各自脚本自驱动）
 */
import { BehaviourScript, logger } from '@/engine'
import type { Actor } from '@/engine'
import { ColorBinder, TextBinder, VisBinder, findButton, findText, fmtTime, wcMode } from './uiCommon'

const HEX_WIDGET = 'asset/blueprints/ui/hex_modal.widget.json'
const SETTLE_WIDGET = 'asset/blueprints/ui/settle.widget.json'

const LINES = ['engine', 'cargo', 'ring', 'infra', 'expand'] as const

export default class HudScript extends BehaviourScript {
  private binder = new TextBinder()
  private colors = new ColorBinder()
  private vis = new VisBinder()
  private hexModal: Actor | null = null
  private settleModal: Actor | null = null
  private acc = 1

  override onStart(): void {
    const mode = wcMode()
    if (!mode) {
      logger.warn('[HudScript] GameMode 未就绪')
      return
    }
    const bind = (name: string, fn: () => void): void => {
      const btn = findButton(this.actor, name)
      if (btn) btn.onClick = fn
    }
    bind('Btn_pause', () => wcMode()?.togglePause())
    bind('Btn_speed', () => wcMode()?.cycleSpeed())
    bind('Btn_restart', () => wcMode()?.restart())
    bind('Btn_ship', () => wcMode()?.transport.tryBuildShip())
    bind('Btn_mission', () => wcMode()?.transport.startMarsMission())
    bind('Btn_build_station', () => {
      const m = wcMode()
      if (m?.selection?.type === 'route') m.stations.tryBuildStation(m.selection.id)
    })
    bind('Btn_upgrade_station', () => {
      const m = wcMode()
      if (m?.selection?.type === 'station') m.stations.tryUpgradeStation(m.selection.id)
    })
    bind('Btn_demolish', () => {
      const m = wcMode()
      if (m?.selection?.type === 'station') m.stations.tryDemolishStation(m.selection.id)
    })
    for (const id of LINES) {
      bind(`Btn_oc_${id}`, () => wcMode()?.research.toggleOverclock(id))
    }
    // 子面板一次生成（各自脚本自驱动可见性）
    this.hexModal = this.world?.ui.spawnUIActor(HEX_WIDGET) ?? null
    this.settleModal = this.world?.ui.spawnUIActor(SETTLE_WIDGET) ?? null
    if (!this.hexModal) logger.warn('[HudScript] hex_modal 生成失败')
    if (!this.settleModal) logger.warn('[HudScript] settle 生成失败')
    logger.info('[HudScript] HUD 按钮已绑定，子面板已生成')
  }

  override onUpdate(dt: number): void {
    const mode = wcMode()
    if (!mode) return
    this.acc += dt
    if (this.acc < 0.12) return
    this.acc = 0
    const vm = mode.buildViewModel()

    // ─── 顶左态势 ───
    this.binder.set(findText(this.actor, 'ActText'), `第${['一', '二', '三'][vm.act - 1]}幕 · ${vm.actName}`)
    this.binder.set(findText(this.actor, 'TimeText'), fmtTime(vm.time))
    this.binder.set(findText(this.actor, 'NodesText'), `交点 ${vm.nodes}/12`)
    this.binder.set(findText(this.actor, 'ReserveText'), `储量 ${Math.floor(vm.reserve)} t`)
    this.binder.set(findText(this.actor, 'DemandText'), `消耗 ${vm.demand.toFixed(1)}/s`)
    const net = vm.netFlow
    this.binder.set(findText(this.actor, 'NetText'), `净流 ${net >= 0 ? '+' : ''}${net.toFixed(1)}`)
    this.colors.set(findText(this.actor, 'NetText'), net >= 0 ? '#9fc4d8' : '#ff8f7a')
    this.binder.set(findText(this.actor, 'ContText'), vm.ring === 'running'
      ? `延续度 ${vm.continuity.toFixed(0)}%`
      : `延续度 ${vm.continuity.toFixed(0)}%（衰减）`)
    this.colors.set(findText(this.actor, 'ContText'), vm.danger ? '#ff5a4a' : '#7fe0a0')
    this.binder.set(findText(this.actor, 'BufferText'), vm.ring === 'decaying'
      ? `环缓冲 ${vm.bufferLeft.toFixed(0)}s`
      : '')

    // ─── 事件横幅 ───
    let ev = ''
    let evColor = '#ffb03d'
    if (vm.flarePhase === 'active') {
      ev = `☀ 太阳耀斑干扰中 ${vm.flareRemain}s — 在途船失联`
      evColor = '#ff5a4a'
    } else if (vm.flarePhase === 'warn') {
      ev = `⚠ 耀斑 ${vm.flareRemain}s 后来袭 — 尽快回航/入护盾`
      evColor = '#ff8f5a'
    } else if (vm.windowPhase === 'active') {
      ev = `◈ 引力窗口开启 ${vm.windowRemain}s — 木卫二线 ×2 速 ×0.5 耗`
    } else if (vm.windowPhase === 'warn') {
      ev = `◈ 引力窗口 ${vm.windowRemain}s 后开启`
    }
    this.binder.set(findText(this.actor, 'EventText'), ev)
    this.colors.set(findText(this.actor, 'EventText'), evColor)

    // ─── 右侧研究/船队 ───
    this.binder.set(findText(this.actor, 'FleetText'),
      `船队 ${vm.fleet.total}（空闲 ${vm.fleet.idle} · 在途 ${vm.fleet.flying} · 冻毁 ${vm.fleet.frozen}）`
      + (vm.fleet.building > 0 ? ` · 建造中 ${vm.fleet.buildRemain}s` : ''))
    for (const line of vm.research) {
      this.binder.set(findText(this.actor, `Line_${line.id}`),
        `${line.name} ${(line.progress * 100).toFixed(0)}%${line.oc ? ' ⚡' : ''}`)
      // 超频可用性：运转中且无选卡冻结
      this.vis.set(this.actor, `Btn_oc_${line.id}`, vm.ring === 'running' && !vm.pending && vm.outcome === 'playing')
    }
    this.vis.set(this.actor, 'Btn_ship', vm.outcome === 'playing' && !vm.pending)

    // ─── 右下动作 ───
    this.vis.set(this.actor, 'Btn_mission', vm.canStartMission)

    // ─── 左下选中面板 ───
    if (vm.routeInfo) {
      const r = vm.routeInfo
      this.binder.set(findText(this.actor, 'SelText'),
        `${r.name}（${r.direction === 'forward' ? '正向运 H3' : '反向送建材'}）\n`
        + `配船 ${r.ships} 艘 · 单船净 ${r.direction === 'forward' ? `${r.net}t` : `载建材 ${r.net}`} · 往返 ${r.cycle.toFixed(0)}s`)
    } else if (vm.stationInfo) {
      const st = vm.stationInfo
      this.binder.set(findText(this.actor, 'SelText'),
        `补给站 Lv${st.level} · 护盾半径 ${st.radius} · 保全容量 ${st.cap} 艘\n`
        + `建材 ${Math.floor(st.stock)}/${st.need}${st.level === 0 ? '（达标自动建成）' : ''}`)
    } else {
      this.binder.set(findText(this.actor, 'SelText'), vm.tutorial ? '拖拽星球建航线\n点航线/补给站查看详情' : '')
    }
    this.vis.set(this.actor, 'Btn_build_station', !!vm.routeInfo?.canBuildStation)
    this.vis.set(this.actor, 'Btn_upgrade_station', !!vm.stationInfo?.canUpgrade)
    this.vis.set(this.actor, 'Btn_demolish', !!vm.stationInfo && vm.stationInfo.level >= 1)

    // ─── toast（末 4 条） ───
    for (let i = 0; i < 4; i++) {
      const idx = mode.toasts.length - 4 + i
      const t = findText(this.actor, `Toast_${i}`)
      if (idx >= 0 && mode.toasts[idx]) {
        const toast = mode.toasts[idx]
        this.vis.set(this.actor, `Toast_${i}`, true)
        this.binder.set(t, toast.text)
        this.colors.set(t, toast.color)
      } else {
        this.vis.set(this.actor, `Toast_${i}`, false)
      }
    }

    // ─── 教学 / 造船按钮态 ───
    this.vis.set(this.actor, 'TutText', vm.tutorial)
  }

  override onDestroy(): void {
    // 子面板随世界销毁（stop 走 DestroyAllActors），无需单独清理
  }
}
