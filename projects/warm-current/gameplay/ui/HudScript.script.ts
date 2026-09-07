/**
 * HudScript — 主 HUD 行为脚本（hud.widget.json 根节点）
 *
 * 职责：
 *  - 顶部状态栏（并入主 HUD）：时间/交点/储量摘要 + 暂停/倍速/重开 + 「储量详情」入口（开关 reserve_info widget）
 *  - 底部 bar：「☰ 科研」入口（开关 research_panel widget）+ 科研徽标（均进度/船队概况）
 *  - 绑定海克斯重开徽标 / 选中面板（建站/升级/拆除）/ 火星任务按钮
 *  - 8Hz 差分同步 GameMode.buildViewModel()（文本/颜色/可见性三 binder，避免逐帧重绘）
 *  - toast 队列渲染（mode.toasts 末 4 条）
 *  - 生成独立子 widget（一次生成，各自脚本自驱动）：
 *      research_panel（科研二级面板）、hex_modal（海克斯三选一）、settle（结算）
 *      ring_panel（聚能环信息面板，交点数由顶栏迁入此处）
 */
import { BehaviourScript, UIScriptComponent, logger } from '@/engine'
import type { Actor } from '@/engine'
import { ColorBinder, TextBinder, VisBinder, findButton, findText, fmtTime, wcMode } from './uiCommon'
import ResearchPanelScript, { RESEARCH_PANEL_WIDGET } from './ResearchPanelScript.script'
import RingPanelScript, { RING_PANEL_WIDGET } from './RingPanelScript.script'
import ReserveInfoScript, { RESERVE_INFO_WIDGET } from './ReserveInfoScript.script'
import ViewToggleScript, { VIEW_TOGGLE_WIDGET } from './ViewToggleScript.script'

const HEX_WIDGET = 'asset/blueprints/ui/hex_modal.widget.json'
const SETTLE_WIDGET = 'asset/blueprints/ui/settle.widget.json'

/** 入口按钮 toggle 子面板（取脚本实例 → isOpen ? close : open，Reserve/Research 同款） */
function toggleSubPanel(actor: Actor | null, isTarget: (s: unknown) => boolean, label: string): void {
  const script = actor?.getComponent(UIScriptComponent)?.instance ?? null
  if (!isTarget(script)) return
  const panel = script as unknown as { isOpen: boolean, open: () => void, close: () => void }
  if (panel.isOpen) {
    panel.close()
    logger.info(`[HudScript] ${label}关闭（入口按钮）`)
  } else {
    panel.open()
    logger.info(`[HudScript] ${label}打开（入口按钮）`)
  }
}

export default class HudScript extends BehaviourScript {
  private binder = new TextBinder()
  private colors = new ColorBinder()
  private vis = new VisBinder()
  private hexModal: Actor | null = null
  private settleModal: Actor | null = null
  private researchPanel: Actor | null = null
  private reserveInfo: Actor | null = null
  private ringPanel: Actor | null = null
  private viewToggle: Actor | null = null
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
    // 选中面板：无选中内容时整体隐藏（onUpdate 差分驱动显隐）
    this.vis.set(this.actor, 'SelPanel', false)
    bind('Btn_hex', () => wcMode()?.reopenHexModal())
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
    // ─── 时间控制（原 TopBarScript 并入） ───
    bind('Btn_pause', () => {
      const m = wcMode()
      if (!m) return
      m.togglePause()
      logger.info(`[HudScript] 暂停切换 → ${m.paused}`)
    })
    bind('Btn_speed', () => {
      const m = wcMode()
      if (!m) return
      m.cycleSpeed()
      logger.info(`[HudScript] 倍速切换 → x${m.timeScale}`)
    })
    bind('Btn_restart', () => {
      logger.info('[HudScript] 重开')
      wcMode()?.restart()
    })
    bind('Btn_info', () => toggleSubPanel(this.reserveInfo, s => s instanceof ReserveInfoScript, '储量详情'))
    // ─── 科研入口（底部 bar，开关 research_panel 二级面板） ───
    bind('Btn_research', () => toggleSubPanel(this.researchPanel, s => s instanceof ResearchPanelScript, '科研面板'))
    // 独立子面板一次生成（各自脚本自驱动可见性）
    this.hexModal = this.world?.ui.spawnUIActor(HEX_WIDGET) ?? null
    this.settleModal = this.world?.ui.spawnUIActor(SETTLE_WIDGET) ?? null
    if (!this.hexModal) logger.warn('[HudScript] hex_modal 生成失败')
    if (!this.settleModal) logger.warn('[HudScript] settle 生成失败')
    // 科研二级面板（五线/造船/船队明细，ResearchPanelScript 自驱动，默认收起）
    this.researchPanel = this.world?.ui.spawnUIActor(RESEARCH_PANEL_WIDGET) ?? null
    if (!this.researchPanel) logger.warn('[HudScript] research_panel 生成失败')
    // 储量详情 widget 一次生成（默认隐藏，脚本自驱动显隐）
    this.reserveInfo = this.world?.ui.spawnUIActor(RESERVE_INFO_WIDGET) ?? null
    if (!this.reserveInfo) logger.warn('[HudScript] reserve_info 生成失败')
    // 聚能环信息面板（右上角常驻：状态/交点/延续/缓冲/净流，RingPanelScript 自驱动）
    this.ringPanel = this.world?.ui.spawnUIActor(RING_PANEL_WIDGET) ?? null
    if (!this.ringPanel) logger.warn('[HudScript] ring_panel 生成失败')
    // 视角切换 widget 一次生成（右下角常驻，ViewToggleScript 自驱动选中态）
    this.viewToggle = this.world?.ui.spawnUIActor(VIEW_TOGGLE_WIDGET) ?? null
    if (!this.viewToggle) logger.warn('[HudScript] view_toggle 生成失败')
    logger.info('[HudScript] HUD 按钮已绑定，科研/储量详情/聚能环/视角切换/海克斯/结算子面板已生成')
  }

  override onUpdate(dt: number): void {
    const mode = wcMode()
    if (!mode) return
    this.acc += dt
    if (this.acc < 0.12) return
    this.acc = 0
    const vm = mode.buildViewModel()

    // ─── 顶部状态栏（原 TopBarScript 并入）：态势摘要 + 时间控制双态 ───
    this.binder.set(findText(this.actor, 'TimeText'), fmtTime(vm.time))
    this.binder.set(findText(this.actor, 'ReserveText'), `储量 ${Math.floor(vm.reserve)} t`)
    const playable = vm.outcome === 'playing' || vm.sandbox
    const pauseLabel = findText(this.actor, 'Label_pause')
    this.binder.set(pauseLabel, vm.paused ? '继续' : '暂停')
    this.colors.set(pauseLabel, vm.paused ? '#7fdcff' : '#cfe3ee')
    this.binder.set(findText(this.actor, 'Label_speed'), `倍速 x${vm.timeScale}`)
    this.vis.set(this.actor, 'Btn_pause', playable)
    this.vis.set(this.actor, 'Btn_speed', playable)
    this.vis.set(this.actor, 'Btn_restart', playable)

    // ─── 底部 bar：科研徽标（均进度 + 空闲/总船数，面板收起时也能看到概况） ───
    const lineSum = Math.round(
      vm.research.reduce((sum, l) => sum + l.progress, 0) / Math.max(1, vm.research.length) * 100,
    )
    this.binder.set(findText(this.actor, 'ResearchBadge'), `均 ${lineSum}% · 船 ${vm.fleet.idle}/${vm.fleet.total}`)

    // ─── 海克斯待选徽标（自动收纳后出现，点击重开；弹窗可见时隐藏） ───
    const hexPend = mode.simState.state.pendingCard
    const hexHidden = mode.simState.state.hexHiddenAt !== null
    this.vis.set(this.actor, 'Btn_hex', !!hexPend && hexHidden)
    if (hexPend && hexHidden) {
      this.binder.set(findText(this.actor, 'Label_hex'), '✦ 待选海克斯 +1')
    }

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

    // ─── 右下动作 ───
    this.vis.set(this.actor, 'Btn_mission', vm.canStartMission)

    // ─── 左下选中面板（无选中整体隐藏，不再常驻） ───
    const hasSel = !!vm.routeInfo || !!vm.stationInfo
    this.vis.set(this.actor, 'SelPanel', hasSel)
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
      this.binder.set(findText(this.actor, 'SelText'), '')
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
