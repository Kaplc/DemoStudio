/**
 * WarmCurrentGameInstance — 游戏实例（hoi4 同款 SwitchToScene 流程 + 调试桥 + 三槽位存档）
 *
 * 场景路由（对齐 fish 三阶段结构）：
 *  - 菜单场景 WarmCurrentMenu（mode="menu" → WarmCurrentMenuGameMode）：启动默认进入
 *  - 星图场景 WarmCurrentMap（mode="warm-main" → WarmCurrentGameMode）：点击开始后切换
 * 存档：三个 SaveSlotComponent（projects/warm-current/data/slot{1..3}.json），
 * 手动落盘模型（暂停菜单保存/读取；游戏过程只写内存）。
 * window.__warmCurrent 调试桥供 GM/e2e 驱动（组件 API：mode.transport.* 等）。
 */
import * as THREE from 'three'
import { ConfigRegistry, GameInstance, LoadingSettle, logger, PhySys, SaveSlotComponent, UIScriptComponent } from '@/engine'
import type { Actor, PlayerController, KVValue } from '@/engine'
import { WarmCurrentGameMode, WARM_CURRENT_SCENE } from './gameplay/base/WarmCurrentGameMode'
import { WarmCurrentMenuGameMode } from './gameplay/menu/WarmCurrentMenuGameMode'
import type { MenuAction } from './gameplay/menu/WarmCurrentMenuGameMode'
import { WarmCurrentPlayerController } from './gameplay/base/WarmCurrentPlayerController'
import { WarmCurrentConfigLoader } from './WarmCurrentConfigLoader'
import { endpointPos, snapToGrid, starPosAt } from './gameplay/core/helpers'
import { isShipyardType } from './gameplay/systems/OrbitBuildComponent'
import { B } from './gameplay/core/balance'
import LoadingPanelScript, { LOADING_WIDGET } from './gameplay/ui/LoadingPanelScript.script'

import { SAVE_KEY, SAVE_SLOT_FILES, SAVE_SLOT_COUNT, serializeSlot, readSlotMetaWithSlot, findLatestSlotMeta } from './gameplay/core/save'
import type { Endpoint, PlanetBodyId, SimState } from './gameplay/core/types'

/** loading 面板结算组名（引擎 CloudLayerComponent / warm starTextures 同名登记） */
const LOADING_GROUP = 'scene-enter'
let loadingSeq = 0
const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()))

declare global {
  interface Window {
    __warmCurrent?: WarmCurrentDebugBridge
  }
}

/** e2e/GM 调试桥（镜像 arena 的 __arena 模式） */
export interface WarmCurrentDebugBridge {
  ready(): boolean
  mode(): WarmCurrentGameMode | null
  menuMode(): WarmCurrentMenuGameMode | null
  /** 活动仿真状态（活引用，e2e 直接读字段） */
  state(): import('./gameplay/core/types').SimState | null
  /** HUD 视图模型快照 */
  vm(): ReturnType<WarmCurrentGameMode['buildViewModel']> | null
  /** 固定步推进 n 帧（1/60s each，走完整 world.manualTick） */
  stepTicks(n: number): void
  /** 星图画布坐标指针（down/move/up） */
  pointerDown(x: number, y: number): void
  pointerMove(x: number, y: number): void
  pointerUp(x: number, y: number): void
  /** 真实 InputSys 点击管线（down+up 同步成对；e2e 屏幕坐标交互——全息轻点等——共用，
   *  绕过 DOM 投递但走完整 controller.OnPointerDownScreen + released 广播链） */
  inputTap(x: number, y: number): void
  /** 端点名 → 建航线：'earth' | 'moon' | 'europa' | 'mars' | 'building:<id>' */
  createRoute(a: string, b: string): boolean
  addShip(routeId: number): boolean
  removeShip(routeId: number): boolean
  deleteRoute(routeId: number): boolean
  routes(): Array<{ id: number; direction: string; ships: number }>
  buildShip(): boolean
  rebuildShip(shipId: number): boolean
  /** 研究点分配（delta = +1 分配 / −1 回收；科研面板 +/− 同款回调） */
  allocateResearch(line: string, delta: 1 | -1): boolean
  /** 聚能环建设点数分配（delta = +1 / −1；环详情面板 +/− 同款回调） */
  allocateBuildPoints(delta: 1 | -1): boolean
  /** 把建设进度直接推满（e2e/GM 用；下帧 tickBuild 结算交点 +1） */
  forceBuild(): void
  forceResearch(): string | null
  chooseCardByIndex(i: number): boolean
  /** 直接建成 N 个环段（25 槽位制；旧 setNodes 口径更名） */
  setSlots(n: number): void
  setH3(v: number): void
  /** 环段建筑（环构筑）：安装 / 发起拆除（建设泵反向灌入）/ 泵目标切换 / 装入表探针 */
  installRing(slot: number, buildingId: string): boolean
  demolishRing(slot: number): boolean
  setRingDemolishActive(active: boolean): void
  ringInfo(): { built: number; total: number; buildings: (string | null)[]; demolish: { slot: number; progress: number; active: boolean } | null; fees: number[] } | null
  /** 建筑系统（building 表驱动）：放置（x/y 画布系，内部网格吸附）/ 拆除 / 选中 */
  placeBuilding(type: string, x: number, y: number): boolean
  /** 网格吸附预演（snapToGrid 同口径，不落盘）— e2e 按格点摆放建筑/选点位用 */
  snapPos(x: number, y: number): { x: number; y: number }
  demolishBuilding(id: number): boolean
  selectBuilding(id: number): void
  /** 建筑强化（一槽二选一）：装 / 拆 */
  installUpgrade(buildingId: number, upgradeId: string): boolean
  removeUpgrade(buildingId: number): boolean
  /** 船型模块造船（hull = ship_hull 行键；modules 逗号分隔 ship_module 行键；GM 无船坞 = 原价） */
  buildShipHull(hull: string, modulesCsv?: string): boolean
  /** 耀斑预警态（框选决策窗口；确定性验证用）+ 框选/决策直驱 */
  beginFlareWarn(): void
  selectShipsInRect(x0: number, y0: number, x1: number, y1: number): number
  orderShips(order: string): number
  clearShipSelection(): void
  /** 建筑模式（星图网格放置）：进入 / 取消 / 当前状态 */
  enterBuildMode(type: string): boolean
  cancelBuildMode(): void
  buildModeInfo(): { typeId: string } | null
  /** 航线编辑模式开关（拖线门槛）/ 当前状态；openPlanetInfo 供点星球面板 e2e 直驱 */
  setRouteEditMode(on: boolean): void
  routeEditMode(): boolean
  openPlanetInfo(body: string): void
  /** 轨道建设面板（点行星 → 近地轨道建设）：开合 + 表驱动落位（e2e 直驱） */
  openOrbitBuild(anchor: string): void
  closeOrbitBuild(): void
  placeOrbitBuilding(type: string, anchor: string): boolean
  /** 全息勘探（2026-09-12）：开合 / 选中矿点 / 落位矿建 / 面板数据快照 / 矿点屏幕坐标（真实点击测试） */
  openHologram(body: string): void
  closeHologram(): void
  selectHoloDeposit(id: string | null): void
  placeMine(depositId: string, typeId: string): boolean
  holoInfo(): import('./gameplay/base/WarmCurrentGameMode').HudHologram | null
  holoMarkerScreenPos(depositId: string): { x: number; y: number } | null
  /** 全息地球（2026-09-12）：工具切换 / 节点直落 / 地表建筑 / 节点屏幕坐标 / 目标 lat-lon 屏幕坐标 */
  setHoloTool(kind: 'ring' | 'building' | null, typeId?: string): void
  placeRingNode(lat: number, lon: number): string | null
  placeSurfaceBuilding(typeId: string, lat: number, lon: number): boolean
  holoNodeScreenPos(slot: number): { x: number; y: number } | null
  holoSurfaceScreenPos(lat: number, lon: number): { x: number; y: number } | null
  /** 船坞造船面板（e2e 直驱）：打开第一个（或指定 id）已建成船坞 */
  openShipyard(id?: number): boolean
  /** 把第一艘在途船拨到指定航段进度（0~1）— 耀斑护盾判定用 */
  setShipFlying(progress: number): boolean
  triggerFlare(): void
  triggerWindow(): void
  suppressFlare(): void
  startMission(): boolean
  retryAct(): boolean
  enterSandbox(): void
  restart(): void
  togglePause(): void
  cycleSpeed(): void
  /** 场景/存档（暂停菜单同链路） */
  startNewGame(): void
  saveSlot(n: number): Promise<boolean>
  loadSlot(n: number): Promise<boolean>
  slotMeta(n: number): ReturnType<typeof readSlotMetaWithSlot>
  togglePauseMenu(): boolean
  /** 视图状态快照（视角/行星系 e2e 用） */
  view(): {
    viewMode: 'earth' | 'solar'
    planetFocusBody: string
    viewSwitching: boolean
    loadingPanel: boolean
    cameraX: number
    cameraY: number
    cameraZ: number
  } | null
  /** 渲染管线快照（2026-09-12 后处理改版 e2e 断言用）：后处理/bloom/色调映射 + 环境光强度 */
  renderInfo(): {
    postProcess: {
      enabled: boolean
      toneMapping: number
      bloom: { strength: number; radius: number; threshold: number } | null
    }
    ambientIntensity: number
  } | null
  /** 天体当前地图画布坐标（starPosAt 权威值；'sun'/'earth'/'moon'/行星名） */
  bodyPos(name: string): { x: number; y: number } | null
  /** 天体蓝图 Actor 当前世界坐标（渲染位置；含行星系舞台变换） */
  bodyWorldPos(name: string): { x: number; y: number; z: number } | null
  /** 原子双击行星（单次调用内同步两次按下-抬起，走真实 onMapPointerDown 双击链路） */
  doubleClickPlanet(name: string): boolean
  /** 引擎探针（e2e 诊断专用）：与运行时同模块图的 PhySys 单例 */
  phy(): typeof import('@/engine').PhySys
}

export class WarmCurrentGameInstance extends GameInstance {
  private _gameMode: WarmCurrentGameMode | null = null
  private _menuMode: WarmCurrentMenuGameMode | null = null
  private _controller: WarmCurrentPlayerController | null = null
  private _configTimer: ReturnType<typeof setInterval> | null = null

  /** loading 面板状态（进图遮罩：菜单亮出 → 切换销毁 → 星图 setup 同任务重建 → 结算关闭） */
  private _loading: { actor: Actor; script: LoadingPanelScript | null } | null = null
  private _loadingActive = false
  private _loadingStage = ''
  private _loadingTimeout: ReturnType<typeof setTimeout> | null = null
  private _loadingSettleCancel: (() => void) | null = null

  /** 三槽位存档（KV 内存优先，暂停菜单显式落盘/回读） */
  readonly saveSlots: SaveSlotComponent[]

  constructor() {
    super()
    // 配置表注册（glob 异步加载；表就绪后 watchConfigs 补一次 refresh）
    new WarmCurrentConfigLoader().init()
    this.saveSlots = SAVE_SLOT_FILES.map(
      (filePath) => new SaveSlotComponent(this, { filePath }),
    )
    this.saveSlots.forEach((slot, i) => { slot.name = `SaveSlotComponent#slot${i + 1}` })
    for (const slot of this.saveSlots) this.addComponent(slot)
  }

  override get gameMode(): WarmCurrentGameMode {
    if (!this._gameMode) throw new Error('[WarmCurrentGameInstance] gameMode 未初始化（start 未调用）')
    return this._gameMode
  }

  /** 兼容基类契约（start 前调用会抛错，hoi4/fish 同款） */
  override createGameMode(): WarmCurrentGameMode {
    throw new Error('[WarmCurrentGameInstance] 走 SwitchToScene 创建 GameMode，勿直接 createGameMode')
  }

  override get controller(): PlayerController | null {
    return this._controller
  }

  override start(): boolean {
    logger.info('[WarmCurrent] 游戏实例启动（默认进入主菜单）')
    return this.switchToMenuScene()
  }

  // ════════════════════════════════════════════
  //  场景路由（menu ↔ main）
  // ════════════════════════════════════════════

  /** 进入主菜单场景（启动默认；游戏内「回主菜单」复用） */
  switchToMenuScene(): boolean {
    const ok = this.world.SwitchToScene('WarmCurrentMenu', () => {
      const mode = this.world.gameMode as WarmCurrentMenuGameMode
      this._menuMode = mode
      this._gameMode = null
      this._controller = null
      mode.onMenuAction = (action: MenuAction) => { void this.handleMenuAction(action) }
      mode.cameraManager.RegisterCamera(mode.gameCamera)
      // 菜单场景也挂调试桥：e2e/GM 需经 startNewGame() 进入星图（桥在切图时才 ready）
      this.installDebugBridge()
      if (this.world.gameRenderer?.uiLayer) {
        PhySys.setup(mode.gameCamera.camera, this.world.gameRenderer.uiLayer)
      } else {
        logger.error('[WarmCurrent] 菜单场景 uiLayer 未就绪（按钮可能点不到）')
      }
    })
    if (!ok) logger.error('[WarmCurrent] 切换主菜单场景失败')
    return ok
  }

  /** 菜单动作分发：新开局 / 读最近档 */
  private async handleMenuAction(action: MenuAction): Promise<void> {
    if (action === 'new') {
      this.startNewGame()
      return
    }
    // load：直接扫三槽位文件取最近档（不依赖内存 KV——主菜单阶段游戏未运行，内存表恒空）
    const api = window.electronAPI
    if (!api?.readJsonFile) {
      logger.warn('[WarmCurrent] 主菜单读取存档：electronAPI 不可用（浏览器模式），停留菜单')
      return
    }
    const best = await findLatestSlotMeta(api.readJsonFile)
    if (!best) {
      logger.warn('[WarmCurrent] 主菜单读取存档：三槽全空，停留菜单')
      return
    }
    logger.info(`[WarmCurrent] 主菜单读取存档：最近档槽${best.slot} @ ${best.savedAt}`)
    await this.enterMapWithLoading(async () => {
      if (!this.switchToMapScene()) return
      const ok = await this.loadSlot(best.slot)
      if (!ok) logger.error(`[WarmCurrent] 主菜单读取槽${best.slot}失败`)
    })
  }

  /** 进入星图场景开始新的一局（菜单「新的远征」入口） */
  startNewGame(): void {
    void this.enterMapWithLoading(() => {
      this.switchToMapScene()
    })
  }

  /**
   * 进图统一入口（新的远征 / 读档）：loading 面板全程遮罩，完全加载完毕才关闭。
   * 流程：当前场景（菜单）亮面板 → 让出两帧真上屏 → 登记结算监听 → 同步切换
   * （菜单面板随场景销毁，星图 setup 回调同任务重建——同步切换无渲染帧空隙）
   * → 云图柔化/海洋贴图/配置覆盖等尾任务全部结算 → 关面板。
   */
  private async enterMapWithLoading(runSwitch: () => void | Promise<void>): Promise<void> {
    this._loadingActive = true
    this._loadingStage = '正在连接星域…'
    this.spawnLoadingPanel()
    await nextFrame()
    await nextFrame()
    // 结算监听必须在切换前登记：云图/海洋任务在切换的 BeginPlay 内 begin
    this._loadingSettleCancel = LoadingSettle.onSettled(LOADING_GROUP, () => this.finishLoading())
    const finishEnter = LoadingSettle.task(LOADING_GROUP, `enter-map#${++loadingSeq}`)
    try {
      await runSwitch()
    } finally {
      finishEnter()
    }
    this.setLoadingStage('正在整备大气层…')
    // 安全网：任何尾任务异常挂起也保证面板最终关闭
    this._loadingTimeout = setTimeout(() => {
      logger.warn('[WarmCurrent] loading 等待超时（20s），强制关闭面板')
      this.finishLoading()
    }, 20_000)
  }

  /** 生成 loading 面板（显式顶层：挂 uiScene 根、排 HUD 子树之后 → 盖过全部常驻/浮动面板） */
  private spawnLoadingPanel(): void {
    this.destroyLoadingPanel()
    // null = 显式顶层（undefined 会回落挂 HUD 子树，但 16 个子面板在其后生成、
    // 树序渲染会把它们压在面板之上——实测踩坑）
    const actor = this.world.ui.spawnUIActor(LOADING_WIDGET, null)
    if (!actor) {
      logger.error('[WarmCurrent] loading 面板生成失败（继续加载，仅无遮罩）')
      return
    }
    const script = (actor.getComponent(UIScriptComponent)?.instance as LoadingPanelScript | null) ?? null
    this._loading = { actor, script }
    if (script && this._loadingStage) script.setStage(this._loadingStage)
  }

  private destroyLoadingPanel(): void {
    const panel = this._loading
    this._loading = null
    if (!panel || panel.actor.bPendingDestroy) return
    this.world.ui.destroyUIActor(panel.actor)
  }

  /** 面板脚本挂载回调（脚本 onStart 触发；跨场景重建时回填引用并推送当前阶段） */
  onLoadingPanelMounted(script: LoadingPanelScript): void {
    if (!this._loading) return
    this._loading.script = script
    if (this._loadingStage) script.setStage(this._loadingStage)
  }

  onLoadingPanelDestroyed(script: LoadingPanelScript): void {
    const panel = this._loading
    if (panel?.script === script) panel.script = null
  }

  private setLoadingStage(stage: string): void {
    this._loadingStage = stage
    if (this._loading?.script) this._loading.script.setStage(stage)
  }

  /** 全部尾任务结算：关面板（幂等；超时安全网同走此处） */
  private finishLoading(): void {
    if (!this._loadingActive) return
    this._loadingActive = false
    if (this._loadingTimeout) {
      clearTimeout(this._loadingTimeout)
      this._loadingTimeout = null
    }
    this._loadingSettleCancel?.()
    this._loadingSettleCancel = null
    this.destroyLoadingPanel()
    logger.info('[WarmCurrent] 完全加载完毕，loading 面板关闭')
  }

  /** 切换星图场景（mode="warm-main" → WarmCurrentGameMode） */
  private switchToMapScene(): boolean {
    const ok = this.world.SwitchToScene(WARM_CURRENT_SCENE, () => {
      const mode = this.world.gameMode as WarmCurrentGameMode
      this._gameMode = mode
      this._menuMode = null
      mode.cameraManager.RegisterCamera(mode.gameCamera)
      if (this.world.gameRenderer?.uiLayer) {
        // 接入 UI 点击射线（fish 同款）：无此调用 PhySys._ready=false，HUD 按钮全部点不到
        PhySys.setup(mode.gameCamera.camera, this.world.gameRenderer.uiLayer)
      }
      if (mode.controller instanceof WarmCurrentPlayerController) {
        this._controller = mode.controller
      } else {
        logger.error('[WarmCurrent] controller 未就绪')
      }
      // loading 面板跨场景重建：菜单侧面板已随 DestroyAllActors 销毁，此处同任务
      // 重建（整个切换是单次同步任务，中间无渲染帧，玩家看不到面板消失）
      if (this._loadingActive) {
        this._loadingStage = '正在生成天体与星图…'
        this.spawnLoadingPanel()
      }
      this.installDebugBridge()
      this.watchConfigs()
    })
    if (!ok) logger.error('[WarmCurrent] 切换星图场景失败')
    return ok
  }

  /** 配置表异步就绪后补一次 refresh+重开（InitGame 时可能尚未加载完） */
  private watchConfigs(): void {
    if (this._configTimer) return
    // 配置覆盖也是进图尾任务之一：登记进结算组，应用完毕（或超时兜底）才放行关面板
    const finishCfg = LoadingSettle.task(LOADING_GROUP, `config-apply#${++loadingSeq}`)
    const started = Date.now()
    this._configTimer = setInterval(() => {
      let ready = false
      try {
        ready = !!ConfigRegistry.getConfig('warm-current.global')
      } catch {
        ready = false
      }
      if (ready || Date.now() - started > 5000) {
        if (this._configTimer) clearInterval(this._configTimer)
        this._configTimer = null
        if (ready && this._gameMode) {
          logger.info('[WarmCurrent] 配置表就绪，应用覆盖值')
          this._gameMode.restart()
        }
        finishCfg()
      }
    }, 100)
  }

  // ════════════════════════════════════════════
  //  三槽位存档（暂停菜单 / GM / 调试桥共用链路）
  // ════════════════════════════════════════════

  /** 保存到槽位 n（1..3）：sim 深快照 → KV → 强制落盘（首存也创建文件） */
  async saveSlot(n: number): Promise<boolean> {
    const slot = this.saveSlots[n - 1]
    const mode = this._gameMode
    if (!slot || !mode) {
      logger.warn(`[WarmCurrent] saveSlot(${n}) 无效：槽位或游戏模式未就绪`)
      return false
    }
    slot.set(SAVE_KEY, serializeSlot(mode.simState.state, new Date().toISOString()) as unknown as KVValue)
    const ok = await slot.flush(true)
    logger.info(`[WarmCurrent] 手动保存槽${n}${ok ? '成功' : '失败'} → ${SAVE_SLOT_FILES[n - 1]}`)
    return ok
  }

  /** 读取槽位 n（1..3）：load 文件 → 校验 → 恢复 sim 状态与 rng */
  async loadSlot(n: number): Promise<boolean> {
    const slot = this.saveSlots[n - 1]
    const mode = this._gameMode
    if (!slot || !mode) {
      logger.warn(`[WarmCurrent] loadSlot(${n}) 无效：槽位或游戏模式未就绪`)
      return false
    }
    const loaded = await slot.load()
    if (!loaded) {
      logger.warn(`[WarmCurrent] 槽${n} 无存档（空栏）`)
      return false
    }
    const payload = slot.get(SAVE_KEY) as { sim?: SimState } | null
    if (!payload?.sim) {
      logger.warn(`[WarmCurrent] 槽${n} payload 缺失 sim 字段`)
      return false
    }
    const restored = mode.restoreFromSave(payload.sim)
    if (!restored) {
      logger.warn(`[WarmCurrent] 槽${n} 存档结构校验失败，拒绝载入`)
      return false
    }
    logger.info(`[WarmCurrent] 手动读取槽${n}成功（time=${restored.state.time.toFixed(0)}s act=${restored.state.act}）`)
    return true
  }

  /** 槽位 n 摘要（暂停菜单列表 / 调试桥；空档返回 null） */
  slotMeta(n: number): ReturnType<typeof readSlotMetaWithSlot> {
    const slot = this.saveSlots[n - 1]
    if (!slot) return null
    return readSlotMetaWithSlot(slot.toObject(), n)
  }

  // ─── 调试桥（window.__warmCurrent） ───

  private installDebugBridge(): void {
    const instance = this
    const bridge: WarmCurrentDebugBridge = {
      // loading 面板活跃期不算就绪：e2e/GM 在面板关闭（完全加载完毕）后才操作
      ready: () => !!instance._gameMode && !!instance._gameMode.world && !instance._loadingActive,
      mode: () => instance._gameMode,
      menuMode: () => instance._menuMode,
      state: () => instance._gameMode?.simState.state ?? null,
      vm: () => instance._gameMode?.buildViewModel() ?? null,
      stepTicks: (n) => {
        for (let i = 0; i < n; i++) instance.world.manualTick(1 / 60)
      },
      pointerDown: (x, y) => instance._gameMode?.onMapPointerDown({ x, y }),
      pointerMove: (x, y) => instance._gameMode?.onMapPointerMove({ x, y }),
      pointerUp: (x, y) => instance._gameMode?.onMapPointerUp({ x, y }),
      inputTap: (x, y) => {
        const controller = instance.controller
        instance.inputSys.handlePointerDown(x, y, undefined, controller, 0)
        instance.inputSys.handlePointerUp(undefined, controller, 0)
      },
      createRoute: (a, b) => {
        const mode = instance._gameMode
        if (!mode) return false
        const toEp = (name: string): Endpoint | null => {
          if (name === 'earth') return { kind: 'earth' }
          if (name === 'moon' || name === 'europa' || name === 'mars') return { kind: 'star', star: name }
          if (name.startsWith('building:')) return { kind: 'building', buildingId: Number(name.slice(9)) }
          return null
        }
        const ea = toEp(a)
        const eb = toEp(b)
        if (!ea || !eb) return false
        return mode.transport.tryCreateRoute(ea, eb)
      },
      addShip: (routeId) => instance._gameMode?.transport.tryAddShip(routeId) ?? false,
      removeShip: (routeId) => instance._gameMode?.transport.tryRemoveShip(routeId) ?? false,
      deleteRoute: (routeId) => instance._gameMode?.transport.tryDeleteRoute(routeId) ?? false,
      routes: () => {
        const s = instance._gameMode?.simState.state
        return s ? s.routes.map((r) => ({ id: r.id, direction: r.direction, ships: r.shipIds.length })) : []
      },
      buildShip: () => instance._gameMode?.transport.tryBuildShip('standard', []) ?? false,
      rebuildShip: (shipId) => instance._gameMode?.transport.tryRebuildShip(shipId) ?? false,
      allocateResearch: (line, delta) =>
        instance._gameMode?.research.allocateResearch(line as import('./gameplay/core/types').ResearchLineId, delta) ?? false,
    forceResearch: () => instance._gameMode?.research.forceResearch() ?? null,
    allocateBuildPoints: (delta) => instance._gameMode?.ringBuild.allocateBuildPoints(delta) ?? false,
    forceBuild: () => {
      const m = instance._gameMode
      if (m) m.simState.state.ringBuildProgress = 1
    },
      chooseCardByIndex: (i) => instance._gameMode?.chooseCardByIndex(i) ?? false,
      setSlots: (n) => {
        const mode = instance._gameMode
        if (!mode) return
        const s = mode.simState.state
        s.ringSlots = Math.max(1, Math.min(B.ringSlots, Math.round(n)))
        // 装入表长度对齐（GM 抽象口径：表总长恒 ringSlots 总数）
        if (!Array.isArray(s.ringBuildings) || s.ringBuildings.length !== B.ringSlots) {
          s.ringBuildings = Array.from({ length: B.ringSlots }, (_, i) => s.ringBuildings?.[i] ?? null)
        }
        // 节点落位表长度对齐（v13；GM 抽象口径同上）
        if (!Array.isArray(s.ringNodes) || s.ringNodes.length !== B.ringSlots) {
          s.ringNodes = Array.from({ length: B.ringSlots }, (_, i) => s.ringNodes?.[i] ?? null)
        }
      },
      setH3: (v) => {
        const mode = instance._gameMode
        if (mode) mode.simState.state.earthH3 = Math.max(0, v)
      },
      placeBuilding: (type, x, y) => {
        const mode = instance._gameMode
        if (!mode) return false
        const snapped = snapToGrid(x, y)
        return mode.buildings.tryPlace(type, snapped.x, snapped.y)
      },
      snapPos: (x, y) => snapToGrid(x, y),
      demolishBuilding: (id) => instance._gameMode?.buildings.tryDemolish(id) ?? false,
      selectBuilding: (id) => {
        const mode = instance._gameMode
        if (mode) {
          mode.selection = { type: 'building', id }
          mode.openBuildingDetail(id)
        }
      },
      installRing: (slot, buildingId) => instance._gameMode?.ringBuild.installBuilding(slot, buildingId) ?? false,
      demolishRing: (slot) => instance._gameMode?.ringBuild.startDemolish(slot) ?? false,
      setRingDemolishActive: (active) => instance._gameMode?.ringBuild.setDemolishActive(active),
      ringInfo: () => {
        const mode = instance._gameMode
        if (!mode) return null
        const s = mode.simState.state
        return {
          built: s.ringSlots,
          total: B.ringSlots,
          buildings: s.ringBuildings,
          demolish: s.ringDemolish,
          fees: s.ringBuildings.map((_, i) => mode.ringBuild.demolishFeeOf(i)),
        }
      },
      installUpgrade: (buildingId, upgradeId) => instance._gameMode?.buildings.tryInstallUpgrade(buildingId, upgradeId) ?? false,
      removeUpgrade: (buildingId) => instance._gameMode?.buildings.tryRemoveUpgrade(buildingId) ?? false,
      buildShipHull: (hull, modulesCsv) => {
        const modules = (modulesCsv ?? '').split(',').map((x) => x.trim()).filter(Boolean)
        return instance._gameMode?.transport.tryBuildShip(hull, modules) ?? false
      },
      beginFlareWarn: () => instance._gameMode?.hazards.beginFlareWarn(),
      selectShipsInRect: (x0, y0, x1, y1) => instance._gameMode?.selectShipsInRect(x0, y0, x1, y1) ?? 0,
      orderShips: (order) => instance._gameMode?.orderSelectedShips(order as never) ?? 0,
      clearShipSelection: () => instance._gameMode?.clearShipSelection(),
      enterBuildMode: (type) => instance._gameMode?.enterBuildMode(type) ?? false,
      cancelBuildMode: () => instance._gameMode?.cancelBuildMode(),
      buildModeInfo: () => instance._gameMode?.buildMode ?? null,
      setRouteEditMode: (on) => {
        const mode = instance._gameMode
        if (!mode) return
        if (mode.routeEditMode !== on) mode.toggleRouteEditMode()
      },
      routeEditMode: () => instance._gameMode?.routeEditMode ?? false,
      openPlanetInfo: (body) => instance._gameMode?.openPlanetInfo(body as import('./gameplay/core/helpers').SolarBodyId),
      openOrbitBuild: (anchor) => instance._gameMode?.openOrbitBuild(anchor as PlanetBodyId),
      closeOrbitBuild: () => instance._gameMode?.closeOrbitBuild(),
      placeOrbitBuilding: (type, anchor) => instance._gameMode?.orbitBuild.tryPlace(type, anchor as PlanetBodyId) ?? false,
      /** 全息勘探（2026-09-12）：开合 / 点选矿点 / 落位矿建 / 面板数据 / 矿点屏幕坐标（真实点击测试用） */
      openHologram: (body) => instance._gameMode?.openHologram(body as PlanetBodyId),
      closeHologram: () => instance._gameMode?.closeHologram(),
      selectHoloDeposit: (id) => instance._gameMode?.selectHoloDeposit(id ?? null),
      placeMine: (depositId, typeId) => instance._gameMode?.mining.tryPlace(depositId, typeId) ?? false,
      holoInfo: () => instance._gameMode?.buildViewModel().hologram ?? null,
      holoMarkerScreenPos: (depositId) => instance._gameMode?.holoMarkerScreenPos(depositId) ?? null,
      /** 全息地球（2026-09-12）：工具/直落/地表建筑/屏幕投影（真实点击测试用） */
      setHoloTool: (kind, typeId) => instance._gameMode?.setHoloTool(kind, typeId),
      placeRingNode: (lat, lon) => {
        const mode = instance._gameMode
        return mode ? mode.placeRingNodeAt(lat, lon) : '游戏未就绪'
      },
      placeSurfaceBuilding: (typeId, lat, lon) => instance._gameMode?.buildings.tryPlaceSurface(typeId, lat, lon) ?? false,
      holoNodeScreenPos: (slot) => instance._gameMode?.holoNodeScreenPos(slot) ?? null,
      holoSurfaceScreenPos: (lat, lon) => instance._gameMode?.holoLatLonScreenPos(lat, lon) ?? null,
      openShipyard: (id) => {
        const mode = instance._gameMode
        if (!mode) return false
        const yards = mode.simState.state.orbitBuildings.filter((x) => x.built && isShipyardType(x.type))
        const yard = id != null ? yards.find((x) => x.id === id) : yards[0]
        if (!yard) return false
        mode.openShipyardPanel(yard.id)
        return true
      },
      setShipFlying: (progress) => {
        const mode = instance._gameMode
        if (!mode) return false
        const ship = mode.simState.state.ships.find((x) => x.state === 'flying')
        if (!ship) return false
        ship.progress = Math.max(0, Math.min(1, progress))
        return true
      },
      triggerFlare: () => instance._gameMode?.hazards.triggerFlare(),
      triggerWindow: () => instance._gameMode?.hazards.triggerWindow(),
      suppressFlare: () => instance._gameMode?.hazards.suppressFlare(),
      startMission: () => instance._gameMode?.transport.startMarsMission() ?? false,
      retryAct: () => instance._gameMode?.simState.retryAct() ?? false,
      enterSandbox: () => instance._gameMode?.simState.enterSandbox(),
      restart: () => instance._gameMode?.restart(),
      togglePause: () => instance._gameMode?.togglePause(),
      cycleSpeed: () => instance._gameMode?.cycleSpeed(),
      startNewGame: () => instance.startNewGame(),
      saveSlot: (n) => instance.saveSlot(n),
      loadSlot: (n) => instance.loadSlot(n),
      slotMeta: (n) => instance.slotMeta(n),
      togglePauseMenu: () => instance._gameMode?.togglePauseMenu() ?? false,
      view: () => {
        const mode = instance._gameMode
        if (!mode) return null
        const cam = mode.gameCamera.camera.position
        return {
          viewMode: mode.viewMode,
          planetFocusBody: mode.planetFocusBody,
          viewSwitching: mode.viewSwitching,
          loadingPanel: !!mode.viewLoadingPanel,
          cameraX: cam.x,
          cameraY: cam.y,
          cameraZ: cam.z,
        }
      },
      renderInfo: () => {
        const renderer = instance.world?.gameRenderer
        if (!renderer) return null
        let ambientIntensity = -1
        renderer.scene.traverse((obj) => {
          const amb = obj as { isAmbientLight?: boolean; intensity?: number }
          if (amb.isAmbientLight) ambientIntensity = amb.intensity ?? -1
        })
        return { postProcess: renderer.postProcessInfo, ambientIntensity }
      },
      bodyPos: (name) => {
        const mode = instance._gameMode
        if (!mode) return null
        const p = starPosAt(mode.simState.state, name as import('./gameplay/core/helpers').SolarBodyId)
        // r = 天体显示半径（行星/卫星分支 starPosAt 不带 r；入轨抬底口径 e2e 需要）
        const node = (B.map.nodes as Record<string, { r: number } | undefined>)[name as string]
        return { ...p, r: node?.r }
      },
      bodyWorldPos: (name) => {
        const actor = instance._gameMode?.starActors.get(name as never)
        if (!actor) return null
        const p = actor.position
        return { x: p.x, y: p.y, z: p.z }
      },
      doubleClickPlanet: (name) => {
        const mode = instance._gameMode
        if (!mode) return false
        const p = starPosAt(mode.simState.state, name as import('./gameplay/core/helpers').SolarBodyId)
        mode.onMapPointerDown({ x: p.x, y: p.y })
        mode.onMapPointerUp({ x: p.x, y: p.y })
        mode.onMapPointerDown({ x: p.x, y: p.y })
        mode.onMapPointerUp({ x: p.x, y: p.y })
        return true
      },
      // 引擎探针（e2e 诊断专用）：返回本模块 import 的 PhySys（与运行时同模块图实例；
      // e2e 动态 import /src/... 会创建第二模块图实例，不能直接用）
      phy: () => PhySys,
    }
    window.__warmCurrent = bridge
    logger.info('[WarmCurrent] 调试桥已挂载 window.__warmCurrent')
  }

  /** 端点画布坐标（e2e 拖线用；桥外少用） */
  endpointPos(name: string): { x: number; y: number } | null {
    if (!this._gameMode) return null
    const s = this._gameMode.simState.state
    if (name === 'earth') return endpointPos(s, { kind: 'earth' })
    if (name === 'moon' || name === 'europa' || name === 'mars') return endpointPos(s, { kind: 'star', star: name })
    if (name.startsWith('building:')) return endpointPos(s, { kind: 'building', buildingId: Number(name.slice(9)) })
    return null
  }

  override tick(dt: number) {
    this.world.manualTick(dt)
  }

  override drawGizmos() {
    this.world.drawGizmos()
  }

  override syncCamera(_targetCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera, _aspect: number) {
    // 相机委托已改为 getActiveCamera()（渲染器直接用游戏相机）
  }

  override getActiveCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera | null {
    if (this._menuMode) return this._menuMode.cameraManager.GetActiveCameraObject()
    if (!this._gameMode) return null
    return this._gameMode.cameraManager.GetActiveCameraObject()
  }

  override stop() {
    if (!this._controller && !this._gameMode && !this._menuMode) return
    logger.info('[WarmCurrent] 停止游戏...')
    if (this._configTimer) {
      clearInterval(this._configTimer)
      this._configTimer = null
    }
    if (window.__warmCurrent) delete window.__warmCurrent
    this.world.DestroyAllActors()
    this.world.Pause()
    this._controller = null
    this._gameMode = null
    this._menuMode = null
  }

  override destroy() {
    this.stop()
    super.destroy()
    this.world.Destroy()
  }
}
