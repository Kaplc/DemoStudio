/**
 * WarmCurrentGameMode — 游戏规则胶水（hoi4 base/ 架构位）
 *
 * 仿真子系统全部做成 GameMode 上的引擎组件（对齐 SpawnComponent/CameraComponent 惯例）：
 * simState（状态+快照）/ transport（航线飞船）/ economy（焚烧衰减）/ research（研究海克斯）
 * / hazards（引力窗口+耀斑）/ buildings（地图建筑：建造面板选型→星图网格放置）/ acts（三幕）+ sim（总控编排器）。
 * HUD 不在此构建（HUDClass 指向 hud.widget.json，由 gameplay/ui/*.script.ts 消费 buildViewModel）。
 * 指针事件经 WarmCurrentPlayerController 进来后做节点/航线几何命中，转成组件指令；
 * 建筑模式（buildMode）下指针变为放置：网格吸附预览 + 点击落位（Esc 取消，优先于暂停菜单）。
 * 太阳系取景：SolarCameraActor 云台（滚轮缩放 + 右键/边缘平移）+ sol GM 命令聚焦天体。
 * Esc：togglePauseMenu 呼出/关闭暂停菜单（存档槽 + 继续 + 回主菜单），打开时强制暂停。
 */
import { CameraComponent, GameMode, Instantiate, SphereMeshComponent, audioSys, logger } from '@/engine'
import { makeStarTexture } from '../map/starTextures'
import { B, MAP_H, MAP_W, toWX, toWZ, refreshBalanceFromConfigs } from '../core/balance'
import type { BuildingDef, SolarFocusBody } from '../core/balance'
import type { CardDef } from '../core/balance'
import type { PlanetId } from '../core/types'
import type { SolarBodyId } from '../core/helpers'
import { getCardDef } from '../core/cards'
import { restoreSimState } from '../core/save'
import {
  alignMoonRelativeAngle, buildingByEndpoint, buildingDefOf, estimateNetFlow, endpointPos, findRoute, ledgerTotals,
  fleetMaintPerS, moonRelativeAngle, resetMoonPhaseAdj, ringLevelOf, roundFuel, routeCycleSeconds, snapToGrid,
  routeNetPerTrip, starLoad, starOfEndpoint, starPosAt,
  TUTORIAL_TARGETS,
} from '../core/helpers'
import type { RingLevelInfo } from '../core/helpers'
import type { Endpoint, SimBuilding, SimLedger, SimRoute, StarId } from '../core/types'
import { StarMapRenderComponent, planetStageOffset } from '../map/StarMapRenderComponent'
import { SolarCameraActor } from '../map/SolarCameraActor'
import { STAR_BLUEPRINTS, type StarBodyId } from '../map/StarActor'
import type { BuildCursor, DragState, MapFx, MapSelection } from '../map/StarMapRenderComponent'
import { SimStateComponent } from '../systems/SimStateComponent'
import { TransportComponent } from '../systems/TransportComponent'
import { EconomyComponent } from '../systems/EconomyComponent'
import { ResearchComponent } from '../systems/ResearchComponent'
import { HazardsComponent } from '../systems/HazardsComponent'
import { BuildingsComponent } from '../systems/BuildingsComponent'
import { ActsComponent } from '../systems/ActsComponent'
import { SimulationComponent } from '../systems/SimulationComponent'
import { WarmCurrentPlayerController } from './WarmCurrentPlayerController'
import { WarmCurrentPawn } from './WarmCurrentPawn'
import { registerWarmCurrentAudio } from './audio'

/** 暂停菜单 widget 资产（Esc 呼出，动态 spawn/destroy） */
const PAUSE_MENU_WIDGET = 'asset/blueprints/ui/pause_menu.widget.json'

/** 视图切换加载遮罩（地球系/太阳系跃迁过渡，动态 spawn/destroy） */
const VIEW_LOADING_WIDGET = 'asset/blueprints/ui/view_loading.widget.json'

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
}

export interface HudBuildingInfo {
  id: number
  type: string
  /** 建筑名（building 表） */
  name: string
  /** 功能半径（护盾建筑 > 0） */
  radius: number
  /** 护盾保全容量 */
  cap: number
  /** 缓存物资/上限（非缓存建筑 cap=0） */
  stock: number
  bufferCap: number
  canDemolish: boolean
}

/** 建造面板行（building 表驱动，build_panel.widget 消费） */
export interface HudBuildRow {
  /** 建筑类型 id（building 表行键；放置按钮参数） */
  id: string
  name: string
  desc: string
  /** 放置造价（H3） */
  cost: number
  /** 当前可放置（预算足 & 非耀斑 & 对局进行中） */
  canPlace: boolean
}

/** 运输面板船行（transport_panel.widget 消费，最多展示 SHIP_ROWS 行） */
export interface HudShipRow {
  id: number
  name: string
  state: import('../core/types').ShipState
  /** 位置描述（「基地待命」「去程 · 月球线」「冻毁」等） */
  place: string
  cargo: number
  materials: number
  /** 冻毁可重建 */
  canRebuild: boolean
}

/** 航线管理面板行（routes_panel.widget 消费，全部航线的紧凑视图） */
export interface HudRouteRow {
  id: number
  /** 行名（正向「月球线」，反向「供应线·木卫二」） */
  name: string
  direction: 'forward' | 'reverse'
  /** 在线配船数 */
  ships: number
  /** 单趟净补（正向 t）/ 单趟载建材（反向） */
  net: number
  /** 往返时长（秒，展示用） */
  cycle: number
}

export interface WarmCurrentVM {
  time: number
  act: 1 | 2 | 3
  nodes: number
  /** 聚能环等级（按已覆盖交点数分阶，模块 03 §5；level 4 = 终局全球环网） */
  ringLevel: RingLevelInfo
  continuity: number
  ring: 'running' | 'decaying'
  bufferLeft: number
  bufferTotal: number
  reserve: number
  demand: number
  /** 研究点数计费速率（H3/秒，五线合计；断环/储量耗尽为 0） */
  researchCost: number
  netFlow: number
  danger: boolean
  windowPhase: 'idle' | 'warn' | 'active'
  windowRemain: number
  flarePhase: 'idle' | 'warn' | 'active'
  flareRemain: number
  /** 舰队维护费速率（H3/秒，按总船数查 fleet_maint 阶梯；从地球储备持续扣除） */
  fleet: { total: number; idle: number; flying: number; frozen: number; building: number; buildRemain: number; maintPerS: number }
  /** H3 收支账本（对局累计 + income/expense/net 合计，统计面板消费） */
  ledger: SimLedger & { income: number; expense: number; net: number }
  /** 五线研究行（points = 已分配点数，rate = 该线当前 H3 消耗速率） */
  research: Array<{ id: string; name: string; progress: number; points: number; rate: number }>
  /** 可用研究点（聚能环等级 − 已分配，科研面板 +/− 分配） */
  researchUnspent: number
  pending: { lineName: string; cards: CardDef[] } | null
  routeInfo: HudRouteInfo | null
  buildingInfo: HudBuildingInfo | null
  /** 建造面板行（building 表顺序） */
  buildRows: HudBuildRow[]
  /** 建筑模式当前选型（building 表行键；null = 非建筑模式） */
  buildActive: string | null
  /** 运输面板船行（截断到面板行池容量，超出部分 UI 用「另有 N 艘」提示） */
  shipRows: HudShipRow[]
  /** 航线管理面板行（全部航线，RoutesPanelScript 消费） */
  routes: HudRouteRow[]
  /** 造船/重建造价（面板按钮标签用，配置表驱动防硬编码漂移） */
  shipBuildCost: number
  shipRebuildCost: number
  tutorial: boolean
  paused: boolean
  timeScale: number
  moduleState: 'locked' | 'available' | 'mission' | 'delivered'
  canStartMission: boolean
  outcome: 'playing' | 'victory' | 'defeat'
  sandbox: boolean
  stats: { delivered: number; frozen: number; buildings: number; cards: number }
}

export class WarmCurrentGameMode extends GameMode {
  /** 仿真子系统组件（对齐引擎 SpawnComponent/CameraComponent 惯例，挂在 GameMode 上） */
  readonly simState: SimStateComponent = this.addComponent(SimStateComponent)
  readonly transport: TransportComponent = this.addComponent(TransportComponent)
  readonly economy: EconomyComponent = this.addComponent(EconomyComponent)
  readonly research: ResearchComponent = this.addComponent(ResearchComponent)
  readonly hazards: HazardsComponent = this.addComponent(HazardsComponent)
  /** 地图建筑（建造面板选型 → 星图自由放置） */
  readonly buildings: BuildingsComponent = this.addComponent(BuildingsComponent)
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

  /** 建筑模式（建造面板选型后进入：星图网格线 + 吸附预览，点击落位 / Esc 取消） */
  buildMode: { typeId: string } | null = null
  /** 建筑模式光标（网格吸附后画布系坐标 + 合法性，渲染 ghost 消费） */
  buildCursor: BuildCursor | null = null

  paused = false
  timeScale: 1 | 2 = 1
  /** 星图视角模式：earth = 行星系跟随取景（聚焦 planetFocusBody，开局默认地球系），solar = 太阳系全景 */
  viewMode: 'earth' | 'solar' = 'earth'
  /** 行星系视角当前聚焦的行星（viewMode='earth' 时生效；太阳系全景忽略） */
  planetFocusBody: SolarBodyId = 'earth'
  /** 离开地球系时记录的月球相对相位（rad；null = 无待回拨），切回地球系时对齐用 */
  private moonAngleAtLeave: number | null = null
  /** 视图切换进行中（加载遮罩已上屏、镜头尚未跳转）：期间忽略重复切换（e2e 桥只读） */
  viewSwitching = false
  /** 当前加载遮罩面板（null = 无；e2e 断言切换收尾后必须归零） */
  viewLoadingPanel: import('@/engine').Actor | null = null

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
    // Esc：建筑模式中先取消放置（不误开暂停菜单），否则呼出/关闭暂停菜单（存档槽 + 继续 + 回主菜单）
    controller.inputComponent.BindAction('wc-pause-menu', 'Escape', 'pressed', () => {
      if (this.buildMode) {
        this.cancelBuildMode()
        return
      }
      this.togglePauseMenu()
    })
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
    // 行星系视角的渲染坐标变换：聚焦行星钉在舞台中心（像太阳一样固定），其余天体按与它的
    // 真实相对位置贴放（卫星像行星一样绕它转）——纯显示变换，仿真数据不动
    const sdt = this.paused ? 0 : dt * this.timeScale
    if (this.viewMode === 'earth') {
      const f = starPosAt(this.simState.state, this.planetFocusBody)
      const stage = planetStageOffset(this.planetFocusBody as PlanetId)
      const ox = stage.x - toWX(f.x)
      const oz = stage.z - toWZ(f.y)
      for (const sa of this.starActors.values()) (sa as import('../map/StarActor').StarActor).syncFrom(this.simState.state, sdt, ox, oz)
      // rig.target 已由 focusOn 一次性定到舞台中心（舞台静态：行星钉死），这里禁止逐帧复位：
      // rig.pan 成对移动 target 与相机，若只把 target 拉回舞台而相机留在原位，
      // 下次拖拽的 lookAt 会把镜头掰向舞台中心——右键平移退化成绕行星旋转
    } else {
      for (const sa of this.starActors.values()) (sa as import('../map/StarActor').StarActor).syncFrom(this.simState.state, sdt)
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
        case 'building_built':
          if (ev.x !== undefined && ev.y !== undefined) {
            this.fx.pulses.push({ x: ev.x, y: ev.y, age: 0 })
            this.fx.floats.push({ text: `-${ev.value}`, x: ev.x, y: ev.y - 30, age: 0 })
          }
          this.toast(`「${ev.text ?? '建筑'}」已放置 —— 可从星图拖线链接`, '#7fdcff')
          audioSys.play('wc.build')
          break
        case 'building_demolished':
          if (ev.x !== undefined && ev.y !== undefined) this.fx.pulses.push({ x: ev.x, y: ev.y, age: 0 })
          this.toast(`建筑拆除，返还 ${Math.round(ev.value ?? 0)} H3`, '#9fc4d8')
          break
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

  /** 聚焦指定天体：太阳 = 太阳系全景；行星 = 进入其行星系（跟随取景）。机位数学在 SolarCameraActor.focusOn */
  focusSolarSystem(body: SolarFocusBody): void {
    const toSolar = body === 'sun'
    // 月球相位对齐（仅地月系）：离开地月系时记录相位，切回地月系（含从其它行星系切回）时拨回
    const leavingEarthSys = this.viewMode === 'earth' && this.planetFocusBody === 'earth'
    const enteringEarthSys = !toSolar && body === 'earth'
    if (leavingEarthSys && !enteringEarthSys) this.moonAngleAtLeave = moonRelativeAngle(this.simState.state)
    if (enteringEarthSys && this.moonAngleAtLeave !== null) {
      alignMoonRelativeAngle(this.simState.state, this.moonAngleAtLeave)
      this.moonAngleAtLeave = null
    }
    if (!toSolar) this.planetFocusBody = body
    this.viewMode = toSolar ? 'solar' : 'earth'
    this.applyViewMode()
    // 取景距离随星体尺寸：太阳 480（中景看轨道），地球 320（月球环 120 全入画留边），其余行星 220
    const d = body === 'sun' ? 480 : body === 'earth' ? 320 : 220
    // 行星系取景目标 = 舞台中心（行星会被渲染钉在舞台中心，镜头只是切区）
    const off = this.viewMode === 'earth' ? planetStageOffset(this.planetFocusBody as PlanetId) : { x: 0, z: 0 }
    this.cameraActor.focusOn(off.x, off.z, d)
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

  /** 视角切换（ViewToggle widget 按钮）：earth = 地球系（行星系），solar = 太阳系全景 */
  setViewMode(mode: 'earth' | 'solar'): void {
    if (mode === 'solar') this.switchView('solar')
    else this.enterPlanetSystem('earth')
  }

  /** 双击行星进入其行星系（加载遮罩过渡；已在同一行星系则忽略） */
  enterPlanetSystem(body: SolarBodyId): void {
    if (this.viewMode === 'earth' && this.planetFocusBody === body) return
    this.switchView(body)
  }

  /** 统一视图切换：加载遮罩先上屏（盖住舞台搬移/镜头跳转防穿帮），下一拍再切 */
  private switchView(target: 'solar' | SolarBodyId): void {
    if (this.viewSwitching) return
    if (target === 'solar' && this.viewMode === 'solar') return
    this.viewSwitching = true
    const panel = this.world?.ui.spawnUIActor(VIEW_LOADING_WIDGET) ?? null
    this.viewLoadingPanel = panel
    if (!panel) logger.warn('[WarmCurrent] 视图切换加载遮罩生成失败，退化为硬切')
    window.setTimeout(() => {
      try {
        this.focusSolarSystem(target === 'solar' ? 'sun' : target)
      } finally {
        // 遮罩销毁失败不得卡死 viewSwitching（否则后续所有切换永久失灵）
        try { panel?.destroy() } catch (e) { logger.error(`[WarmCurrent] 加载遮罩销毁失败：${e}`) }
        this.viewLoadingPanel = null
        this.viewSwitching = false
      }
    }, 450)
  }

  override EndPlay(): void {
    // 相机 Actor 是 GameMode 自建自管的（非场景资产节点），销毁时走 Actor 统一销毁
    // （已托管 → World 销毁队列；未托管 → 本地 EndPlay，hoi4 同款）
    this.cameraActor.destroy()
    super.EndPlay()
  }

  // ═══════════════════════════════════════════
  //  建筑模式（建造面板选型 → 星图网格放置）
  // ═══════════════════════════════════════════

  /** 进入建筑模式（建造面板「放置」按钮；预算校验通过才进入） */
  enterBuildMode(typeId: string): boolean {
    const def = buildingDefOf(typeId)
    if (!def) return false
    const s = this.simState.state
    if (s.outcome !== 'playing' && !s.sandbox) return false
    if (s.earthH3 < def.cost) { this.simState.hint(`H3 不足（需 ${def.cost}）`); return false }
    this.buildMode = { typeId }
    this.buildCursor = null
    this.drag = null
    logger.info(`[WarmCurrent] 建筑模式：${def.name}（点击星图落位，Esc 取消）`)
    return true
  }

  /** 退出建筑模式（落位成功 / Esc / 面板关闭） */
  cancelBuildMode(): void {
    if (!this.buildMode) return
    this.buildMode = null
    this.buildCursor = null
    logger.info('[WarmCurrent] 建筑模式退出')
  }

  // ═══════════════════════════════════════════
  //  星图指针交互
  // ═══════════════════════════════════════════

  private buildingAt(p: { x: number; y: number }): SimBuilding | null {
    const s = this.simState.state
    for (const b of s.buildings) {
      if (dist(p.x, p.y, b.x, b.y) <= 26 + B.map.hitTolerance) return b
    }
    return null
  }

  /** 太阳命中（点击聚焦取景，不参与航线端点/拖拽） */
  /**
   * 当前视图的世界位移（世界坐标 → 地图画布坐标须减去）：
   * 行星系视角 = 舞台位移（stage - 聚焦行星画布系中心，与渲染 syncStage/StarActor.syncFrom 同口径）；
   * 太阳系全景 = 0（世界原点即地图中心）。PlayerController 指针拾取共用，改口径须两边同步。
   */
  viewStageOffset(): { x: number; z: number } {
    if (this.viewMode !== 'earth') return { x: 0, z: 0 }
    const stage = planetStageOffset(this.planetFocusBody as PlanetId)
    const f = starPosAt(this.simState.state, this.planetFocusBody)
    return { x: stage.x - toWX(f.x), z: stage.z - toWZ(f.y) }
  }

  private sunAt(p: { x: number; y: number }): boolean {
    const s0 = B.map.nodes.sun
    return dist(p.x, p.y, s0.x, s0.y) <= s0.r + B.map.hitTolerance
  }

  /** 双击判定状态（行星系入口）：最近一次点中的行星 + 时刻 */
  private lastPlanetClick: { body: PlanetId | null; t: number } = { body: null, t: 0 }

  /** 行星本体命中（含未解锁装饰行星；太阳与卫星不参与双击进入行星系）。
   *  ⚠ 用 starPosAt 实时公转位置判定（渲染在哪就点哪）；布局坐标只在开局重合，玩一会儿必然 miss。 */
  private planetAt(p: { x: number; y: number }): PlanetId | null {
    const s = this.simState.state
    for (const body of Object.keys(B.map.nodes) as Array<keyof typeof B.map.nodes>) {
      if (body === 'sun') continue
      if (B.map.moons[body as keyof typeof B.map.moons]) continue
      const n = starPosAt(s, body)
      if (dist(p.x, p.y, n.x, n.y) <= B.map.nodes[body].r + B.map.hitTolerance) return body as PlanetId
    }
    return null
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
    // 建筑模式优先：点击 = 网格吸附落位（成功即退出模式，失败提示后留在模式中可换点）
    if (this.buildMode) {
      const snapped = snapToGrid(p.x, p.y)
      const ok = this.buildings.tryPlace(this.buildMode.typeId, snapped.x, snapped.y)
      if (ok) {
        audioSys.play('wc.build')
        this.cancelBuildMode()
      } else {
        audioSys.play('wc.bad', { volume: 0.5 })
      }
      return
    }
    // 双击行星 → 进入其行星系（加载遮罩过渡）
    // ⚠ 行星命中优先于太阳（水星轨道 97 < 太阳命中半径 124，先判太阳会整颗吃掉水星）
    // ⚠ 视图切换不受败局/选卡冻结影响（pendingCard 挂起期间航线交互冻结，但镜头必须可用）
    const planet = this.planetAt(p)
    if (planet) {
      const now = performance.now()
      if (this.lastPlanetClick.body === planet && now - this.lastPlanetClick.t < 350) {
        this.lastPlanetClick = { body: null, t: 0 }
        this.enterPlanetSystem(planet)
        audioSys.play('wc.ok', { volume: 0.4 })
        return
      }
      this.lastPlanetClick = { body: planet, t: now }
      // 单击行星：不参与太阳聚焦，继续走建筑/节点/航线判定（行星也可能是资源星节点）
    }
    // 太阳：点击聚焦取景（不参与航线/选择）
    if (this.sunAt(p)) {
      this.focusSolarSystem('sun')
      audioSys.play('wc.ok', { volume: 0.4 })
      return
    }
    const s = this.simState.state
    if (s.outcome === 'defeat' || s.pendingCard) return
    const b = this.buildingAt(p)
    if (b) { this.selection = { type: 'building', id: b.id }; return }
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
    // 建筑模式：光标位置刷新网格吸附预览（渲染 ghost 消费）
    if (this.buildMode) {
      const snapped = snapToGrid(p.x, p.y)
      const def = buildingDefOf(this.buildMode.typeId)
      const issue = this.buildings.placementIssue(this.buildMode.typeId, snapped.x, snapped.y)
      this.buildCursor = {
        x: snapped.x, y: snapped.y,
        valid: issue === null,
        label: issue ?? (def ? `${def.name} · ${def.cost} H3` : ''),
      }
      return
    }
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
    if (ka === 'earth' && kb === 'building') return this.buildingLinkable(b)
    if (ka === 'building' && kb === 'earth') return this.buildingLinkable(a)
    return false
  }

  /** 建筑 endpoint 可接航线（预览镜像；权威判定在 transport.tryCreateRoute） */
  private buildingLinkable(e: Endpoint): boolean {
    const b = buildingByEndpoint(this.simState.state, e)
    return !!b && !!buildingDefOf(b.type)?.linkable
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
    // 地↔建筑补给线（建筑端点必有其一）
    const bEp = a.kind === 'building' ? a : b
    const bd = buildingByEndpoint(this.simState.state, bEp)
    if (!bd) return '不合法'
    const def = buildingDefOf(bd.type)
    if (!def?.linkable) return `${def?.name ?? '该建筑'}不能接入航线`
    const left = this.buildings.bufferLeft(bd)
    return `送建材入缓存 · 余量 ${left}/${def.bufferCap}`
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
    resetMoonPhaseAdj()
    this.moonAngleAtLeave = null
    this.selection = null
    this.drag = null
    this.buildMode = null
    this.buildCursor = null
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
    resetMoonPhaseAdj()
    this.moonAngleAtLeave = null
    this.selection = null
    this.drag = null
    this.buildMode = null
    this.buildCursor = null
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
      maintPerS: fleetMaintPerS(s.ships.length),
    }
    const ledger = { ...s.ledger, ...ledgerTotals(s.ledger) }
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
          name: route.direction === 'forward' ? `${star ? B.stars[star].name : '?'}线` : '中转站供应线',
          direction: route.direction,
          ships: route.shipIds.length,
          net: routeNetPerTrip(s, route),
          cycle: routeCycleSeconds(s, route),
        }
      }
    }
    let buildingInfo: HudBuildingInfo | null = null
    if (this.selection?.type === 'building') {
      const b = s.buildings.find((x) => x.id === this.selection!.id)
      const def = b ? buildingDefOf(b.type) : null
      if (b && def) {
        buildingInfo = {
          id: b.id,
          type: b.type,
          name: def.name,
          radius: def.radius,
          cap: def.shipCap,
          stock: Math.floor(b.stock),
          bufferCap: def.bufferCap,
          canDemolish: s.flare.phase !== 'active',
        }
      }
    }
    const demand = sc.demand
    // 建造面板行：building 表顺序（表驱动，加建筑只改表）
    const playable = (s.outcome === 'playing' || s.sandbox) && s.flare.phase !== 'active'
    const buildRows: HudBuildRow[] = Object.entries(B.buildings).map(([id, def]) => ({
      id,
      name: def.name,
      desc: def.desc,
      cost: def.cost,
      canPlace: playable && s.earthH3 >= def.cost,
    }))
    // 航线管理面板行：全部航线紧凑视图（正向「月球线」/ 反向「供应线·中转站 N」，命名与运输面板 routeNameOf 同口径）
    const routeNameOf = (route: SimRoute): string => {
      if (route.direction === 'forward') {
        const star = starOfEndpoint(s, route.from)
        return `${star ? B.stars[star].name : '?'}线`
      }
      const b = buildingByEndpoint(s, route.to)
      const def = b ? buildingDefOf(b.type) : null
      return `供应线·${def?.name ?? '中转站'}${b ? ` ${b.id}` : ''}`
    }
    const nameOfRouteId = (routeId: number | null): string => {
      if (routeId === null) return ''
      const r = s.routes.find((x) => x.id === routeId)
      return r ? routeNameOf(r) : ''
    }
    const shipRows: HudShipRow[] = s.ships.slice(0, 10).map((ship) => ({
      id: ship.id,
      name: ship.name,
      state: ship.state,
      place: ship.mission ? '火星任务'
        : ship.state === 'idle' ? '基地待命'
        : ship.state === 'frozen' ? '冻毁'
        : ship.state === 'loading' ? `装载中 · ${nameOfRouteId(ship.routeId)}`
        : ship.state === 'unloading' ? `卸载中 · ${nameOfRouteId(ship.routeId)}`
        : `${ship.leg === 'outbound' ? '去程' : '回程'} · ${nameOfRouteId(ship.routeId)}`,
      cargo: Math.round(ship.cargo),
      materials: Math.round(ship.materials),
      canRebuild: ship.state === 'frozen',
    }))
    const routes: HudRouteRow[] = s.routes.map((route) => ({
      id: route.id,
      name: routeNameOf(route),
      direction: route.direction,
      ships: route.shipIds.length,
      net: routeNetPerTrip(s, route),
      cycle: routeCycleSeconds(s, route),
    }))
    return {
      time: s.time,
      act: s.act,
      nodes: s.nodes,
      ringLevel: ringLevelOf(s.nodes, s.research.reduce((m, l) => Math.max(m, l.progress), 0)),
      continuity: s.continuity,
      ring: s.ring,
      bufferLeft: s.bufferLeft,
      bufferTotal: s.bufferTotal,
      reserve: s.earthH3,
      demand,
      researchCost: sc.researchCost,
      netFlow: estimateNetFlow(s, demand),
      danger: s.ring === 'running' && demand > 0 && s.earthH3 < demand * B.dangerReserveSeconds,
      windowPhase: s.gravity.phase,
      windowRemain: Math.max(0, Math.ceil(s.gravity.timer)),
      flarePhase: s.flare.phase,
      flareRemain: s.flare.phase === 'active' ? Math.ceil(s.flare.timer) : Math.max(0, Math.ceil(s.flare.nextIn)),
      fleet,
      ledger,
      // 研究行：rate = 该线当前 H3 消耗速率（点数计费；断环/储量耗尽为 0，点数加成同口径失效）
      research: s.research.map((l) => ({
        id: l.id, name: l.name, progress: l.progress, points: l.points,
        rate: s.ring === 'running' && s.earthH3 > 0 ? l.points * B.researchPointCostPerS : 0,
      })),
      researchUnspent: sc.unspentResearchPoints,
      pending,
      routeInfo,
      buildingInfo,
      buildRows,
      buildActive: this.buildMode?.typeId ?? null,
      shipRows,
      routes,
      shipBuildCost: B.shipBuildCost,
      shipRebuildCost: B.shipRebuildCost,
      tutorial: s.tutorial,
      paused: this.paused,
      timeScale: this.timeScale,
      moduleState: s.module.state,
      canStartMission: s.act >= 3 && s.module.state === 'available' && sc.idleShips > 0 && s.flare.phase !== 'active',
      outcome: s.outcome,
      sandbox: s.sandbox,
      stats: { delivered: s.stats.delivered, frozen: s.stats.frozenCount, buildings: s.stats.buildingsBuilt, cards: s.stats.cardsTaken },
    }
  }
}
