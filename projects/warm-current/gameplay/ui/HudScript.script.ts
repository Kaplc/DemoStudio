/**
 * HudScript — 主 HUD 行为脚本（hud.widget.json 根节点）
 *
 * 职责：
 *  - 顶部状态栏（并入主 HUD）：时间/交点/储量摘要 + 暂停/倍速/重开 + 「储量详情」入口（开关 reserve_info widget）
 *  - 底部 bar：「建造」「运输」「航线」「☰ 科研」「聚能环」入口（前两个 + 聚能环为居中二级面板同屏互斥；航线为右侧独立面板）+ 科研徽标（均进度/船队概况）
 *  - 绑定火星任务按钮；海克斯三选一弹窗（hex_modal）由其脚本自驱动（弹卡即暂停，选卡恢复）
 *  - 8Hz 差分同步 GameMode.buildViewModel()（文本/颜色/可见性三 binder，避免逐帧重绘）
 *  - toast 队列渲染（mode.toasts 末 4 条）
 *  - 生成独立子 widget（一次生成，各自脚本自驱动）：
 *      research_panel（科研二级面板）、build_panel（建造二级面板）、transport_panel（运输二级面板）、
 *      routes_panel（航线管理面板）、hex_modal（海克斯三选一）、settle（结算）
 *      ring_panel（聚能环信息面板，交点数由顶栏迁入此处）
 */
import { BehaviourScript, UIScriptComponent, logger } from '@/engine'
import type { Actor } from '@/engine'
import { ColorBinder, TextBinder, VisBinder, findButton, findText, fmtTime, wcMode } from './uiCommon'
import ResearchPanelScript, { RESEARCH_PANEL_WIDGET } from './ResearchPanelScript.script'
import RingPanelScript, { RING_PANEL_WIDGET } from './RingPanelScript.script'
import ReserveInfoScript, { RESERVE_INFO_WIDGET } from './ReserveInfoScript.script'
import ViewToggleScript, { VIEW_TOGGLE_WIDGET } from './ViewToggleScript.script'
import BuildPanelScript, { BUILD_PANEL_WIDGET } from './BuildPanelScript.script'
import TransportPanelScript, { TRANSPORT_PANEL_WIDGET } from './TransportPanelScript.script'
import RoutesPanelScript, { ROUTES_PANEL_WIDGET } from './RoutesPanelScript.script'
import PlanetInfoScript, { PLANET_INFO_WIDGET } from './PlanetInfoScript.script'
import StatsPanelScript, { STATS_PANEL_WIDGET } from './StatsPanelScript.script'

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

/** 居中二级面板登记项（同屏互斥：面板同在画布正中，叠开会互相遮挡） */
interface CenterPanelEntry {
  actor: () => Actor | null
  is: (s: unknown) => boolean
  label: string
}

export default class HudScript extends BehaviourScript {
  private binder = new TextBinder()
  private colors = new ColorBinder()
  private vis = new VisBinder()
  private hexModal: Actor | null = null
  private settleModal: Actor | null = null
  private researchPanel: Actor | null = null
  private buildPanel: Actor | null = null
  private transportPanel: Actor | null = null
  private routesPanel: Actor | null = null
  private planetInfoPanel: Actor | null = null
  private statsPanel: Actor | null = null
  private reserveInfo: Actor | null = null
  private ringPanel: Actor | null = null
  private viewToggle: Actor | null = null
  /** 居中二级面板互斥登记（科研/建造/运输，onStart 填充） */
  private centerPanels: CenterPanelEntry[] = []
  private acc = 1

  /** 居中面板互斥开关：只收起其它「展开中」的居中面板（只关不开，对关闭面板 toggle 会误开），再 toggle 目标 */
  private toggleCenterPanel(target: CenterPanelEntry): void {
    for (const p of this.centerPanels) {
      if (p === target) continue
      const inst = p.actor()?.getComponent(UIScriptComponent)?.instance
      if (!inst || !p.is(inst)) continue
      const panel = inst as unknown as { isOpen: boolean, close: () => void }
      if (panel.isOpen) {
        panel.close()
        logger.info(`[HudScript] ${p.label}关闭（居中互斥）`)
      }
    }
    toggleSubPanel(target.actor(), target.is, target.label)
  }

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
    bind('Btn_mission', () => wcMode()?.transport.startMarsMission())
    bind('Btn_demolish', () => {
      const m = wcMode()
      if (m?.selection?.type === 'building') m.buildings.tryDemolish(m.selection.id)
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
    // ─── 居中二级面板（科研/建造/运输，同屏互斥） ───
    const researchEntry: CenterPanelEntry = { actor: () => this.researchPanel, is: (s) => s instanceof ResearchPanelScript, label: '科研面板' }
    const buildEntry: CenterPanelEntry = { actor: () => this.buildPanel, is: (s) => s instanceof BuildPanelScript, label: '建造面板' }
    const transportEntry: CenterPanelEntry = { actor: () => this.transportPanel, is: (s) => s instanceof TransportPanelScript, label: '运输面板' }
    const statsEntry: CenterPanelEntry = { actor: () => this.statsPanel, is: (s) => s instanceof StatsPanelScript, label: '收支统计面板' }
    // 聚能环详情面板（居中大面板，与其它居中面板同屏互斥）
    const ringEntry: CenterPanelEntry = { actor: () => this.ringPanel, is: (s) => s instanceof RingPanelScript, label: '聚能环详情面板' }
    this.centerPanels = [researchEntry, buildEntry, transportEntry, statsEntry, ringEntry]
    bind('Btn_research', () => this.toggleCenterPanel(researchEntry))
    bind('Btn_build', () => this.toggleCenterPanel(buildEntry))
    bind('Btn_transport', () => this.toggleCenterPanel(transportEntry))
    bind('Btn_stats', () => this.toggleCenterPanel(statsEntry))
    bind('Btn_ring', () => this.toggleCenterPanel(ringEntry))
    // ─── 航线管理入口（右侧独立面板，不占居中区，不参与居中互斥） ───
    bind('Btn_routes', () => toggleSubPanel(this.routesPanel, s => s instanceof RoutesPanelScript, '航线管理面板'))
    // ─── 航线编辑模式开关（进入后星图节点才可拖线；退出后点星球 = 信息面板） ───
    bind('Btn_routeedit', () => {
      const m = wcMode()
      if (!m) return
      m.toggleRouteEditMode()
      logger.info(`[HudScript] 航线编辑切换 → ${m.routeEditMode}`)
    })
    // 独立子面板一次生成（各自脚本自驱动可见性）
    this.hexModal = this.world?.ui.spawnUIActor(HEX_WIDGET) ?? null
    this.settleModal = this.world?.ui.spawnUIActor(SETTLE_WIDGET) ?? null
    if (!this.hexModal) logger.warn('[HudScript] hex_modal 生成失败')
    if (!this.settleModal) logger.warn('[HudScript] settle 生成失败')
    // 科研二级面板（四线点数分配/船队明细，ResearchPanelScript 自驱动，默认收起）
    this.researchPanel = this.world?.ui.spawnUIActor(RESEARCH_PANEL_WIDGET) ?? null
    if (!this.researchPanel) logger.warn('[HudScript] research_panel 生成失败')
    // 建造二级面板（building 表驱动建筑行，BuildPanelScript 自驱动，默认收起）
    this.buildPanel = this.world?.ui.spawnUIActor(BUILD_PANEL_WIDGET) ?? null
    if (!this.buildPanel) logger.warn('[HudScript] build_panel 生成失败')
    // 运输二级面板（造船/船队明细/冻毁重建，TransportPanelScript 自驱动，默认收起）
    this.transportPanel = this.world?.ui.spawnUIActor(TRANSPORT_PANEL_WIDGET) ?? null
    if (!this.transportPanel) logger.warn('[HudScript] transport_panel 生成失败')
    // 收支统计面板（H3 九项收支+合计，StatsPanelScript 自驱动，默认收起，参与居中互斥）
    this.statsPanel = this.world?.ui.spawnUIActor(STATS_PANEL_WIDGET) ?? null
    if (!this.statsPanel) logger.warn('[HudScript] stats_panel 生成失败')
    // 航线管理面板（右侧常驻位：全航线派船/召回/删线，RoutesPanelScript 自驱动，默认收起）
    this.routesPanel = this.world?.ui.spawnUIActor(ROUTES_PANEL_WIDGET) ?? null
    if (!this.routesPanel) logger.warn('[HudScript] routes_panel 生成失败')
    // 星球信息面板（左侧常驻位：非航线编辑模式点星球弹出，PlanetInfoScript 读 vm.planetInfo 自驱动）
    this.planetInfoPanel = this.world?.ui.spawnUIActor(PLANET_INFO_WIDGET) ?? null
    if (!this.planetInfoPanel) logger.warn('[HudScript] planet_info 生成失败')
    // 储量详情 widget 一次生成（默认隐藏，脚本自驱动显隐）
    this.reserveInfo = this.world?.ui.spawnUIActor(RESERVE_INFO_WIDGET) ?? null
    if (!this.reserveInfo) logger.warn('[HudScript] reserve_info 生成失败')
    // 聚能环详情面板（底部「聚能环」入口开关：状态/交点/建设点数/延续/缓冲/净流，RingPanelScript 自驱动）
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

    // ─── 底部 bar：航线编辑按钮激活态（金色 + ● 前缀，模式开关的可见反馈） ───
    const routeEditLabel = findText(this.actor, 'Label_routeedit')
    this.binder.set(routeEditLabel, vm.routeEditMode ? '● 航线编辑' : '航线编辑')
    this.colors.set(routeEditLabel, vm.routeEditMode ? '#ffe9a8' : '#7fdcff')

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
    const hasSel = !!vm.routeInfo || !!vm.buildingInfo
    this.vis.set(this.actor, 'SelPanel', hasSel)
    if (vm.routeInfo) {
      const r = vm.routeInfo
      this.binder.set(findText(this.actor, 'SelText'),
        `${r.name}（${r.direction === 'forward' ? '正向运 H3' : '反向送建材入缓存'}）\n`
        + `配船 ${r.ships} 艘 · 单船净 ${r.direction === 'forward' ? `${r.net}t` : `载建材 ${r.net}`} · 往返 ${r.cycle.toFixed(0)}s`)
    } else if (vm.buildingInfo) {
      const b = vm.buildingInfo
      const info = b.bufferCap > 0
        ? `缓存 ${b.stock}/${b.bufferCap} · 航线可链接`
        : `护盾半径 ${b.radius} · 保全容量 ${b.cap} 艘`
      this.binder.set(findText(this.actor, 'SelText'), `${b.name} ${b.id}\n${info}`)
    } else {
      this.binder.set(findText(this.actor, 'SelText'), '')
    }
    this.vis.set(this.actor, 'Btn_demolish', !!vm.buildingInfo && vm.buildingInfo.canDemolish)

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
