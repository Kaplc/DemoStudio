/**
 * WarmCurrentGameMode — 游戏规则胶水（hoi4 base/ 架构位）
 *
 * 仿真子系统全部做成 GameMode 上的引擎组件（对齐 SpawnComponent/CameraComponent 惯例）：
 * simState（状态+快照）/ transport（航线飞船）/ economy（焚烧衰减）/ research（研究海克斯）
 * / hazards（引力窗口+耀斑）/ stations（补给站）/ acts（三幕）+ sim（总控编排器）。
 * HUD 不在此构建（HUDClass 指向 hud.widget.json，由 gameplay/ui/*.script.ts 消费 buildViewModel）。
 * 指针事件经 WarmCurrentPlayerController 进来后做节点/航线几何命中，转成组件指令。
 */
import { CameraComponent, GameMode, audioSys, logger } from '@/engine'
import { B, refreshBalanceFromConfigs } from '../core/balance'
import type { CardDef } from '../core/balance'
import { getCardDef } from '../core/cards'
import {
  cargoCap, estimateNetFlow, endpointPos, findRoute, roundFuel, routeCycleSeconds,
  routeNetPerTrip, starLoad, starOfEndpoint,
} from '../core/helpers'
import type { Endpoint, SimRoute, SimStation, StarId } from '../core/types'
import { StarMapRenderComponent } from '../map/StarMapRenderComponent'
import type { DragState, MapFx, MapSelection } from '../map/StarMapRenderComponent'
import { SimStateComponent } from '../systems/SimStateComponent'
import { TransportComponent } from '../systems/TransportComponent'
import { EconomyComponent } from '../systems/EconomyComponent'
import { ResearchComponent } from '../systems/ResearchComponent'
import { HazardsComponent } from '../systems/HazardsComponent'
import { StationsComponent } from '../systems/StationsComponent'
import { ActsComponent } from '../systems/ActsComponent'
import { SimulationComponent } from '../systems/SimulationComponent'
import { WarmCurrentPlayerController } from './WarmCurrentPlayerController'
import { WarmCurrentPawn } from './WarmCurrentPawn'
import { registerWarmCurrentAudio } from './audio'

export const WARM_CURRENT_SCENE = 'WarmCurrentMap'
export const HUD_WIDGET = 'asset/blueprints/ui/hud.widget.json'

function dist(px: number, py: number, x: number, y: number): number {
  return Math.hypot(px - x, py - y)
}

function segDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const len2 = abx * abx + aby * aby
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2)) : 0
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t))
}

// ─── HUD 视图模型（UI 行为脚本每帧消费） ───

export interface HudRouteInfo {
  name: string
  direction: 'forward' | 'reverse'
  ships: number
  net: number
  cycle: number
  canBuildStation: boolean
}

export interface HudStationInfo {
  level: number
  radius: number
  cap: number
  stock: number
  need: number
  canUpgrade: boolean
  nextNeed: number
}

export interface WarmCurrentVM {
  time: number
  act: 1 | 2 | 3
  actName: string
  nodes: number
  continuity: number
  ring: 'running' | 'decaying'
  bufferLeft: number
  bufferTotal: number
  reserve: number
  demand: number
  ocCost: number
  netFlow: number
  danger: boolean
  windowPhase: 'idle' | 'warn' | 'active'
  windowRemain: number
  flarePhase: 'idle' | 'warn' | 'active'
  flareRemain: number
  fleet: { total: number; idle: number; flying: number; frozen: number; building: number; buildRemain: number }
  research: Array<{ id: string; name: string; progress: number; oc: boolean }>
  pending: { lineName: string; cards: CardDef[] } | null
  routeInfo: HudRouteInfo | null
  stationInfo: HudStationInfo | null
  tutorial: boolean
  paused: boolean
  timeScale: number
  moduleState: 'locked' | 'available' | 'mission' | 'delivered'
  canStartMission: boolean
  outcome: 'playing' | 'victory' | 'defeat'
  sandbox: boolean
  stats: { delivered: number; frozen: number; stations: number; cards: number }
}

export class WarmCurrentGameMode extends GameMode {
  /** 仿真子系统组件（对齐引擎 SpawnComponent/CameraComponent 惯例，挂在 GameMode 上） */
  readonly simState: SimStateComponent = this.addComponent(SimStateComponent)
  readonly transport: TransportComponent = this.addComponent(TransportComponent)
  readonly economy: EconomyComponent = this.addComponent(EconomyComponent)
  readonly research: ResearchComponent = this.addComponent(ResearchComponent)
  readonly hazards: HazardsComponent = this.addComponent(HazardsComponent)
  readonly stations: StationsComponent = this.addComponent(StationsComponent)
  readonly acts: ActsComponent = this.addComponent(ActsComponent)
  /** 总控编排器（固定顺序驱动各子系统 tick） */
  readonly sim: SimulationComponent = this.addComponent(SimulationComponent)

  gameCamera: CameraComponent

  starMap: StarMapRenderComponent | null = null

  drag: DragState | null = null
  selection: MapSelection = null
  fx: MapFx = { pulses: [], floats: [] }

  paused = false
  timeScale: 1 | 2 = 1

  /** 事件 toast 队列（HudScript 每帧消费渲染） */
  toasts: Array<{ text: string; color: string; age: number }> = []

  /** HUD widget 资产（PC.ClientSetHUD 链自动创建，脚本挂根节点） */
  override HUDClass = HUD_WIDGET

  constructor() {
    super()
    // 透视俯视相机（3D 标准）：fov 50 @ 高 1160 → 地面可视半高 ≈540（全图入画）
    this.gameCamera = this.addComponent(CameraComponent, 'WarmCurrentCamera')
    this.gameCamera.SetView(50, 5, 4000)
    this.gameCamera.priority = 10
  }

  override InitGame(): void {
    // 配置表覆盖默认值 + 重置仿真状态（改表重开一局即生效）
    refreshBalanceFromConfigs()
    this.simState.reset()
    super.InitGame()
    this.cameraManager.RegisterCamera(this.gameCamera)
    const cam = this.gameCamera.camera
    cam.position.set(0, 1160, 0)
    cam.up.set(0, 0, -1) // 地图"北"朝屏幕上方（hoi4 同款垂直俯视姿态）
    cam.lookAt(0, 0, 0)
    this.gameCamera.SyncToActor()
  }

  override spawnPlayerInternal() {
    return { controller: new WarmCurrentPlayerController(this), pawn: new WarmCurrentPawn() }
  }

  override BeginPlay(): void {
    super.BeginPlay()
    if (!this.world) return
    registerWarmCurrentAudio()
    // 星图渲染组件挂到场景资产的 StarMap 节点（场景/蓝图资产化：节点由 warm_current.scene.json 布置）
    const node = this.world.findActorByName('StarMap')
    if (node) {
      this.starMap = node.addComponent(StarMapRenderComponent, this)
    } else {
      logger.warn('[WarmCurrent] 场景缺少 StarMap 节点，星图不可渲染')
    }
    logger.info('[WarmCurrent] BeginPlay 完成（拖一条线，延续人类）')
  }

  override Tick(dt: number): void {
    super.Tick(dt)
    const s = this.simState.state
    if (!this.paused && (s.outcome === 'playing' || s.sandbox)) {
      this.sim.runTick(dt * this.timeScale)
    }
    this.drainEvents()
    // 特效/toast 老化（真实时间）
    for (const p of this.fx.pulses) p.age += dt
    this.fx.pulses = this.fx.pulses.filter((p) => p.age < 0.6)
    for (const f of this.fx.floats) f.age += dt
    this.fx.floats = this.fx.floats.filter((f) => f.age < 1.4)
    for (const t of this.toasts) t.age += dt
    this.toasts = this.toasts.filter((t) => t.age < 3.6)
    this.starMap?.render(this.paused ? 0 : dt * this.timeScale)
  }

  // ═══════════════════════════════════════════
  //  事件 → 反馈（音效 + toast 队列）
  // ═══════════════════════════════════════════

  private drainEvents(): void {
    const sc = this.simState
    if (sc.events.length === 0) return
    let unloadSounds = 0
    for (const ev of sc.events) {
      switch (ev.type) {
        case 'unload':
          if (ev.x !== undefined && ev.y !== undefined) {
            this.fx.pulses.push({ x: ev.x, y: ev.y, age: 0 })
            this.fx.floats.push({ text: ev.value ? `+${ev.value}` : '', x: ev.x, y: ev.y - 30, age: 0 })
          }
          if (unloadSounds++ < 2) audioSys.play('wc.unload', { volume: 0.5 })
          break
        case 'route_built': audioSys.play('wc.ok'); break
        case 'route_deleted': audioSys.play('wc.bad', { volume: 0.5 }); break
        case 'ship_built': this.toast('新船下水，已入列空闲池', '#b8ffd8'); break
        case 'ship_rebuilt': this.toast('冻毁飞船已重建', '#b8ffd8'); break
        case 'hint':
          if (ev.text) { this.toast(ev.text, '#ff8f7a'); audioSys.play('wc.bad', { volume: 0.35 }) }
          break
        case 'card_pending':
          audioSys.play('wc.card')
          this.toast(`「${ev.text ?? ''}」节点达成 — 三选一（研究冻结中）`, '#ffb03d')
          break
        case 'card_chosen':
          this.toast(`已解锁「${ev.text ?? ''}」 · 环点亮新交点`, '#7fe0a0')
          break
        case 'window_warn': this.toast('引力窗口 10 秒后开启 — 准备发船', '#ffb03d'); break
        case 'window_open': this.toast('引力窗口开启：木卫二线 ×2 速 · 油耗减半', '#ffb03d'); audioSys.play('wc.ok'); break
        case 'window_close': this.toast('引力窗口关闭', '#6f8ba0'); break
        case 'flare_warn': this.toast('⚠ 事件预警：太阳耀斑 10 秒后来袭！', '#ff8f5a'); audioSys.play('wc.alarm'); break
        case 'flare_start':
          this.toast('☀ 太阳耀斑爆发：通讯中断，在途船失联', '#ff5a4a')
          audioSys.play('wc.flare')
          break
        case 'flare_end': this.toast('耀斑退去，幸存飞船恢复航行', '#9fc4d8'); break
        case 'frozen':
          this.toast(`${ev.value ?? 0} 艘飞船冻毁（150 H3 可重建）`, '#ff5a4a')
          audioSys.play('wc.bad')
          break
        case 'station_built': this.toast('补给站建成 —— 极寒护盾上线', '#7fdcff'); audioSys.play('wc.build'); break
        case 'station_upgraded': this.toast(`补给站升至 Lv${ev.value}`, '#7fdcff'); break
        case 'station_demolished': this.toast(`补给站拆除，返还 ${Math.round(ev.value ?? 0)} H3`, '#9fc4d8'); break
        case 'act2':
          this.toast('第二幕 · 复苏：木卫二 / 引力窗口 / 极寒停航启用，需求暴涨！', '#ffb03d')
          audioSys.play('wc.alarm')
          break
        case 'act3':
        case 'module_available':
          this.toast('第三幕 · 质变：火星已解锁 —— 运回环扩展模块，点亮全球环网！', '#ffe9a8')
          break
        case 'victory': audioSys.play('wc.win'); break
        case 'defeat': audioSys.play('wc.lose'); break
        default: break
      }
    }
    sc.events.length = 0
  }

  private toast(text: string, color = '#cfe3ee'): void {
    this.toasts.push({ text, color, age: 0 })
    if (this.toasts.length > 5) this.toasts.shift()
  }

  // ═══════════════════════════════════════════
  //  星图指针交互
  // ═══════════════════════════════════════════

  private stationAt(p: { x: number; y: number }): SimStation | null {
    for (const st of this.simState.state.stations) {
      if (dist(p.x, p.y, st.x, st.y) <= 26 + B.map.hitTolerance) return st
    }
    return null
  }

  private nodeAt(p: { x: number; y: number }): Endpoint | null {
    for (const star of Object.values(B.stars)) {
      if (!this.transport.starUnlocked(star.id)) continue
      const node = B.map.nodes[star.id]
      if (dist(p.x, p.y, node.x, node.y) <= node.r + B.map.hitTolerance) {
        return { kind: 'star', star: star.id }
      }
    }
    const e = B.map.nodes.earth
    if (dist(p.x, p.y, e.x, e.y) <= e.r + B.map.hitTolerance) return { kind: 'earth' }
    return null
  }

  private routeAt(p: { x: number; y: number }): SimRoute | null {
    for (const route of this.simState.state.routes) {
      const a = endpointPos(this.simState.state, route.from)
      const b = endpointPos(this.simState.state, route.to)
      if (segDist(p, a, b) <= B.map.routeHitDistance) return route
    }
    return null
  }

  onMapPointerDown(p: { x: number; y: number }): void {
    const s = this.simState.state
    if (s.outcome === 'defeat' || s.pendingCard) return
    const st = this.stationAt(p)
    if (st) { this.selection = { type: 'station', id: st.id }; return }
    const node = this.nodeAt(p)
    if (node) {
      const pos = endpointPos(s, node)
      this.drag = {
        fromEp: node, fromX: pos.x, fromY: pos.y,
        curX: p.x, curY: p.y, hoverEp: null, valid: false, label: '',
      }
      audioSys.play('wc.draw', { volume: 0.4 })
      return
    }
    const route = this.routeAt(p)
    if (route) { this.selection = { type: 'route', id: route.id }; return }
    this.selection = null
  }

  onMapPointerMove(p: { x: number; y: number }): void {
    const drag = this.drag
    if (!drag) return
    drag.curX = p.x
    drag.curY = p.y
    drag.hoverEp = this.nodeAt(p)
    drag.valid = drag.hoverEp ? this.dragValidity(drag.fromEp, drag.hoverEp) : false
    drag.label = drag.hoverEp ? this.dragLabel(drag.fromEp, drag.hoverEp, drag.valid) : ''
  }

  onMapPointerUp(p: { x: number; y: number }): void {
    const drag = this.drag
    if (!drag) return
    this.drag = null
    const hover = this.nodeAt(p)
    if (!hover) return
    const ok = this.transport.tryCreateRoute(drag.fromEp, hover)
    if (ok) {
      audioSys.play('wc.ok')
      const route = findRoute(this.simState.state, drag.fromEp, hover)
      if (route) this.selection = { type: 'route', id: route.id }
    } else {
      audioSys.play('wc.bad', { volume: 0.5 })
    }
  }

  /** 拖线视觉合法性（权威判定在 transport.tryCreateRoute） */
  private dragValidity(a: Endpoint, b: Endpoint): boolean {
    const s = this.simState.state
    const ka = a.kind, kb = b.kind
    if (ka === kb) return false
    if (s.tutorial) {
      const moon: Endpoint = { kind: 'star', star: 'moon' }
      const earth: Endpoint = { kind: 'earth' }
      return (this.epEq(a, moon) && this.epEq(b, earth)) || (this.epEq(a, earth) && this.epEq(b, moon))
    }
    if (ka === 'earth' && kb === 'star') return this.transport.starUnlocked((b as { star: StarId }).star)
    if (ka === 'star' && kb === 'earth') return this.transport.starUnlocked((a as { star: StarId }).star)
    if (ka === 'earth' && kb === 'station') return true
    if (ka === 'station' && kb === 'earth') return true
    return false
  }

  private epEq(a: Endpoint, b: Endpoint): boolean {
    return JSON.stringify(a) === JSON.stringify(b)
  }

  private dragLabel(a: Endpoint, b: Endpoint, valid: boolean): string {
    if (!valid) {
      if (a.kind === b.kind) return a.kind === 'star' ? '星—星航线不合法' : '不合法'
      const starEp = a.kind === 'star' ? a : b.kind === 'star' ? b : null
      if (starEp && starEp.kind === 'star') {
        const def = B.stars[starEp.star]
        return this.transport.starUnlocked(starEp.star) ? '不合法' : `${def.name}第${def.unlockAct}幕解锁`
      }
      return '不合法'
    }
    if (a.kind === 'earth' && b.kind === 'star') return this.forwardLabel(b.star)
    if (a.kind === 'star' && b.kind === 'earth') return this.forwardLabel(a.star)
    const cap = Math.round(cargoCap(this.simState.state.mods))
    return `载建材 ${cap} · 折算 ${(cap * B.materialH3PerUnit).toFixed(0)} H3`
  }

  private forwardLabel(star: StarId): string {
    const mods = this.simState.state.mods
    const load = Math.round(starLoad(mods, star))
    const fuel = Math.round(roundFuel(mods, B.stars[star].dist))
    return `单船 ${load}t · 油耗 ${fuel} · 净补 ${load - fuel}`
  }

  // ═══════════════════════════════════════════
  //  时间控制 / 重开
  // ═══════════════════════════════════════════

  togglePause(): void {
    this.paused = !this.paused
  }

  cycleSpeed(): void {
    this.timeScale = this.timeScale === 1 ? 2 : 1
  }

  restart(): void {
    refreshBalanceFromConfigs()
    this.simState.reset()
    this.selection = null
    this.drag = null
    this.fx.pulses.length = 0
    this.fx.floats.length = 0
    this.toasts.length = 0
  }

  /** 海克斯选卡（脚本按钮回调） */
  chooseCardByIndex(i: number): boolean {
    const pend = this.simState.state.pendingCard
    if (!pend) return false
    const ok = this.research.chooseCard(pend.choices[i])
    if (ok) audioSys.play('wc.ok', { volume: 0.8 })
    return ok
  }

  // ═══════════════════════════════════════════
  //  HUD 视图模型（UI 脚本每帧消费）
  // ═══════════════════════════════════════════

  buildViewModel(): WarmCurrentVM {
    const sc = this.simState
    const s = sc.state
    const fleet = {
      total: s.ships.length,
      idle: sc.idleShips,
      flying: sc.flyingShips,
      frozen: sc.frozenShips.length,
      building: s.buildQueue.length,
      buildRemain: s.buildQueue.length > 0 ? Math.ceil(s.buildQueue[0]) : 0,
    }
    const pending = s.pendingCard
      ? {
          lineName: s.research.find((l) => l.id === s.pendingCard!.line)?.name ?? '',
          cards: s.pendingCard.choices
            .map((id) => getCardDef(id))
            .filter((c): c is CardDef => !!c),
        }
      : null
    let routeInfo: HudRouteInfo | null = null
    if (this.selection?.type === 'route') {
      const route = s.routes.find((r) => r.id === this.selection!.id)
      if (route) {
        const star = starOfEndpoint(s, route.from) ?? starOfEndpoint(s, route.to)
        routeInfo = {
          name: route.direction === 'forward' ? `${star ? B.stars[star].name : '?'}线` : '补给站供应线',
          direction: route.direction,
          ships: route.shipIds.length,
          net: routeNetPerTrip(s, route),
          cycle: routeCycleSeconds(s, route),
          canBuildStation: route.direction === 'forward' && s.mods.stationUnlocked
            && !s.stations.some((st) => st.routeId === route.id) && s.flare.phase !== 'active',
        }
      }
    }
    let stationInfo: HudStationInfo | null = null
    if (this.selection?.type === 'station') {
      const st = s.stations.find((x) => x.id === this.selection!.id)
      if (st) {
        stationInfo = {
          level: st.level,
          radius: B.station.radius[st.level],
          cap: B.station.shipCap[st.level],
          stock: st.stock,
          need: st.need,
          canUpgrade: st.level >= 1 && st.level < 3 && st.stock >= B.station.upgradeMaterials[st.level + 1],
          nextNeed: st.level === 0 ? st.need : st.level >= 3 ? 0 : B.station.upgradeMaterials[st.level + 1],
        }
      }
    }
    const demand = sc.demand
    return {
      time: s.time,
      act: s.act,
      actName: s.act === 1 ? '求生' : s.act === 2 ? '复苏' : '质变',
      nodes: s.nodes,
      continuity: s.continuity,
      ring: s.ring,
      bufferLeft: s.bufferLeft,
      bufferTotal: s.bufferTotal,
      reserve: s.earthH3,
      demand,
      ocCost: sc.overclockCost,
      netFlow: estimateNetFlow(s, demand),
      danger: s.ring === 'running' && demand > 0 && s.earthH3 < demand * B.dangerReserveSeconds,
      windowPhase: s.gravity.phase,
      windowRemain: Math.max(0, Math.ceil(s.gravity.timer)),
      flarePhase: s.flare.phase,
      flareRemain: s.flare.phase === 'active' ? Math.ceil(s.flare.timer) : Math.max(0, Math.ceil(s.flare.nextIn)),
      fleet,
      research: s.research.map((l) => ({ id: l.id, name: l.name, progress: l.progress, oc: s.overclocked.includes(l.id) })),
      pending,
      routeInfo,
      stationInfo,
      tutorial: s.tutorial,
      paused: this.paused,
      timeScale: this.timeScale,
      moduleState: s.module.state,
      canStartMission: s.act >= 3 && s.module.state === 'available' && sc.idleShips > 0 && s.flare.phase !== 'active',
      outcome: s.outcome,
      sandbox: s.sandbox,
      stats: { delivered: s.stats.delivered, frozen: s.stats.frozenCount, stations: s.stats.stationsBuilt, cards: s.stats.cardsTaken },
    }
  }
}
