/**
 * WarmCurrentGameInstance — 游戏实例（hoi4 同款 SwitchToScene 流程 + 调试桥）
 *
 * 单场景：WarmCurrentMap（mode="main" → WarmCurrentGameMode）。
 * 配置加载在构造期启动（glob 异步）；表就绪后补一次 balance refresh + 重开
 * （GameMode.InitGame 时表可能未就绪，B 已用等值代码默认值兜底）。
 * window.__warmCurrent 调试桥供 GM/e2e 驱动（组件 API：mode.transport.* 等）。
 */
import * as THREE from 'three'
import { ConfigRegistry, GameInstance, logger, PhySys } from '@/engine'
import type { PlayerController } from '@/engine'
import { WarmCurrentGameMode, WARM_CURRENT_SCENE } from './gameplay/base/WarmCurrentGameMode'
import { WarmCurrentPlayerController } from './gameplay/base/WarmCurrentPlayerController'
import { WarmCurrentConfigLoader } from './WarmCurrentConfigLoader'
import { endpointPos } from './gameplay/core/helpers'
import type { Endpoint } from './gameplay/core/types'

declare global {
  interface Window {
    __warmCurrent?: WarmCurrentDebugBridge
  }
}

/** e2e/GM 调试桥（镜像 arena 的 __arena 模式） */
export interface WarmCurrentDebugBridge {
  ready(): boolean
  mode(): WarmCurrentGameMode | null
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
  /** 端点名 → 建航线：'earth' | 'moon' | 'europa' | 'mars' | 'station:<id>' */
  createRoute(a: string, b: string): boolean
  addShip(routeId: number): boolean
  removeShip(routeId: number): boolean
  deleteRoute(routeId: number): boolean
  routes(): Array<{ id: number; direction: string; ships: number }>
  buildShip(): boolean
  rebuildShip(shipId: number): boolean
  toggleOverclock(line: string): boolean
  forceResearch(): string | null
  chooseCardByIndex(i: number): boolean
  setNodes(n: number): void
  setH3(v: number): void
  buildStation(routeId: number): boolean
  upgradeStation(stationId: number): boolean
  selectStation(stationId: number): void
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
}

export class WarmCurrentGameInstance extends GameInstance {
  private _gameMode: WarmCurrentGameMode | null = null
  private _controller: WarmCurrentPlayerController | null = null
  private _configTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    super()
    // 配置表注册（glob 异步加载；表就绪后 watchConfigs 补一次 refresh）
    new WarmCurrentConfigLoader().init()
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
    logger.info('[WarmCurrent] 游戏实例启动')
    const ok = this.world.SwitchToScene(WARM_CURRENT_SCENE, () => {
      const mode = this.world.gameMode as WarmCurrentGameMode
      this._gameMode = mode
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
      this.installDebugBridge()
      this.watchConfigs()
    })
    if (!ok) logger.error('[WarmCurrent] 切换星图场景失败')
    return ok
  }

  /** 配置表异步就绪后补一次 refresh+重开（InitGame 时可能尚未加载完） */
  private watchConfigs(): void {
    if (this._configTimer) return
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
      }
    }, 100)
  }

  // ─── 调试桥（window.__warmCurrent） ───

  private installDebugBridge(): void {
    const instance = this
    const bridge: WarmCurrentDebugBridge = {
      ready: () => !!instance._gameMode && !!instance._gameMode.world,
      mode: () => instance._gameMode,
      state: () => instance._gameMode?.simState.state ?? null,
      vm: () => instance._gameMode?.buildViewModel() ?? null,
      stepTicks: (n) => {
        for (let i = 0; i < n; i++) instance.world.manualTick(1 / 60)
      },
      pointerDown: (x, y) => instance._gameMode?.onMapPointerDown({ x, y }),
      pointerMove: (x, y) => instance._gameMode?.onMapPointerMove({ x, y }),
      pointerUp: (x, y) => instance._gameMode?.onMapPointerUp({ x, y }),
      createRoute: (a, b) => {
        const mode = instance._gameMode
        if (!mode) return false
        const toEp = (name: string): Endpoint | null => {
          if (name === 'earth') return { kind: 'earth' }
          if (name === 'moon' || name === 'europa' || name === 'mars') return { kind: 'star', star: name }
          if (name.startsWith('station:')) return { kind: 'station', stationId: Number(name.slice(8)) }
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
      buildShip: () => instance._gameMode?.transport.tryBuildShip() ?? false,
      rebuildShip: (shipId) => instance._gameMode?.transport.tryRebuildShip(shipId) ?? false,
      toggleOverclock: (line) =>
        instance._gameMode?.research.toggleOverclock(line as import('./gameplay/core/types').ResearchLineId) ?? false,
      forceResearch: () => instance._gameMode?.research.forceResearch() ?? null,
      chooseCardByIndex: (i) => instance._gameMode?.chooseCardByIndex(i) ?? false,
      setNodes: (n) => {
        const mode = instance._gameMode
        if (mode) mode.simState.state.nodes = Math.max(1, Math.min(12, Math.round(n)))
      },
      setH3: (v) => {
        const mode = instance._gameMode
        if (mode) mode.simState.state.earthH3 = Math.max(0, v)
      },
      buildStation: (routeId) => instance._gameMode?.stations.tryBuildStation(routeId) ?? false,
      upgradeStation: (stationId) => instance._gameMode?.stations.tryUpgradeStation(stationId) ?? false,
      selectStation: (stationId) => {
        const mode = instance._gameMode
        if (mode) mode.selection = { type: 'station', id: stationId }
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
    if (name.startsWith('station:')) return endpointPos(s, { kind: 'station', stationId: Number(name.slice(8)) })
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
    if (!this._gameMode) return null
    return this._gameMode.cameraManager.GetActiveCameraObject()
  }

  override stop() {
    if (!this._controller && !this._gameMode) return
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
  }

  override destroy() {
    this.stop()
    super.destroy()
    this.world.Destroy()
  }
}
