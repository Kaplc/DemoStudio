/**
 * WarmCurrentGameMode — 游戏规则胶水（hoi4 base/ 架构位）
 *
 * 仿真子系统全部做成 GameMode 上的引擎组件（对齐 SpawnComponent/CameraComponent 惯例）：
 * simState（状态+快照）/ transport（航线飞船）/ economy（焚烧衰减）/ research（研究海克斯）
 * / hazards（引力窗口+耀斑）/ stations（补给站）/ acts（三幕）+ sim（总控编排器）。
 * HUD 不在此构建（HUDClass 指向 hud.widget.json，由 gameplay/ui/*.script.ts 消费 buildViewModel）。
 * 指针事件经 WarmCurrentPlayerController 进来后做节点/航线几何命中，转成组件指令。
 * 太阳系取景：SolarCameraActor 云台（滚轮缩放 + 右键/边缘平移）+ sol GM 命令聚焦天体。
 * Esc：togglePauseMenu 呼出/关闭暂停菜单（存档槽 + 继续 + 回主菜单），打开时强制暂停。
 */
import { CameraComponent, GameMode, Instantiate, SphereMeshComponent, audioSys, logger } from '@/engine'
import { makeStarTexture } from '../map/starTextures'
import { B, MAP_H, MAP_W, toWX, toWZ, refreshBalanceFromConfigs } from '../core/balance'
import type { SolarFocusBody } from '../core/balance'
import type { CardDef } from '../core/balance'
import { getCardDef } from '../core/cards'
import { restoreSimState } from '../core/save'
import {
  cargoCap, estimateNetFlow, endpointPos, findRoute, roundFuel, routeCycleSeconds,
  routeNetPerTrip, starLoad, starOfEndpoint, starPosAt, stationAnchorPos,
  TUTORIAL_TARGETS,
} from '../core/helpers'
import type { Endpoint, SimRoute, SimStation, StarId } from '../core/types'
import { StarMapRenderComponent } from '../map/StarMapRenderComponent'
import { SolarCameraActor } from '../map/SolarCameraActor'
import { STAR_BLUEPRINTS, type StarBodyId } from '../map/StarActor'
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

/** 暂停菜单 widget 资产（Esc 呼出，动态 spawn/destroy） */
const PAUSE_MENU_WIDGET = 'asset/blueprints/ui/pause_menu.widget.json'

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

  /** 太阳系云台相机（滚轮缩放 + 右键/边缘平移；群星式） */
  readonly cameraActor: SolarCameraActor
  /** 兼容旧引用（HUD/UI 脚本读 gameCamera.camera）：直接暴露云台上的 CameraComponent */
  readonly gameCamera: CameraComponent

  starMap: StarMapRenderComponent | null = null

  /** 星图天体蓝图 Actor（BeginPlay 经 Instantiate 生成，Tick 每帧 syncFrom；渲染组件经 provider 只读消费） */
  readonly starActors = new Map<StarBodyId, import('@/engine').Actor>()

  drag: DragState | null = null
  selection: MapSelection = null
  fx: MapFx = { pulses: [], floats: [] }

  paused = false
  timeScale: 1 | 2 = 1
  /** 星图视角模式：earth = 地球系跟随取景（开局默认），solar = 太阳系全景 */
  viewMode: 'earth' | 'solar' = 'earth'

  /** 事件 toast 队列（HudScript 每帧消费渲染） */
  toasts: Array<{ text: string; color: string; age: number }> = []

  /** 暂停菜单面板（Esc 动态 spawn 的 UI Actor；null = 关闭） */
  pauseMenuPanel: import('@/engine').Actor | null = null

  /** HUD widget 资产（PC.ClientSetHUD 链自动创建，脚本挂根节点） */
  override HUDClass = HUD_WIDGET

  constructor() {
    super()
    // 太阳系云台相机（3D 标准）：fov 50，缩放边界随视图模式切换（applyViewMode：地球系 80~520 / 太阳系 60~12000）
    // 相机 Actor 构造但不托管：由 BeginPlay 的 spawnActor 交给 World（hoi4 同款）
    this.cameraActor = new SolarCameraActor(MAP_W, MAP_H)
    this.gameCamera = this.cameraActor.cameraComponent
  }

  override InitGame(): void {
    // 配置表覆盖默认值 + 重置仿真状态（改表重开一局即生效）
    refreshBalanceFromConfigs()
    this.simState.reset()
    super.InitGame()
    this.cameraManager.RegisterCamera(this.gameCamera)
    this.cameraActor.place()
    // 开局即地球系取景：只看地月小星系（其余星球未解锁，全景留给右下角视角切换）
    this.focusSolarSystem('earth')
    logger.info('[WarmCurrent] 开局取景：地球系（地月小星系）')
  }

  override spawnPlayerInternal() {
    const controller = new WarmCurrentPlayerController(this)
    // 装配期：相机云台接输入（滚轮缩放 + 右键拖拽平移；规范 §2.5 唯一例外现场，hoi4 同款）
    this.cameraActor.rig.bindInput(controller.inputComponent)
    // Esc：呼出/关闭暂停菜单（存档槽 + 继续 + 回主菜单）
    controller.inputComponent.BindAction('wc-pause-menu', 'Escape', 'pressed', () => this.togglePauseMenu())
    return { controller, pawn: new WarmCurrentPawn() }
  }

  override BeginPlay(): void {
    super.BeginPlay()
    if (!this.world) return
    // 太阳系云台相机交给 World 托管（构造期不托管；spawn 后 rig.BeginPlay 才能查到相机组件）
    this.world.actorMgr.SpawnActor(this.cameraActor)
    registerWarmCurrentAudio()
    // 天体蓝图 Actor 先生成（渲染组件 BeginPlay 即 buildNodes，需读 starActors 接管 mesh 引用）
    this.spawnStarActors()
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
    // 天体位置自驱动（蓝图 Actor：位置 = starPosAt 纯函数 + 自转；暂停时 dt=0 只保持位置）
    const sdt = this.paused ? 0 : dt * this.timeScale
    for (const sa of this.starActors.values()) (sa as import('../map/StarActor').StarActor).syncFrom(this.simState.state, sdt)
    // 地球系跟随视角：target 每帧贴地球实时位置（与 syncFrom 同一时间轴，零相对漂移；保留用户缩放偏移）
    if (this.viewMode === 'earth') {
      const e = starPosAt(this.simState.state, 'earth')
      this.cameraActor.rig.target.set(toWX(e.x), 0, toWZ(e.y))
      this.cameraActor.SyncToActor()
    }
    this.starMap?.render(this.paused ? 0 : dt * this.timeScale, this.gameCamera.camera)
  }

  // ═══════════════════════════════════════════
  //  星图天体蓝图 Actor（外观资产化：.blueprint.json）
  // ═══════════════════════════════════════════

  /** 生成 5 个天体蓝图 Actor；单张失败（未注册/lint 错）回退代码生成该天体，星图不缺星 */
  private spawnStarActors(): void {
    if (!this.world) return
    for (const [body, path] of Object.entries(STAR_BLUEPRINTS) as Array<[StarBodyId, string]>) {
      const actor = Instantiate(path)
      if (actor) {
        // 程序化贴图（无 DOM canvas 环境自动跳过，保持蓝图纯色）
        const mesh = actor.getComponent(SphereMeshComponent)
        const tex = makeStarTexture(body)
        if (mesh && tex) mesh.setTexture(tex)
        this.starActors.set(body, actor)
        logger.info(`[WarmCurrent] 天体生成 ${body} ← ${path}${tex ? '（程序化贴图）' : ''}`)
      } else {
        logger.error(`[WarmCurrent] 天体蓝图生成失败，该天体缺失（检查 assetLint）：${path}`)
      }
    }
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
  //  太阳系取景（sol GM 命令 + 缩放相机）
  // ═══════════════════════════════════════════

  /** 地球系视图缩放范围（min/max 距离）：独立小星系取景（月球轨道 120：特写 80 ~ 全景 520） */
  private static readonly EARTH_VIEW_MIN_DIST = 80
  private static readonly EARTH_VIEW_MAX_DIST = 520

  /** 聚焦指定天体：实时轨道位置 + 取景距离档位（规则决策），机位数学在 SolarCameraActor.focusOn */
  focusSolarSystem(body: SolarFocusBody): void {
    const p = starPosAt(this.simState.state, body)
    // 取景距离随星体尺寸：太阳 480（中景看轨道），地球 320（月球环 120 全入画留边），月球/木卫二/火星 220
    const d = body === 'sun' ? 480 : body === 'earth' ? 320 : 220
    // 太阳 = 全景取景（退出跟随）；其余天体 = 对应系跟随取景（随该天体公转）
    this.viewMode = body === 'sun' ? 'solar' : 'earth'
    this.applyViewMode()
    this.cameraActor.focusOn(toWX(p.x), toWZ(p.y), d)
    logger.info(`[WarmCurrent] 太阳系取景 → ${body} (dist=${d}, mode=${this.viewMode})`)
  }

  /** 视图模式 → 相机缩放边界（视图隔离：地球系锁死地月尺度，滚轮拉远也只见地月） */
  private applyViewMode(): void {
    const solar = this.viewMode === 'solar'
    const rig = this.cameraActor.rig
    rig.minDistance = solar ? 60 : WarmCurrentGameMode.EARTH_VIEW_MIN_DIST
    rig.maxDistance = solar ? 12000 : WarmCurrentGameMode.EARTH_VIEW_MAX_DIST
    // 星图渲染分组同步切换（其它行星/轨道/太阳光晕显隐）
    this.starMap?.setViewMode(this.viewMode)
    logger.info(`[WarmCurrent] 视图隔离：${solar ? '太阳系全景（缩放 60~12000）' : `地球系小星系（缩放 ${WarmCurrentGameMode.EARTH_VIEW_MIN_DIST}~${WarmCurrentGameMode.EARTH_VIEW_MAX_DIST}，只见地月）`}`)
  }

  /** 视角切换（ViewToggle widget 按钮）：earth = 地球系跟随，solar = 太阳系全景 */
  setViewMode(mode: 'earth' | 'solar'): void {
    this.focusSolarSystem(mode === 'earth' ? 'earth' : 'sun')
  }

  override EndPlay(): void {
    // 相机 Actor 是 GameMode 自建自管的（非场景资产节点），销毁时走 Actor 统一销毁
    // （已托管 → World 销毁队列；未托管 → 本地 EndPlay，hoi4 同款）
    this.cameraActor.destroy()
    super.EndPlay()
  }

  // ═══════════════════════════════════════════
  //  星图指针交互
  // ═══════════════════════════════════════════

  private stationAt(p: { x: number; y: number }): SimStation | null {
    const s = this.simState.state
    for (const st of s.stations) {
      const anchor = stationAnchorPos(s, st)
      if (dist(p.x, p.y, anchor.x, anchor.y) <= 26 + B.map.hitTolerance) return st
    }
    return null
  }

  /** 太阳命中（点击聚焦取景，不参与航线端点/拖拽） */
  private sunAt(p: { x: number; y: number }): boolean {
    const s0 = B.map.nodes.sun
    return dist(p.x, p.y, s0.x, s0.y) <= s0.r + B.map.hitTolerance
  }

  private nodeAt(p: { x: number; y: number }): Endpoint | null {
    const s = this.simState.state
    for (const star of Object.values(B.stars)) {
      if (!this.transport.starUnlocked(star.id)) continue
      const node = starPosAt(s, star.id)
      if (dist(p.x, p.y, node.x, node.y) <= B.map.nodes[star.id].r + B.map.hitTolerance) {
        return { kind: 'star', star: star.id }
      }
    }
    const e = starPosAt(s, 'earth')
    if (dist(p.x, p.y, e.x, e.y) <= B.map.nodes.earth.r + B.map.hitTolerance) return { kind: 'earth' }
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
    // 太阳：点击聚焦取景（不参与航线/选择）
    if (this.sunAt(p)) {
      this.focusSolarSystem('sun')
      audioSys.play('wc.ok', { volume: 0.4 })
      return
    }
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
      // 引导端点取 core 单一数据源（权威判定在 transport.tryCreateRoute，此处只做视觉镜像）
      const [tutStar, tutPlanet] = TUTORIAL_TARGETS
      const starEp: Endpoint = { kind: 'star', star: tutStar }
      const planetEp: Endpoint = { kind: tutPlanet }
      return (this.epEq(a, starEp) && this.epEq(b, planetEp)) || (this.epEq(a, planetEp) && this.epEq(b, starEp))
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

  // ═══════════════════════════════════════════
  //  暂停菜单（pause_menu.widget.json，Esc 呼出）
  // ═══════════════════════════════════════════

  /** Esc 切换暂停菜单 */
  togglePauseMenu(): boolean {
    if (this.pauseMenuPanel) {
      this.closePauseMenu()
      return false
    }
    this.openPauseMenu()
    return true
  }

  /** 打开暂停菜单（动态 spawn；强制暂停仿真，关闭时若非胜负终局恢复运行） */
  openPauseMenu(): void {
    const w = this.world
    if (!w || this.pauseMenuPanel) return
    const panel = w.ui.spawnUIActor(PAUSE_MENU_WIDGET)
    if (!panel) {
      logger.error('[WarmCurrent] 暂停菜单生成失败')
      return
    }
    this.pauseMenuPanel = panel
    this.paused = true
    logger.info('[WarmCurrent] 打开暂停菜单（仿真冻结）')
  }

  /** 关闭暂停菜单（继续按钮 / 再按 Esc / 读档成功后） */
  closePauseMenu(): void {
    if (!this.pauseMenuPanel) return
    this.pauseMenuPanel.destroy()
    this.pauseMenuPanel = null
    // 胜负终局时仿真仍保持冻结（结算弹窗接管）；仅正常暂停时恢复运行
    const s = this.simState.state
    if (s.outcome === 'playing' || s.sandbox) this.paused = false
    logger.info('[WarmCurrent] 关闭暂停菜单')
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

  /**
   * 从存档恢复仿真状态（GameInstance.loadSlot 调用）。
   * 校验 + 深拷贝 + 按 seed 重放 rng；清理拖拽/选中残留；坏档拒绝并返回 false。
   */
  restoreFromSave(sim: import('../core/types').SimState): { state: import('../core/types').SimState; rng: () => number } | null {
    const pack = restoreSimState(sim)
    if (!pack) return null
    this.simState.state = pack.state
    this.simState.rng = pack.rng
    this.selection = null
    this.drag = null
    this.fx.pulses.length = 0
    this.fx.floats.length = 0
    this.toasts.length = 0
    // 恢复后按新档状态决定运行/冻结（与 closePauseMenu 同规则：playing/sandbox 恢复运行，胜负终局保持冻结）
    if (pack.state.outcome === 'playing' || pack.state.sandbox) this.paused = false
    logger.info(`[WarmCurrent] 存档恢复完成（act=${pack.state.act} time=${pack.state.time.toFixed(0)}s）`)
    return pack
  }

  /** 海克斯选卡（脚本按钮回调） */
  chooseCardByIndex(i: number): boolean {
    const pend = this.simState.state.pendingCard
    if (!pend) return false
    const ok = this.research.chooseCard(pend.choices[i])
    if (ok) audioSys.play('wc.ok', { volume: 0.8 })
    return ok
  }

  /** 重开海克斯三选一弹窗（HUD 徽标回调）：仅在有 pendingCard 时有效（隐藏 ≠ 放弃，待卡不弃） */
  reopenHexModal(): boolean {
    const s = this.simState.state
    if (!s.pendingCard) return false
    if (s.hexHiddenAt === null) return true
    s.hexHiddenAt = null
    // 重开 = 新一轮决策窗口：倒计时基准刷新为当前时刻（否则超时很久后重开会一帧内被秒收）
    s.pendingCard.since = s.time
    logger.info('[WarmCurrent] 海克斯弹窗重开（待选继续，重新计时）')
    return true
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
    // pending 折算：pendingCard 存在但已自动收纳（hexHiddenAt 非 null）时不进入 VM（弹窗隐藏）
    const pending = s.pendingCard && s.hexHiddenAt === null
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
