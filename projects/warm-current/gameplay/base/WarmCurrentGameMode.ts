/**
 * WarmCurrentGameMode — 游戏规则胶水（hoi4 base/ 架构位）
 *
 * 2026-09-20 组件化改版：玩法逻辑全部下沉为 GameMode 上的引擎组件（对齐 SpawnComponent/CameraComponent 惯例），
 * 本类只保留生命周期编排（InitGame/BeginPlay/Tick 门控/EndPlay）、Esc 优先级分发、
 * 暂停/存档/重开编排、星图指针拖线胶水，以及各域组件的薄转发门面（UI 脚本与 e2e 调用面不变）。
 *
 * 仿真子系统（原 11 组件）：
 * simState（状态+快照）/ transport（航线飞船）/ economy（焚烧衰减）/ research（研究海克斯）
 * / hazards（引力窗口+耀斑）/ buildings（地图建筑）/ orbitBuild（近地轨道+船坞）/ mining（矿产）
 * / acts（三幕）+ sim（总控编排器）+ ringBuild（聚能环建设）。
 *
 * 2026-09-20 下沉的 10 组件（原 GameMode 内联逻辑）：
 * sky（天空装配）/ hit（星图命中检测）/ feedback（事件→toast/音效/特效）/ vm（HUD 视图模型+类型）
 * / ship（船队设计流）/ payloadDesign（荷载设计工坊）/ panels（面板选择态状态机）
 * / fleet（耀斑舰队指挥）/ holo（全息勘探/建造）/ view（视图模式/观察态/相机决策）。
 *
 * HUD 不在此构建（HUDClass 指向 hud.widget.json，由 gameplay/ui/*.script.ts 消费 buildViewModel）。
 * 指针事件经 WarmCurrentPlayerController 进来后做节点/航线几何命中，转成组件指令；
 * 建筑模式（buildMode）下指针变为放置：网格吸附预览 + 点击落位（Esc 取消，优先于暂停菜单）。
 * Esc：togglePauseMenu 呼出/关闭暂停菜单（存档槽 + 继续 + 回主菜单），打开时强制暂停。
 * 海克斯三选一：节点达成弹卡即整体暂停仿真（paused=true），选卡后恢复运行（2026-09-08 拍板）。
 */
import { CameraComponent, GameMode, Instantiate, SphereMeshComponent, audioSys, logger } from '@/engine'
import { starTextureFor } from '../map/starTextures'
import { B, MAP_H, MAP_W, refreshBalanceFromConfigs } from '../core/balance'
import type { SolarFocusBody } from '../core/balance'
import type { PlanetId, MoonId, PlanetBodyId, ShipOrder } from '../core/types'
import type { SolarBodyId } from '../core/helpers'
import { restoreSimState } from '../core/save'
import {
  buildingByEndpoint, buildingDefOf, endpointPos, findRoute,
  resetMoonPhaseAdj, roundFuel, snapToGrid,
  starLoad, starOfEndpoint,
  TUTORIAL_TARGETS,
} from '../core/helpers'
import type { Endpoint, SimRoute, SimShip, SimState, StarId } from '../core/types'
import { StarMapRenderComponent } from '../map/StarMapRenderComponent'
import { SolarCameraActor } from '../map/SolarCameraActor'
import { STAR_BLUEPRINTS, type StarBodyId } from '../map/StarActor'
import type { BuildCursor, DragState, MapFx, MapSelection } from '../map/StarMapRenderComponent'
import { SimStateComponent } from '../systems/SimStateComponent'
import { SkyComponent } from '../systems/SkyComponent'
import { MapHitTestComponent, segDist } from '../systems/MapHitTestComponent'
import { EventFeedbackComponent } from '../systems/EventFeedbackComponent'
import { ViewModelComponent } from '../systems/ViewModelComponent'
import { ShipDesignComponent } from '../systems/ShipDesignComponent'
import { PayloadDesignComponent } from '../systems/PayloadDesignComponent'
import { PanelStateComponent } from '../systems/PanelStateComponent'
import { FleetCommandComponent } from '../systems/FleetCommandComponent'
import { HologramComponent } from '../systems/HologramComponent'
import { ViewDirectorComponent } from '../systems/ViewDirectorComponent'
import type {
  HoloTab, HudDesignRow, HudDesignSlotCell, HudHoloBuildRow, HudHoloDepositRow, HudHoloEarth,
  HudHoloToolRow, HudHologram, HudHullRow, HudModuleRow, HudPayloadDesign, HudPayloadRow,
  HudShipAddMenu, HudShipDesign, HudShipyard, HudStackRow, HudTrialRow, WarmCurrentVM,
} from '../systems/ViewModelComponent'
import { PLANET_NAMES } from '../core/planetNames'
import { TransportComponent } from '../systems/TransportComponent'
import { EconomyComponent } from '../systems/EconomyComponent'
import { ResearchComponent } from '../systems/ResearchComponent'
import { RingBuildComponent } from '../systems/RingBuildComponent'
import { HazardsComponent } from '../systems/HazardsComponent'
import { BuildingsComponent } from '../systems/BuildingsComponent'
import { OrbitBuildComponent, isShipyardType, orbitBuildingDefOf } from '../systems/OrbitBuildComponent'
import { MiningComponent, mineDefOf, depositDefOf, depositsOf, depositLeft } from '../systems/MiningComponent'
import { ActsComponent } from '../systems/ActsComponent'
import { SimulationComponent } from '../systems/SimulationComponent'
import { WarmCurrentPlayerController } from './WarmCurrentPlayerController'
import { WarmCurrentPawn } from './WarmCurrentPawn'
import { registerWarmCurrentAudio } from './audio'

/** 暂停菜单 widget 资产（Esc 呼出，动态 spawn/destroy） */
const PAUSE_MENU_WIDGET = 'asset/blueprints/ui/pause_menu.widget.json'

/** 视图切换加载遮罩（地球系/太阳系跃迁过渡，动态 spawn/destroy） */
const VIEW_LOADING_WIDGET = 'asset/blueprints/ui/view_loading.widget.json'
void VIEW_LOADING_WIDGET // 2026-09-20 随 switchView 下沉 ViewDirectorComponent（widget 路径在组件内声明）

export const WARM_CURRENT_SCENE = 'WarmCurrentMap'
export const HUD_WIDGET = 'asset/blueprints/ui/hud.widget.json'

/** 星图天体中文名：已提取为共享模块 core/planetNames（本文件 import PLANET_NAMES） */

// ─── HUD 视图模型类型（2026-09-20 下沉 ViewModelComponent；此处 re-export 保持既有 import 路径） ───
export type {
  HudRouteInfo, HudBuildingInfo, HudBuildingDetail, HudBuildRow, HudShipRow, HudRouteRow,
  HudPlanetInfo, HudHoloDepositRow, HudHoloBuildRow, HoloTab, HudHoloToolRow, HudHoloEarth,
  HudHologram, HudOrbitBuildRow, HudOrbitBuildingRow, HudOrbitBuild, HudStationModuleRow,
  HudStation, HudShipBuildCard, HudHullRow, HudModuleRow, HudPayloadRow, HudPayloadDesign,
  HudTrialRow, HudDesignRow, HudDesignSlotCell, HudStackRow, HudShipAddMenu, HudDesignDock,
  HudShipDesign, HudShipyard, WarmCurrentVM,
} from '../systems/ViewModelComponent'

export class WarmCurrentGameMode extends GameMode {
  /** 仿真子系统组件（对齐引擎 SpawnComponent/CameraComponent 惯例，挂在 GameMode 上） */
  readonly simState: SimStateComponent = this.addComponent(SimStateComponent)
  readonly transport: TransportComponent = this.addComponent(TransportComponent)
  readonly economy: EconomyComponent = this.addComponent(EconomyComponent)
  readonly research: ResearchComponent = this.addComponent(ResearchComponent)
  /** 聚能环建设（脱离科研的独立流：交点解锁/建设点数/计费） */
  readonly ringBuild: RingBuildComponent = this.addComponent(RingBuildComponent)
  readonly hazards: HazardsComponent = this.addComponent(HazardsComponent)
  /** 地图建筑（建造面板选型 → 星图自由放置） */
  readonly buildings: BuildingsComponent = this.addComponent(BuildingsComponent)
  /** 近地轨道建筑（点行星 → 轨道建设面板；船坞造船乘区） */
  readonly orbitBuild: OrbitBuildComponent = this.addComponent(OrbitBuildComponent)
  /** 矿产开发（全息勘探 → 矿点造矿建 → 持续产出 H3） */
  readonly mining: MiningComponent = this.addComponent(MiningComponent)
  readonly acts: ActsComponent = this.addComponent(ActsComponent)
  /** 总控编排器（固定顺序驱动各子系统 tick） */
  readonly sim: SimulationComponent = this.addComponent(SimulationComponent)
  /** 星空全景天空装配（SSS equirect → scene.background；EndPlay 自行释放纹理） */
  readonly sky: SkyComponent = this.addComponent(SkyComponent)
  /** 星图指针命中检测（纯查询：建筑/轨道设施/节点/天体/航线/船） */
  readonly hit: MapHitTestComponent = this.addComponent(MapHitTestComponent)
  /** 事件→反馈翻译（音效 + toast + 地图特效） */
  readonly feedback: EventFeedbackComponent = this.addComponent(EventFeedbackComponent)
  /** HUD 视图模型装配（WarmCurrentVM 单一投影；类型经本文件 re-export） */
  readonly vm: ViewModelComponent = this.addComponent(ViewModelComponent)
  /** 船队设计流（船坞/设计工坊共享选择态 + 槽位投影 + 模板/推荐/下单） */
  readonly ship: ShipDesignComponent = this.addComponent(ShipDesignComponent)
  /** 荷载设计工坊（三部位合成编辑区 + 设计模板 + 动态模块注册） */
  readonly payloadDesign: PayloadDesignComponent = this.addComponent(PayloadDesignComponent)
  /** 面板选择态状态机（星球信息/轨道/船坞/空间站/火箭设计/建筑详情的开合与互斥） */
  readonly panels: PanelStateComponent = this.addComponent(PanelStateComponent)
  /** 耀斑预警舰队指挥（船选择/框选/下令） */
  readonly fleet: FleetCommandComponent = this.addComponent(FleetCommandComponent)
  /** 全息勘探/全息地球建造（状态权威 + 建造校验 + 卫星跟随 + 面板投影） */
  readonly holo: HologramComponent = this.addComponent(HologramComponent)
  /** 星图视图/相机决策（视图模式/观察态/取景/相机交互语义/滚轮注入） */
  readonly view: ViewDirectorComponent = this.addComponent(ViewDirectorComponent)

  /** 太阳系云台相机（滚轮缩放 + 右键/边缘平移；群星式） */
  readonly cameraActor: SolarCameraActor
  /** 兼容旧引用（HUD/UI 脚本读 gameCamera.camera）：直接暴露云台上的 CameraComponent */
  readonly gameCamera: CameraComponent

  starMap: StarMapRenderComponent | null = null

  /** 星图天体蓝图 Actor（BeginPlay 经 Instantiate 生成，Tick 每帧 syncFrom；渲染组件经 provider 只读消费） */
  readonly starActors = new Map<StarBodyId, import('@/engine').Actor>()

  drag: DragState | null = null
  selection: MapSelection = null

  /** 地图特效（下沉 EventFeedbackComponent 后的兼容只读视图：渲染层经此消费） */
  get fx(): MapFx { return this.feedback.fx }

  /** 航线编辑模式（底部 HUD「航线编辑」进入；开启后星图节点才可拖线建航线，退出后点星球 = 信息面板） */
  routeEditMode = false
  /** 全息勘探状态（下沉 HologramComponent 后的兼容只读视图：Controller/GM/渲染 provider/面板脚本经此读取） */
  get hologramSel(): PlanetBodyId | null { return this.holo.hologramSel }
  get holoDepositSel(): string | null { return this.holo.holoDepositSel }
  get holoPlaceTool(): { kind: 'ring' } | { kind: 'building'; typeId: string } | null { return this.holo.holoPlaceTool }
  get holoTab(): HoloTab { return this.holo.holoTab }
  get holoGhost(): { lat: number; lon: number; valid: boolean; label: string } | null { return this.holo.holoGhost }
  /** 全息地球当前工具种类（渲染 ghost 预览圈半径口径；MapViewProvider 消费） */
  get holoToolKind(): 'ring' | 'building' | null {
    return this.holo.holoPlaceTool?.kind ?? null
  }
  /** 船坞造船面板/空间站/星球信息/建筑详情选择态（下沉 PanelStateComponent 后的兼容只读视图） */
  get planetInfoSel(): SolarBodyId | null { return this.panels.planetInfoSel }
  get orbitBuildSel(): PlanetBodyId | null { return this.panels.orbitBuildSel }
  get shipyardSel(): number | null { return this.panels.shipyardSel }
  get stationSel(): number | null { return this.panels.stationSel }
  get buildingDetailSel(): number | null { return this.panels.buildingDetailSel }
  get designOpen(): boolean { return this.panels.designOpen }
  /** 设计选择态兼容只读视图（2026-09-20 下沉 ShipDesignComponent/PayloadDesignComponent，UI 脚本经此读取） */
  get shipyardSelHull(): string { return this.ship.shipyardSelHull }
  get shipyardSelModules(): string[] { return this.ship.shipyardSelModules }
  get shipyardSelSlot(): { type: string; idx: number } | null { return this.ship.shipyardSelSlot }
  get shipyardAddMenuOpen(): boolean { return this.ship.shipyardAddMenuOpen }
  get payloadEdTab(): 'payload' | 'fuel' | 'engine' { return this.payloadDesign.payloadEdTab }
  get payloadEdChassis(): string { return this.payloadDesign.payloadEdChassis }
  get payloadEdAttachments(): string[] { return this.payloadDesign.payloadEdAttachments }
  /** 耀斑预警框选的船 id 集（下沉 FleetCommandComponent 后的兼容只读视图） */
  get selectedShips(): number[] { return this.fleet.selectedShips }
  /** 框选手势进行中矩形（画布系；仅耀斑预警期空处按下拖动 = 框选；null = 无） */
  boxDrag: { x0: number; y0: number; x1: number; y1: number } | null = null

  /** 建筑模式（建造面板选型后进入：星图网格线 + 吸附预览，点击落位 / Esc 取消） */
  buildMode: { typeId: string } | null = null
  /** 建筑模式光标（网格吸附后画布系坐标 + 合法性，渲染 ghost 消费） */
  buildCursor: BuildCursor | null = null

  paused = false
  timeScale: 1 | 2 = 1
  /** 星图视图状态（下沉 ViewDirectorComponent 后的兼容只读视图：Controller/渲染/e2e 桥经此读取） */
  get viewMode(): 'earth' | 'solar' { return this.view.viewMode }
  get planetFocusBody(): SolarBodyId { return this.view.planetFocusBody }
  get observeBody(): PlanetId | MoonId | null { return this.view.observeBody }
  get viewSwitching(): boolean { return this.view.viewSwitching }
  get viewLoadingPanel(): import('@/engine').Actor | null { return this.view.viewLoadingPanel }


  /** 事件 toast 队列（下沉 EventFeedbackComponent 后的兼容只读视图：HudScript 经此消费） */
  get toasts(): Array<{ text: string; color: string; age: number }> { return this.feedback.toasts }

  /** 暂停菜单面板（Esc 动态 spawn 的 UI Actor；null = 关闭） */
  pauseMenuPanel: import('@/engine').Actor | null = null

  /** HUD widget 资产（PC.ClientSetHUD 链自动创建，脚本挂根节点） */
  override HUDClass = HUD_WIDGET

  constructor() {
    super()
    // 太阳系云台相机（3D 标准）：fov 50，缩放边界随视图模式切换（applyViewMode：拉远上限地球系 5200 / 太阳系 12000，
    // 拉近下限 = 聚焦天体半径 ×1.15 动态贴合——相机可一路滚到近乎贴着星球表面）
    // 相机 Actor 构造但不托管：由 BeginPlay 的 spawnActor 交给 World（hoi4 同款）
    this.cameraActor = new SolarCameraActor(MAP_W, MAP_H)
    this.gameCamera = this.cameraActor.cameraComponent
    // 滚轮落点平移的 warm 状态注入（2026-09-20 下沉 ViewDirectorComponent.attachScrollPan）
    this.view.attachScrollPan()
    // （2026-09-15 三版）平滑聚焦补间已退役：聚焦=只切瞄准点，镜头交给玩家滚轮，
    // 不再挂 onManualCameraInput → cancelFlyTo 钩子
  }

  override InitGame(): void {
    // 配置表覆盖默认值 + 重置仿真状态（改表重开一局即生效）
    refreshBalanceFromConfigs()
    this.simState.reset()
    this.payloadDesign.syncDynamicPayloadModules()
    super.InitGame()
    this.cameraManager.RegisterCamera(this.gameCamera)
    this.cameraActor.place()
    // 开局即地球系取景：只看地月小星系（2026-09-14 视角锁定地球系，太阳系/其它行星系切换入口已全部移除）
    this.focusSolarSystem('earth')
    // 银河全景天空（SSS equirect → scene.background）：异步解码不阻塞取景，失败走纯黑兜底
    this.sky.apply()
    logger.info('[WarmCurrent] 开局取景：地球系（地月小星系）')
  }

  override spawnPlayerInternal() {
    const controller = new WarmCurrentPlayerController(this)
    // 装配期：相机云台接输入（右键拖拽平移/环绕；滚轮缩放已上收）+ 滚轮落点平移组件接输入
    this.cameraActor.rig.bindInput(controller.inputComponent)
    this.cameraActor.scrollPan.bindInput(controller.inputComponent)
    // Esc：建筑模式中先取消放置（不误开暂停菜单），否则呼出/关闭暂停菜单（存档槽 + 继续 + 回主菜单）
    controller.inputComponent.BindAction('wc-pause-menu', 'Escape', 'pressed', () => {
      if (this.buildMode) {
        this.cancelBuildMode()
        return
      }
      // 全息勘探模式：Esc 先清放置工具，再退全息回俯视（不误开暂停菜单）
      if (this.hologramSel) {
        if (this.holoPlaceTool) {
          this.setHoloTool(null)
          return
        }
        this.closeHologram()
        return
      }
      // 行星观察模式：Esc 先退观察回行星系俯视（不误开暂停菜单）
      if (this.observeBody) {
        this.exitPlanetObserve()
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
    // 弹卡暂停：pendingCard 挂起期间仿真整体冻结（选卡即恢复，无跳过选项）
    if (!this.paused && !s.pendingCard && (s.outcome === 'playing' || s.sandbox)) {
      this.sim.runTick(dt * this.timeScale)
    }
    this.feedback.drain()
    // 特效/toast 老化（真实时间）
    this.feedback.ageFx(dt)
    // 天体位置自驱动（蓝图 Actor：位置 = hiddenActorIsolated 隔离点纯函数 + 自转；暂停时 dt=0 只保持位置）
    // 行星系视角：聚焦行星 + 卫星按真实相对位置绕舞台中心（聚焦行星钉在舞台），
    // 其余天体 Actor 本体移到远景隔离点（布局锚方位 × 12000）——渲染层本就将其
    // visible=false 隐藏，Actor 移远后点击判定（收口真实 Actor 位置）自然点不到
    const sdt = this.paused ? 0 : dt * this.timeScale
    const vm = this.viewMode
    const focus = this.planetFocusBody as PlanetId
    for (const sa of this.starActors.values()) (sa as import('../map/StarActor').StarActor).syncFrom(this.simState.state, sdt, vm, focus)
    // 卫星全息跟随（下沉 HologramComponent；rig.pan 口径保持环绕几何，锚住公转中的卫星）
    this.holo.tickFollow()
    // 卫星观察跟随（下沉 ViewDirectorComponent；原地转头口径，相机位置不动）
    this.view.tickObserveFollow()
    // rig.target 已由取景（observeFocus）一次性定到舞台中心（舞台静态：行星钉死），这里禁止逐帧复位：
    // rig.pan 成对移动 target 与相机，若只把 target 拉回舞台而相机留在原位，
    // 下次拖拽的 lookAt 会把镜头掰向舞台中心——右键平移退化成绕行星旋转
    this.starMap?.render(this.paused ? 0 : dt * this.timeScale, this.gameCamera.camera)
  }

  // ═══════════════════════════════════════════
  //  星图天体蓝图 Actor（外观资产化：.blueprint.json）
  // ═══════════════════════════════════════════

  /**
   * 生成 11 个天体蓝图 Actor；单张失败（未注册/lint 错）由渲染组件兜底建球，星图不缺星。
   * 贴图来源：蓝图 texture 资产字段（引擎 factory 装配）优先；仅蓝图未声明贴图的天体
   * （europa，SSS 无真贴图）走 starTextureFor 程序化 CanvasTexture 兜底。
   */
  private spawnStarActors(): void {
    if (!this.world) return
    for (const [body, path] of Object.entries(STAR_BLUEPRINTS) as Array<[StarBodyId, string]>) {
      const actor = Instantiate(path)
      if (actor) {
        const mesh = actor.getComponent(SphereMeshComponent)
        let texSource = ''
        if (mesh && !mesh.hasTextureMap) {
          const tex = starTextureFor(body)
          if (tex && mesh) {
            mesh.setTexture(tex)
            texSource = typeof tex === 'string' ? '（程序化兜底·真贴图 URL）' : '（程序化兜底·Canvas）'
          }
        }
        this.starActors.set(body, actor)
        logger.info(`[WarmCurrent] 天体生成 ${body} ← ${path}${mesh ? (mesh.hasTextureMap ? '（蓝图贴图资产）' : texSource || '（无贴图）') : '（缺 SphereMesh）'}`)
      } else {
        logger.error(`[WarmCurrent] 天体蓝图生成失败，该天体缺失（检查 assetLint）：${path}`)
      }
    }
  }

  // ─── 星图视图/相机决策（2026-09-20 下沉 ViewDirectorComponent；转发门面，调用面不变） ───

  /** 聚焦指定天体（内部机制保留供 e2e/开发直调；玩家入口已屏蔽） */
  focusSolarSystem(body: SolarFocusBody): void { this.view.focusSolarSystem(body) }
  /** 视角切换（历史 ViewToggle widget 兼容入口） */
  setViewMode(mode: 'earth' | 'solar'): void { this.view.setViewMode(mode) }
  /** 双击行星（视角锁定下仅 earth 响应：切换观察视角/进入行星系） */
  enterPlanetSystem(body: SolarBodyId): void { this.view.enterPlanetSystem(body) }
  /** 进入行星观察视角 */
  enterPlanetObserve(body: PlanetId): void { this.view.enterPlanetObserve(body) }
  /** 进入卫星观察视角 */
  enterMoonObserve(body: MoonId): void { this.view.enterMoonObserve(body) }
  /** 退出行星/卫星观察视角 */
  exitPlanetObserve(): void { this.view.exitPlanetObserve() }
  /** 清观察态（不做取景复位；全息/观察互斥收口共用） */
  clearObserveState(): void { this.view.clearObserveState() }
  /** 缩放下限贴球心（min 距离 = 天体显示半径 × 1.15） */
  applyZoomFloor(bodyR: number): void { this.view.applyZoomFloor(bodyR) }
  /** 当前视图的世界位移（世界坐标 → 地图画布坐标须减去；PlayerController 指针拾取共用） */
  viewStageOffset(): { x: number; z: number } { return this.view.viewStageOffset() }


  override EndPlay(): void {
    // 相机 Actor 是 GameMode 自建自管的（非场景资产节点），销毁时走 Actor 统一销毁
    // （已托管 → World 销毁队列；未托管 → 本地 EndPlay，hoi4 同款）
    this.cameraActor.destroy()
    super.EndPlay()
  }

  // ═══════════════════════════════════════════
  //  建筑模式（建造面板选型 → 星图网格放置）
  // ═══════════════════════════════════════════

  /** 进入建筑模式（建造面板「放置」按钮；预算校验通过才进入；与航线编辑模式互斥） */
  enterBuildMode(typeId: string): boolean {
    const def = buildingDefOf(typeId)
    if (!def) return false
    const s = this.simState.state
    if (s.outcome !== 'playing' && !s.sandbox) return false
    if (s.earthH3 < def.cost) { this.simState.hint(`H3 不足（需 ${def.cost}）`); return false }
    this.buildMode = { typeId }
    this.buildCursor = null
    this.drag = null
    this.routeEditMode = false
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
  //  航线编辑模式（底部 HUD「航线编辑」开关）
  // ═══════════════════════════════════════════

  /** 切换航线编辑模式：开启 = 星图节点可拖线；关闭 = 点星球打开信息面板。与建筑模式互斥。 */
  toggleRouteEditMode(): void {
    if (this.routeEditMode) {
      this.routeEditMode = false
      this.drag = null
      this.feedback.toast('航线编辑已退出 — 点星球查看信息', '#9fc4d8')
      audioSys.play('wc.ok', { volume: 0.3 })
      logger.info('[WarmCurrent] 航线编辑模式退出')
      return
    }
    if (this.buildMode) this.cancelBuildMode()
    this.routeEditMode = true
    this.panels.closePlanetInfo()
    this.panels.closeOrbitBuild()
    this.feedback.toast('航线编辑：从星球拖线到地球即可建立航线（再点按钮退出）', '#7fdcff')
    audioSys.play('wc.ok', { volume: 0.5 })
    logger.info('[WarmCurrent] 航线编辑模式进入')
  }

// ─── 星图指针交互 ───

  /** 双击判定状态（聚焦入口）：最近一次点中的天体（行星/卫星）+ 时刻 */
  private lastPlanetClick: { body: PlanetId | MoonId | null; t: number } = { body: null, t: 0 }

  /** 观察态按下快照（2026-09-15 单击解冻）：按下时记画布坐标，抬起按位移 ≤ 8px 结算为单击
   *  （走 resolveMapClick 星图点击判定尾段）或 > 8px 归环绕拖拽（相机层消费）。退出观察/
   *  视图切换统一清理，跨态残留抬起不误结算。 */
  pendingObserveClick: { x: number; y: number } | null = null

  // ─── 面板开合（2026-09-20 下沉 PanelStateComponent；以下为兼容转发门面，调用面不变） ───

  /** 打开星球信息面板（非航线编辑模式点星球 / 点不可拖天体；再点其它星球切换内容） */
  openPlanetInfo(body: SolarBodyId): void { this.panels.openPlanetInfo(body) }

  /** 关闭星球信息面板（面板内 ✕ / 点空地） */
  closePlanetInfo(): void { this.panels.closePlanetInfo() }

  /** 打开轨道建设面板（星球信息面板「近地轨道建设」按钮 / 点已建成轨道设施） */
  openOrbitBuild(anchor: PlanetBodyId): void { this.panels.openOrbitBuild(anchor) }

  /** 关闭轨道建设面板（面板内 ✕ / 点空地） */
  closeOrbitBuild(): void { this.panels.closeOrbitBuild() }

  /** 打开船坞造船面板（星图点船坞轨道设施；与轨道建设/空间站/星球信息面板互斥） */
  openShipyardPanel(dockId: number): void { this.panels.openShipyardPanel(dockId) }

  /** 关闭船坞造船面板（面板内 ✕ / 点空地） */
  closeShipyardPanel(): void { this.panels.closeShipyardPanel() }

  /** 打开空间站舱段面板（星图点空间站轨道设施；与船坞/轨道建设/星球信息面板互斥） */
  openStationPanel(obId: number): void { this.panels.openStationPanel(obId) }

  /** 关闭空间站舱段面板（面板内 ✕ / 点空地） */
  closeStationPanel(): void { this.panels.closeStationPanel() }

  /** 打开火箭设计面板（底部 HUD「火箭设计」按钮；选择态与船坞面板共享） */
  openShipDesign(): void { this.panels.openShipDesign() }

  /** 关闭火箭设计面板 */
  closeShipDesign(): void { this.panels.closeShipDesign() }

  // ─── 荷载设计工坊（2026-09-20 下沉 PayloadDesignComponent；兼容转发门面，调用面不变） ───

  /** 切换设计工坊部位页签（payload/fuel/engine） */
  selectPayloadTab(tab: 'payload' | 'fuel' | 'engine'): void { this.payloadDesign.selectPayloadTab(tab) }
  /** 荷载编辑区选主体（单选） */
  selectPayloadChassis(moduleId: string): void { this.payloadDesign.selectPayloadChassis(moduleId) }
  /** 荷载编辑区勾/取消附件（多选） */
  togglePayloadAttachment(moduleId: string): void { this.payloadDesign.togglePayloadAttachment(moduleId) }
  /** 保存当前编辑区为设计模板 */
  savePayloadDesign(): boolean { return this.payloadDesign.savePayloadDesign() }
  /** 删除荷载设计模板（引用保护） */
  deletePayloadDesign(idx: number): boolean { return this.payloadDesign.deletePayloadDesign(idx) }
  /** 载入设计模板 → 编辑区 */
  loadPayloadDesign(idx: number): boolean { return this.payloadDesign.loadPayloadDesign(idx) }
  /** 荷载设计工坊面板数据（designOpen 期间随部位页签出） */
  buildPayloadDesignVM(): HudPayloadDesign { return this.payloadDesign.buildPayloadDesignVM() }

  // ─── 设计面板 VM/下单（2026-09-20 下沉 ShipDesignComponent；兼容转发门面） ───

  /** 火箭设计面板数据装配（实现见 ShipDesignComponent） */
  buildShipDesignVM(): HudShipDesign { return this.ship.buildShipDesignVM() }
  /** 设计面板下单（指定承接船坞；校验/计费口径在 transport.tryBuildShip） */
  orderFromDesign(dockId: number): boolean { return this.ship.orderFromDesign(dockId) }


  // ─── 全息勘探（2026-09-12：矿点检视 + 矿建落位） ───
  // ─── 全息勘探/全息地球建造（2026-09-20 下沉 HologramComponent；转发门面，调用面不变） ───

  /** 打开全息勘探（星球信息面板按钮；门槛校验与取景见 HologramComponent） */
  openHologram(body: PlanetBodyId): void { this.holo.openHologram(body) }
  /** 关闭全息勘探（面板 ✕ / Esc；保持当前相机位置） */
  closeHologram(): void { this.holo.closeHologram() }
  /** 选中矿点（面板行点击；id 须属当前勘探天体） */
  selectHoloDeposit(id: string | null): void { this.holo.selectHoloDeposit(id) }
  /** 切换面板内容分类 */
  setHoloTab(tab: HoloTab): void { this.holo.setHoloTab(tab) }
  /** 选择放置工具（面板行点击；kind=null 清除） */
  setHoloTool(kind: 'ring' | 'building' | null, typeId?: string): void { this.holo.setHoloTool(kind, typeId) }
  /** 全息视图左键轻点（Controller 派发） */
  onHologramTap(screenX: number, screenY: number): void { this.holo.onHologramTap(screenX, screenY) }
  /** 环节点直落（屏幕落位/GM 共用校验链；返回 null = 成功） */
  placeRingNodeAt(lat: number, lon: number): string | null { return this.holo.placeRingNodeAt(lat, lon) }
  /** 全息地球指针悬停（Controller 移动派发） */
  onHologramHover(screenX: number, screenY: number): void { this.holo.onHologramHover(screenX, screenY) }
  /** 环节点标记的屏幕坐标（e2e/引导探针） */
  holoNodeScreenPos(slot: number): { x: number; y: number } | null { return this.holo.holoNodeScreenPos(slot) }
  /** 目标 lat/lon 球面点的屏幕坐标（e2e 用） */
  holoLatLonScreenPos(lat: number, lon: number): { x: number; y: number } | null { return this.holo.holoLatLonScreenPos(lat, lon) }
  /** 矿点标记的屏幕坐标（e2e 用） */
  holoMarkerScreenPos(depositId: string): { x: number; y: number } | null { return this.holo.holoMarkerScreenPos(depositId) }
  /** 全息勘探面板数据装配（实现见 HologramComponent） */
  buildHologram(body: PlanetBodyId): HudHologram { return this.holo.buildHologram(body) }


  // ─── 建筑详情 / 舰队指挥（2026-09-20 下沉 PanelStateComponent / FleetCommandComponent；转发门面） ───

  /** 打开建筑详情浮层（点地图建筑：强化分支装拆流；与其它浮层并存不互斥——浮层贴选中建筑） */
  openBuildingDetail(id: number): void { this.panels.openBuildingDetail(id) }

  /** 关闭建筑详情浮层（面板内 ✕ / 点空地 / 建筑被拆） */
  closeBuildingDetail(): void { this.panels.closeBuildingDetail() }

  /** 船命中（画布坐标；冻毁船不可选；命中半径与建筑同量级） */
  shipAt(p: { x: number; y: number }): SimShip | null { return this.fleet.shipAt(p) }

  /** 点击增减框选（预警期点船） */
  toggleShipSelection(shipId: number): void { this.fleet.toggleShipSelection(shipId) }

  /** 框选落点结算：矩形内全部在航船入选（替换式） */
  selectShipsInRect(x0: number, y0: number, x1: number, y1: number): number { return this.fleet.selectShipsInRect(x0, y0, x1, y1) }

  clearShipSelection(): void { this.fleet.clearShipSelection() }

  /** 对框选船下达耀斑决策（照跑/就近靠站/原地待命；窗口外拒绝） */
  orderSelectedShips(order: ShipOrder): number { return this.fleet.orderSelectedShips(order) }

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
    // 全息勘探模式：左键 = 环绕拖拽（相机层消费），矿点点选走 Controller 屏幕空间拾取，
    // 星图点击判定全部冻结（面板行也可选中矿点）
    if (this.hologramSel) return
    // 行星观察模式：左键 = 环绕拖拽（相机层消费）；星图点击不再整体冻结（2026-09-15 定案）——
    // 按下记快照、抬起结算：位移 ≤ 8px = 单击（走星图点击判定尾段，点星球开信息面板），
    // 位移 > 8px = 纯环绕拖拽（相机层消费，GameMode 不结算）。
    // 双击当前观察天体 = 退出回默认聚焦；双击另一可观察天体 = 切换聚焦（地球 ↔ 月球，
    // 2026-09-15 聚焦环绕改版）。双击判定不受败局/选卡冻结影响（pendingCard 挂起期间镜头必须可用）。
    // 命中收口 bodyAt（行星 + 卫星；非本系天体已隔离远景 → 点不到）。
    if (this.observeBody) {
      const hit = this.hit.bodyAt(p)
      const now = performance.now()
      if (hit && this.lastPlanetClick.body === hit && now - this.lastPlanetClick.t < 350) {
        this.lastPlanetClick = { body: null, t: 0 }
        if (hit === this.observeBody) {
          this.exitPlanetObserve()
        } else if (B.map.moons[hit as keyof typeof B.map.moons]) {
          this.enterMoonObserve(hit as MoonId)
        } else {
          this.enterPlanetObserve(hit as PlanetId)
        }
        this.pendingObserveClick = null
        return
      }
      // 单击不再冻结（2026-09-15 定案）：按下记快照，抬起按位移结算（见 onMapPointerUp）
      this.pendingObserveClick = { x: p.x, y: p.y }
      this.lastPlanetClick = hit ? { body: hit as PlanetId | MoonId, t: now } : { body: null, t: 0 }
      return
    }

    // 双击天体 → 聚焦观察（2026-09-15 聚焦环绕改版：月球可双击聚焦观察）：
    // 行星走 enterPlanetSystem（视角锁定下仅 earth 响应），卫星走 enterMoonObserve。
    // 命中收口 bodyAt（行星 + 卫星，真实 Actor 世界位置；行星系视角下非本系天体已隔离
    // 远景 12000 → 点不到，本系内可命中 = 聚焦行星 + 其卫星）。
    // ⚠ 双击判定不受败局/选卡冻结影响（pendingCard 挂起期间镜头必须可用）
    // 双击聚焦 + 单击星图判定统一收口 resolveMapClick（allowDouble=true：双击聚焦语义属俯视路径）
    // ⚠ 单击天体不 return：继续走建筑/节点/航线判定（行星/卫星也可能是资源星节点/拖线端点）
    this.resolveMapClick(p, true)
  }

  /** 星图点击判定尾段（俯视态单击与观察态单击共用；2026-09-15 提取）：
   *  建筑 → 轨道设施 → 节点（非编辑态点星球开面板）→ 航线 → 护盾气泡 → 天体兜底 → 空处清选。
   *  @param allowDouble 天体双击段（观察态双击切换）已由上游处理时传 false，防止观察态单击
   *  二次消费 lastPlanetClick 被误判为双击（双击聚焦语义只属俯视路径） */
  private resolveMapClick(p: { x: number; y: number }, allowDouble: boolean): void {
    const s = this.simState.state
    if (allowDouble) {
      const dbl = this.hit.bodyAt(p)
      if (dbl) {
        const now = performance.now()
        if (this.lastPlanetClick.body === dbl && now - this.lastPlanetClick.t < 350) {
          this.lastPlanetClick = { body: null, t: 0 }
          this.panels.closeOrbitBuild()
          if (B.map.moons[dbl as keyof typeof B.map.moons]) this.enterMoonObserve(dbl as MoonId)
          else this.enterPlanetSystem(dbl as PlanetId)
          audioSys.play('wc.ok', { volume: 0.4 })
          return
        }
        this.lastPlanetClick = { body: dbl as PlanetId | MoonId, t: now }
      }
    }
    // 太阳：2026-09-14 视角锁定地球系，点击太阳不再切太阳系全景（仅提示）
    if (this.hit.sunAt(p)) {
      this.simState.hint('太阳系全景已屏蔽（当前锁定地球视角）')
      logger.warn('[WarmCurrent] 点击太阳忽略：太阳系全景视角已屏蔽')
      return
    }
    if (s.outcome === 'defeat' || s.pendingCard) return
    // 耀斑预警期点船：增减框选（船优先于建筑/节点命中——船小且在航线附近移动）
    if (this.hazards.orderWindowOpen()) {
      const hitShip = this.shipAt(p)
      if (hitShip) { this.toggleShipSelection(hitShip.id); return }
    }
    const b = this.hit.buildingAt(p)
    if (b) {
      // 航线编辑模式：可接航线建筑（中转站）优先作为拖线起点，点击选中留给非编辑态
      if (this.routeEditMode && buildingDefOf(b.type)?.linkable) {
        const ep: Endpoint = { kind: 'building', buildingId: b.id }
        const bp = endpointPos(s, ep)
        this.drag = {
          fromEp: ep, fromX: bp.x, fromY: bp.y,
          curX: p.x, curY: p.y, hoverEp: null, valid: false, label: '',
        }
        audioSys.play('wc.draw', { volume: 0.4 })
        return
      }
      this.selection = { type: 'building', id: b.id }
      this.openBuildingDetail(b.id)
      return
    }
    // 近地轨道设施：船坞 → 船坞造船面板（造船入口）；空间站 → 舱段面板（布局设计）；
    // 其它类型（含在建）→ 轨道建设面板
    const ob = this.hit.orbitBuildingAt(p)
    if (ob) {
      if (isShipyardType(ob.type)) this.openShipyardPanel(ob.id)
      else if (ob.type === 'station') this.openStationPanel(ob.id)
      else this.openOrbitBuild(ob.anchor)
      return
    }
    const node = this.hit.nodeAt(p)
    if (node) {
      // 未进入航线编辑模式：点星球 = 打开星球信息面板（拖线被门槛挡住）
      if (!this.routeEditMode) {
        this.openPlanetInfo(node.kind === 'star' ? node.star : 'earth')
        return
      }
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
    // 护盾气泡兜底：点功能示意范围（radius 内切圆）也选中发生器；
    // 排在节点/航线之后，范围罩住天体或航线时不吞拖线/选线交互
    const zone = this.hit.buildingZoneAt(p)
    if (zone) { this.selection = { type: 'building', id: zone.id }; return }
    // 天体兜底（含卫星/未解锁资源星）：非编辑模式点任何星球都开信息面板；
    // 编辑模式下可拖节点已在上面分流，落到这里 = 点了不可拖天体，同样开面板
    const body = this.hit.bodyAt(p)
    if (body) { this.openPlanetInfo(body); return }
    // 空处按下 + 耀斑预警期 = 开始框选手势（与相机右键平移不冲突；落点结算在 pointerUp）
    if (this.hazards.orderWindowOpen()) {
      this.boxDrag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }
      return
    }
    this.selection = null
    this.panels.closeAll()
  }

  onMapPointerMove(p: { x: number; y: number }): void {
    // 框选手势：刷新矩形对角（渲染层画选框，落点结算在 pointerUp）
    if (this.boxDrag) {
      this.boxDrag.x1 = p.x
      this.boxDrag.y1 = p.y
      return
    }
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
    drag.hoverEp = this.hit.nodeAt(p)
    drag.valid = drag.hoverEp ? this.dragValidity(drag.fromEp, drag.hoverEp) : false
    drag.label = drag.hoverEp ? this.dragLabel(drag.fromEp, drag.hoverEp, drag.valid) : ''
  }

  onMapPointerUp(p: { x: number; y: number }): void {
    // 观察态单击结算（2026-09-15 单击解冻）：按下快照 + 抬起位移 ≤ 8px = 单击，
    // 走星图点击判定尾段（allowDouble=false：观察态双击已在 pointerDown 消费，
    // 防单击二次消费 lastPlanetClick 被误判双击）；位移 > 8px = 环绕拖拽，相机层已消费。
    const pend = this.pendingObserveClick
    if (pend) {
      this.pendingObserveClick = null
      const dpx = Math.hypot(p.x - pend.x, p.y - pend.y)
      if (dpx <= 8) {
        logger.info(`[WarmCurrent] 观察态单击结算（位移 ${dpx.toFixed(1)}px ≤ 8）`)
        this.resolveMapClick(p, false)
      } else {
        logger.info(`[WarmCurrent] 观察态拖拽不结算（位移 ${dpx.toFixed(1)}px > 8，环绕归相机层）`)
      }
      return
    }
    // 框选结算：矩形内全部在航船入选（替换式）；无位移 = 空点（清空选择）
    const box = this.boxDrag
    if (box) {
      this.boxDrag = null
      const moved = Math.hypot(p.x - box.x0, p.y - box.y0) > 8
      if (moved) {
        const n = this.selectShipsInRect(box.x0, box.y0, p.x, p.y)
        if (n > 0) audioSys.play('wc.ok', { volume: 0.35 })
      } else {
        this.clearShipSelection()
      }
      return
    }
    const drag = this.drag
    if (!drag) return
    this.drag = null
    const hover = this.hit.nodeAt(p)
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

  /** 拖线视觉合法性（权威判定在 transport.tryCreateRoute；2026-09-13 镜像中转链组合） */
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
    // 中转链星段（星↔中转站，relay_in）
    if ((ka === 'star' && kb === 'building') || (ka === 'building' && kb === 'star')) {
      const star = ka === 'star' ? (a as { star: StarId }).star : (b as { star: StarId }).star
      return this.transport.starUnlocked(star) && (ka === 'building' ? this.buildingLinkable(a) : this.buildingLinkable(b))
    }
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
    this.payloadDesign.syncDynamicPayloadModules()
    resetMoonPhaseAdj()
    this.view.resetForRestart()
    this.selection = null

    this.drag = null
    this.buildMode = null
    this.buildCursor = null
    this.routeEditMode = false
    this.panels.closeAll()
    this.fleet.clearShipSelection()
    this.boxDrag = null
    this.fx.pulses.length = 0
    this.fx.floats.length = 0
    this.toasts.length = 0
    // 取景复位：重开 = 新的一局，镜头回地球系初始取景
    // （clearObserveState 只清观察态不动镜头——从全息地球/行星观察态重开时相机须显式归位）
    this.focusSolarSystem('earth')
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
    this.payloadDesign.syncDynamicPayloadModules()
    resetMoonPhaseAdj()
    this.view.resetForRestart()
    this.selection = null

    this.drag = null
    this.buildMode = null
    this.buildCursor = null
    this.routeEditMode = false
    this.panels.closeAll()
    this.fleet.clearShipSelection()
    this.boxDrag = null
    this.fx.pulses.length = 0
    this.fx.floats.length = 0
    this.toasts.length = 0
    // 恢复后按新档状态决定运行/冻结（与 closePauseMenu 同规则：playing/sandbox 恢复运行，胜负终局保持冻结）
    if (pack.state.outcome === 'playing' || pack.state.sandbox) this.paused = false
    // 取景复位：视图不入存档，读档统一回地球系初始取景（镜头从全息地球/观察态归位）
    this.focusSolarSystem('earth')
    logger.info(`[WarmCurrent] 存档恢复完成（act=${pack.state.act} time=${pack.state.time.toFixed(0)}s）`)
    return pack
  }

  /** 海克斯选卡（脚本按钮回调）：选卡决策完成 → 解除弹卡暂停恢复运行 */
  chooseCardByIndex(i: number): boolean {
    const pend = this.simState.state.pendingCard
    if (!pend) return false
    const ok = this.research.chooseCard(pend.choices[i])
    if (ok) {
      audioSys.play('wc.ok', { volume: 0.8 })
      // 此前未手动暂停的局恢复运行（胜负终局/暂停菜单各自维持原冻结态）
      const s = this.simState.state
      if (s.outcome === 'playing' || s.sandbox) this.paused = false
      logger.info('[WarmCurrent] 海克斯选卡完成，仿真恢复运行')
    }
    return ok
  }

  // ═══════════════════════════════════════════
  //  HUD 视图模型（UI 脚本每帧消费；实现下沉 ViewModelComponent）
  // ═══════════════════════════════════════════

  /** HUD 视图模型（WarmCurrentVM；各 UI 行为脚本 8Hz 差分同步消费） */
  buildViewModel(): WarmCurrentVM {
    return this.vm.buildViewModel()
  }

  // ─── 船队设计流（2026-09-20 下沉 ShipDesignComponent；以下为兼容转发门面，调用面不变） ───

  /** 船坞造船面板数据装配（shipyardSel → HudShipyard；实现见 ShipDesignComponent） */
  buildShipyardVM(dockId: number): HudShipyard | null { return this.ship.buildShipyardVM(dockId) }
  /** 船坞面板：选船型 */
  setShipyardHull(hullId: string): void { this.ship.setShipyardHull(hullId) }
  /** 船坞面板：勾选/取消模块 */
  toggleShipyardModule(moduleId: string): void { this.ship.toggleShipyardModule(moduleId) }
  /** 装配台点部位 */
  selectShipyardSlot(type: string, idx: number): void { this.ship.selectShipyardSlot(type, idx) }
  /** 装配台点「+ 加号」 */
  openShipyardAddMenu(): void { this.ship.openShipyardAddMenu() }
  /** 部位选择小面板：选部位 */
  pickShipyardAddPart(type: string): void { this.ship.pickShipyardAddPart(type) }
  /** 部位选择小面板：关闭 */
  closeShipyardAddMenu(): void { this.ship.closeShipyardAddMenu() }
  /** 部位选件（(type, idx) 定位实例） */
  pickShipyardSlotModule(type: string, idx: number, moduleId: string): void { this.ship.pickShipyardSlotModule(type, idx, moduleId) }
  /** 保存当前面板选择为设计模板 */
  saveShipDesign(): boolean { return this.ship.saveShipDesign() }
  /** 删除设计模板 */
  deleteShipDesign(idx: number): boolean { return this.ship.deleteShipDesign(idx) }
  /** 载入设计模板 → 面板选择 */
  loadShipDesign(idx: number): boolean { return this.ship.loadShipDesign(idx) }
  /** 一键推荐配置 */
  recommendShipDesign(): { hull: string; modules: string[] } { return this.ship.recommendShipDesign() }
  /** 一键推荐并应用到面板选择 */
  applyShipyardRecommend(): void { this.ship.applyShipyardRecommend() }

}
