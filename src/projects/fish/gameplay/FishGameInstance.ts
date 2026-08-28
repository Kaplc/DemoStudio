/**
 * FishGameInstance — ClashMaster 游戏实例
 * 三阶段流程：主菜单 → 部落村庄基地 → 出征战斗/关卡攻城。
 * 每个阶段使用独立的 GameMode 管理场景和生命周期，
 * 并通过场景资产（JSON）切换场景氛围。
 */
import * as THREE from 'three'
import { GameInstance, World, PhySys, logger, CameraComponent, PlayerController, ConfigRegistry, DataTable, SaveSlotComponent, ToastSystem, ColorblindService, TweenSystem, spawnActor } from '@/engine'
import type { GameInstanceCallbacks } from '@/engine'
import { UIButtonComponent } from '@/engine/ui/UIButtonComponent'
import { FishMainMenuGameMode } from './menu/FishMainMenuGameMode'
import { FishBaseGameMode } from './base/FishBaseGameMode'
import { FishGameMode } from './game/FishGameMode'
import { FishLevelGameMode } from './level/FishLevelGameMode'
import { FishPlayerController } from './game/FishPlayerController'
import type { FishCannon } from './game/FishCannon'
import { FishConfigLoader } from '../FishConfigLoader'
import { ResourcesComponent } from './common/comp/ResourcesComponent'
import { TrainingComponent, type TrainingItem } from './common/comp/TrainingComponent'
import {
  FISH_SAVE_FILE,
  syncRuntimeKeys, writeMetaKeys, applyRuntime, sanitizeBuildings,
  resetRuntimeAndKeys, addClearedLevel,
} from './common/FishSaveAdapter'
import { GameEvents } from './common/GameEvents'
import { INITIAL_COINS } from './common/types'
import type { TroopType, LevelType } from './common/types'

type Phase = 'menu' | 'base' | 'game'

export class FishGameInstance extends GameInstance {
  readonly gameMode!: FishLevelGameMode

  /** 资源组件：金币（跨阶段共享，基地/出征同一钱包） */
  readonly resources: ResourcesComponent
  /** 训练部队组件：训练队列 + 军队（跨阶段保留，基地阶段推进倒计时） */
  readonly training: TrainingComponent
  /** 存档组件：KV 内存优先 + 手动落盘（写盘入口=存档菜单 saveGame；钩子转发保留在 stop/destroy/tick） */
  readonly save: SaveSlotComponent

  /** 各阶段 GameMode 引用（由 SwitchToScene 创建后存入，供 syncCamera 等使用） */
  private _menuGameMode: FishMainMenuGameMode | null = null
  private _baseGameMode: FishBaseGameMode | null = null
  private _gameMode: FishGameMode | null = null
  /** 关卡阶段 GameMode 引用（关卡复用 game 阶段，场景 mode="level" 创建） */
  private _levelGameMode: FishLevelGameMode | null = null

  private _phase: Phase = 'menu'
  /** 当前关卡 id（null = 普通出征战斗；进入关卡后 game 阶段加载关卡场景） */
  private _levelId: string | null = null
  private _controller: PlayerController | null = null
  pawn: FishCannon | null = null

  /** 跨阶段持久数据 */
  private _score = 0
  private _lastCannonLevel = 1
  /** 防止手动返回和 GameOver 回调重复触发 */
  private _returningToBase = false

  // ─── 持久化门控状态 ───
  /** KV 存档已加载完成（load 的 then 已跑过；会话内一次性置位） */
  private _kvReady = false
  /** 当前 base 场景初始布局已构建完成（FishBaseGameMode.BeginPlay 触发） */
  private _baseLayoutBuilt = false
  /** 布局恢复已完成或无需恢复（true 后 onLayoutChange 才向 KV 同步，防默认布局覆盖存档键） */
  private _baseRestored = false
  /** 挂起的布局恢复（KV 与布局双就绪后置位；tick 中两帧消费：先清场后重放） */
  private _pendingRestore = false
  /** 恢复第一步"清场"已执行（幽灵碰撞体等下一帧 manualTick 的 commitDestroy 移除） */
  private _restoreCleared = false

  private unsubGameState: (() => void) | null = null
  /** 防止 stop() 被重复调用 */
  private _stopped = false

  /** 游戏内事件总线 */
  readonly events: GameEvents

  constructor(renderContainer?: HTMLElement | null) {
    super()
    // 统一在此加载项目配置表（兵种/炮台/鱼种/鱼群节奏，各阶段 GameMode 共享）
    new FishConfigLoader((msg) => logger.info(msg)).init()
    // 资源组件：金币 + 药水（跨阶段共享钱包，初始金币 100，药水 0）
    this.resources = new ResourcesComponent(this, { coins: INITIAL_COINS, elixir: 0 })
    this.addComponent(this.resources)
    // 训练部队组件：军队容量 40
    this.training = new TrainingComponent(this, { maxHousing: 40 })
    this.addComponent(this.training)
    // 存档组件：整张 KV 表落盘到 src/projects/fish/data/save.json
    // （手动存档模型：游戏过程只写内存 KV，不配置 autoFlush；
    //   唯一写盘入口是存档菜单"保存存档" → saveGame() → flush(force)）
    this.save = new SaveSlotComponent(this, {
      filePath: FISH_SAVE_FILE,
    })
    this.addComponent(this.save)
    // 运行时变化 → KV（只写内存）。用常驻监听器而非 onChange 单槽——后者被
    // BaseHudScript 等 UI 脚本按需覆盖。load 回填也会触发广播，重写同值无害。
    this.resources.addChangeListener(() => syncRuntimeKeys(this))
    this.training.addChangeListener(() => syncRuntimeKeys(this))
    // 游戏内事件总线（生命周期跟随 GameInstance）
    this.events = new GameEvents()
    // GameMode 实例由 start() / SwitchToScene 按需创建
  }

  override get controller(): PlayerController | null {
    return this._controller
  }

  // ════════════════════════════════════════════
  //  Phase 路由：根据 initialMode 决定启动哪个阶段
  // ════════════════════════════════════════════

  override start(): boolean {
    logger.info(`[Fish] 游戏实例启动, initialMode=${this.initialMode ?? '(未设置, 默认 menu)'}`)
    // Toast 通知系统挂接：widget 资产 + UIManager（动态生成的面板自动获得浮动层偏移）
    ToastSystem.instance.attach(this.world.ui, 'asset/blueprints/ui/toast.widget.json')
    // 色盲模式服务挂接（默认 off；由设置 UI 调用 setMode 切换）
    ColorblindService.instance.attach(this.world.ui)
    // AI 调试直跳入口：Playwright 验证直接进入关卡战斗 / 注入军队
    this.installBattleDebugBridge()
    // 异步加载存档 → 版本校验 → 回填运行时 → 尝试补做布局恢复
    // （不阻塞下面的同步 switchToPhase；保持 start 的同步返回契约）
    this.loadSaveAsync()
    if (this.initialMode === 'base') return this.switchToPhase('base')
    if (this.initialMode === 'game') return this.switchToPhase('game')
    return this.switchToPhase('menu')
  }

  // ════════════════════════════════════════════
  //  持久化：存档加载 / 布局恢复门控 / 边界落盘
  // ════════════════════════════════════════════

  /** 异步加载存档并回填运行时（fire-and-forget；就绪后触发待定的布局恢复） */
  private loadSaveAsync(): void {
    void this.save.load().then(() => {
      applyRuntime(this)
      this._kvReady = true
      logger.info(`[Fish] 存档已就绪（coins=${this.resources.get('coins')}, army=${this.training.getArmySummary()}）`)
      this.tryRestoreBaseLayout()
    })
  }

  /**
   * 手动保存（存档菜单"保存存档"）：全量采集运行时 → 强制整表落盘。
   * 这是本游戏唯一的常规写盘入口——平时只写内存 KV，不点保存不落盘。
   */
  async saveGame(): Promise<boolean> {
    // 基地场景存活时以 GameMode 当前布局为准采集（比事件增量同步更权威）
    if (this._phase === 'base' && this._baseGameMode) {
      this.save.set('baseBuildings', this._baseGameMode.getLayoutSnapshot())
    }
    syncRuntimeKeys(this)
    writeMetaKeys(this)
    const ok = await this.save.flush(true) // force：首次游玩也能创建存档文件
    logger.info(`[Fish] 手动保存${ok ? '成功' : '失败'} → ${FISH_SAVE_FILE}`)
    return ok
  }

  /**
   * 手动读取（存档菜单"读取存档"）：load → 版本校验/回填运行时；
   * 若正处于基地场景则重新武装布局恢复门控（两帧清场+重放）。
   * @returns 是否实际读到了存档
   */
  async loadGame(): Promise<boolean> {
    const loaded = await this.save.load()
    if (!loaded) return false
    applyRuntime(this)
    this._kvReady = true
    if (this._phase === 'base') {
      this._baseRestored = false
      this.tryRestoreBaseLayout()
    }
    return true
  }

  /**
   * 布局恢复门控（双就绪 + 幂等）：KV 加载完成 与 base 场景布局构建完成，
   * 谁后到谁在这里补齐。无 baseBuildings 键（首次运行/重置后）→ 保留默认布局。
   */
  private tryRestoreBaseLayout(): void {
    if (!this._kvReady || !this._baseLayoutBuilt || this._baseRestored || this._pendingRestore) return
    if (!this.save.has('baseBuildings')) {
      this._baseRestored = true
      logger.info('[Fish] 无基地布局存档：保留初始布局')
      return
    }
    // 两帧消费：首帧清场、次帧重放（见 tick base 分支；幽灵碰撞体需隔帧移除）
    this._pendingRestore = true
  }

  /** 阶段边界内存同步（手动存档模型：只写 KV 标脏，落盘交给存档菜单的"保存存档"） */
  private syncToKV(reason: string): void {
    logger.info(`[Fish] 运行时同步 → KV（${reason}），待手动保存落盘`)
  }

  /** GM 入口：清除存档并把运行时重置为全新开局 */
  resetSave(): void {
    const wasInBase = this._phase === 'base'
    resetRuntimeAndKeys(this)
    // 正处于基地阶段：立即清掉场上建筑（重建的默认布局随下次进基地刷新）
    if (wasInBase) this._baseGameMode?.clearClashLayout()
    logger.info('[Fish] 存档已重置为全新开局')
  }

  /**
   * 安装战斗调试桥（window.__fishBattle）：
   *  - enterLevel(id)：直跳某关卡战斗场景（等价地图面板点关卡）
   *  - addArmy(troopId, count)：向训练军队直接注入兵种（绕过训练队列，测试用）
   *  - deploy(troopId, x, z)：在战斗场景世界坐标放兵（绕过屏幕点击，测试用）
   *  - startTickDriver() / stopTickDriver()：浏览器测试页 rAF 被节流时，
   *    用 setInterval 批量补偿驱动游戏 tick（Electron 正常环境不需要）
   *  - getBattle()：战斗状态快照（建筑血量/掠夺/胜负，Playwright 断言）
   *  - getState()：当前阶段/关卡/资源/军队快照（Playwright 断言）
   */
  private installBattleDebugBridge(): void {
    ;(window as unknown as Record<string, unknown>).__fishBattle = {
      enterLevel: (id: string) => this.enterLevel(id),
      /** 选兵种进入放置模式（等价点击 HUD 兵种卡片，Playwright 复现真实点击链路用） */
      selectTroop: (troopId: string) => {
        this._levelGameMode?.selectTroop(troopId)
        return this._levelGameMode?.placeTroopId ?? null
      },
      /** 当前放置模式兵种 id（null = 未选兵，点场景不会放兵） */
      getPlaceTroopId: () => this._levelGameMode?.placeTroopId ?? null,
      /** 运行时探针（诊断用）：暴露 controller / gameMode / 阶段等内部状态 */
      probe: () => ({
        phase: this._phase,
        levelId: this._levelId,
        hasController: !!this._controller,
        controllerName: this._controller?.name ?? null,
        levelGameMode: this._levelGameMode ? this._levelGameMode.constructor.name : null,
        worldGameMode: this.world.gameMode ? this.world.gameMode.constructor.name : null,
        worldGameModeController: this.world.gameMode?.controller?.name ?? null,
        placeTroopId: this._levelGameMode?.placeTroopId ?? null,
        battleEnded: this._levelGameMode?.battleEnded ?? null,
        phySysReady: PhySys.ready,
        viewportRect: (() => {
          const el = PhySys.viewportElement
          if (!el) return null
          const r = el.getBoundingClientRect()
          return { w: r.width, h: r.height, x: r.x, y: r.y }
        })(),
      }),
      /** 模拟真实点击（走 InputSys.handlePointerDown → Controller → GameMode 全链路，绕过 DOM 事件） */
      debugClick: (screenX: number, screenY: number, button = 0) => {
        const consumed = this.inputSys.handlePointerDown(screenX, screenY, undefined, this.controller, button)
        this.inputSys.handlePointerUp(undefined, this.controller, button)
        return { consumed, placeTroopId: this._levelGameMode?.placeTroopId ?? null }
      },
      addArmy: (troopId: string, count: number) => {
        const troop = this.getTroop(troopId)
        if (!troop) return false
        this.training.registerTroop(troopId, troop)
        return this.training.debugAddArmy(troopId, count)
      },
      deploy: (troopId: string, x: number, z: number) => this._levelGameMode?.debugDeploy(troopId, x, z) ?? false,
      /** GM 放兵（跳过军队扣除，直接部署兵 Actor，Playwright 测试用） */
      gmSpawnTroop: (troopId: string, x: number, z: number) => this._levelGameMode?.gmSpawnTroop(troopId, x, z) ?? false,
      /** 当前场上部队列表（Playwright 断言用） */
      getTroops: () => {
        const list = this._levelGameMode?.troops ?? []
        return list.map((t) => ({
          name: t.troop.name,
          x: Math.round(t.root.position.x * 10) / 10,
          z: Math.round(t.root.position.z * 10) / 10,
        }))
      },
      /** 执行 GM 命令（Playwright 测试用）：如 unlockBattle 注入军队、addCoins 加金币 */
      executeGM: (line: string) => {
        const result = this.gm.execute(line)
        return { ok: result.ok, message: result.message }
      },
      startTickDriver: () => this.startDebugTickDriver(),
      stopTickDriver: () => this.stopDebugTickDriver(),
      /** 同步推进 n × (1/30)s 游戏时间（Playwright 断言用，不受浏览器节流影响） */
      stepTicks: (n: number) => {
        const count = Math.max(1, Math.min(Math.floor(n), 3000))
        for (let i = 0; i < count; i++) {
          if (this._phase === 'game') this.tick(1 / 30)
        }
        return count
      },
      getBattle: () => this._levelGameMode?.getBattleSnapshot() ?? null,
      getHealthBars: () => this._levelGameMode?.getHealthBarStates() ?? [],
      getTroopModels: () => this._levelGameMode?.getTroopModelSummary() ?? [],
      getTroopHealthBars: () => this._levelGameMode?.getTroopHealthBarStates() ?? [],
      getGM: () => ({
        consoleOpen: this.gm.consoleOpen,
        outputLines: this.gm.getConsoleOutputLines(),
        layers: this.gm.getConsoleLayers(),
        inputValue: (this.gm as unknown as { _console?: { _input?: { value?: string } } | null })
          ._console?._input?.value ?? '',
      }),
      /** 手动射线命中测试（Playwright 诊断 UI 点击链路）：返回 UI 层命中结果 */
      debugHit: (sx: number, sy: number) => {
        const sys = PhySys as unknown as {
          screenToRay?: (x: number, y: number, cam?: unknown) => {
            ray?: { origin?: { x: number; y: number; z: number }; direction?: { x: number; y: number; z: number } }
            intersectObjects?: (objs: unknown[], rec: boolean) => unknown[]
          } | null
          _uiCamera?: { position?: { x: number; y: number; z: number } } | null
          _uiClickables?: Set<{
            bEnabled: boolean
            hitTest: (r: unknown) => unknown
            owner: {
              root: {
                name: string
                updateMatrixWorld?: (b: boolean) => void
                traverse?: (cb: (o: unknown) => void) => void
              }
            }
          }>
        }
        const ray = sys.screenToRay?.(sx, sy, sys._uiCamera)
        if (!ray) return { ray: false }
        const origin = ray.ray?.origin
        const dir = ray.ray?.direction
        let hitCount = 0
        const targets: string[] = []
        for (const c of sys._uiClickables ?? []) {
          if (!c.bEnabled) continue
          c.owner.root.updateMatrixWorld?.(true)
          const hit = c.hitTest(ray)
          if (hit) hitCount++
          // 收集 owner 的 mesh 世界位置
          let meshPos = 'none'
          c.owner.root.traverse?.((o) => {
            const obj = o as { isMesh?: boolean; matrixWorld?: { elements?: number[] } }
            if (obj.isMesh) {
              meshPos = `(${obj.matrixWorld?.elements?.[12]?.toFixed(2) ?? '?'},${obj.matrixWorld?.elements?.[13]?.toFixed(2) ?? '?'},${obj.matrixWorld?.elements?.[14]?.toFixed(2) ?? '?'})`
            }
          })
          targets.push(`${c.owner.root.name}:${meshPos}`)
        }
        return {
          ray: true,
          origin: origin ? `(${origin.x.toFixed(2)},${origin.y.toFixed(2)},${origin.z.toFixed(2)})` : '?',
          dir: dir ? `(${dir.x.toFixed(2)},${dir.y.toFixed(2)},${dir.z.toFixed(2)})` : '?',
          hitCount,
          total: sys._uiClickables?.size ?? 0,
          targets: targets.slice(0, 12),
        }
      },
      /** GM 命令滚动列表运行时详情（Playwright 定位 item 渲染缺失用） */
      getGMDetail: () => {
        const gmAny = this.gm as unknown as { _console?: { _cmdList?: unknown } | null }
        const consoleHud = gmAny._console
        if (!consoleHud) return { open: false }
        const list = consoleHud._cmdList as {
          _initialized?: boolean; _totalCount?: number; _scrollOffset?: number
          _visibleCount?: number; _itemSize?: [number, number]; _spacing?: number
          visibleCount?: number; _pool?: import('@/engine').Actor[]
        } | null
        if (!list) return { open: true, list: null }
        const summarizeActor = (a: import('@/engine').Actor): Record<string, unknown> => {
          const comps: Record<string, unknown>[] = []
          const allComps = (a as unknown as { components?: unknown[] }).components ?? []
          for (const c of allComps) {
            const anyC = c as Record<string, unknown>
            const n = (c as { constructor?: { name?: string } }).constructor?.name ?? '?'
            const row: Record<string, unknown> = { type: n }
            if (n === 'UITransformComponent') {
              row.anchorOffset = anyC.anchorOffset
              row.worldSize = [anyC.worldWidth, anyC.worldHeight]
            } else if (n === 'CanvasUIComponent' || n === 'UITextComponent' || n === 'UIImageComponent') {
              row.zOrder = anyC.zOrder
              row.renderOrder = anyC.renderOrder
              if (n === 'UITextComponent') {
                row.text = (anyC.text as string) ?? ''
                row.meshVisible = (anyC.mesh as { visible?: boolean } | null)?.visible ?? null
              }
              if (n === 'UIImageComponent') {
                row.panelVisible = (anyC.panel as { visible?: boolean } | null)?.visible ?? null
              }
            } else if (n === 'UIButtonComponent') {
              row.hasOnClick = typeof anyC.onClick === 'function'
            }
            comps.push(row)
          }
          return {
            name: a.root.name, uid: a.uid, active: a.bActive, worldSet: !!a.world,
            rootVisible: a.root.visible,
            pos: [a.root.position.x, a.root.position.y, a.root.position.z],
            parent: a.root.parent ? `${a.root.parent.name} (visible=${a.root.parent.visible})` : null,
            comps,
          }
        }
        return {
          open: true,
          initialized: list._initialized ?? false,
          totalCount: list._totalCount ?? 0,
          scrollOffset: list._scrollOffset ?? 0,
          visibleCount: list.visibleCount,
          itemSize: list._itemSize ?? null,
          spacing: list._spacing ?? 0,
          scrollbar: (() => {
            // 滚动条快照（轨道 + thumb，Playwright 断言渲染/拖动用）
            const l = list as unknown as {
              _scrollbarThumb?: import('@/engine').Actor | null
              _scrollbarTrack?: import('@/engine').Actor | null
              _scrollbar?: boolean
            }
            const readActor = (a: import('@/engine').Actor | null | undefined) => {
              if (!a) return null
              const comps = (a as unknown as { components?: unknown[] }).components ?? []
              let size: [number, number] | null = null
              let zOrder: number | null = null
              for (const c of comps) {
                const anyC = c as Record<string, unknown>
                const n = (c as { constructor?: { name?: string } }).constructor?.name ?? '?'
                if (n === 'UITransformComponent') {
                  size = [anyC._worldW as number, anyC._worldH as number]
                } else if (n === 'CanvasUIComponent' || n === 'UIImageComponent') {
                  zOrder = anyC.zOrder as number
                }
              }
              return {
                name: a.root.name,
                active: a.bActive,
                pos: [a.root.position.x, a.root.position.y, a.root.position.z],
                size,
                zOrder,
                parent: a.parent ? a.parent.root.name : null,
              }
            }
            return {
              enabled: !!l._scrollbar,
              track: readActor(l._scrollbarTrack),
              thumb: readActor(l._scrollbarThumb),
            }
          })(),
          bounce: (() => {
            // 回弹诊断：是否正在回弹 + TweenSystem 活动补间数（判断驱动是否推进）
            const l = list as unknown as { _bounceTween?: unknown }
            const ts = TweenSystem as unknown as { instance?: { activeCount?: number } }
            return {
              bouncing: !!l._bounceTween,
              tweenCount: ts.instance?.activeCount ?? -1,
            }
          })(),
          chain: (() => {
            const chain: Record<string, unknown>[] = []
            let n: unknown = (list as { owner?: import('@/engine').Actor }).owner
            while (n) {
              const a = n as import('@/engine').Actor
              chain.push({
                name: a.root.name,
                pos: [a.root.position.x, a.root.position.y, a.root.position.z],
                visible: a.root.visible,
              })
              n = a.parent
            }
            return chain
          })(),
          pool: (list._pool ?? []).map(summarizeActor),
          input: (() => {
            // 拖拽/点击链路诊断：PhySys UI 点击注册数与 UI 相机状态
            const sys = PhySys as unknown as {
              _uiCamera?: unknown
              clickableCount?: number
              _uiClickables?: Set<unknown>
              viewportElement?: HTMLElement | null
              ready?: boolean
            }
            const uiClickables = sys._uiClickables?.size ?? -1
            // 池内 item 中已挂 ClickableComponent 的数量（拖拽绑定前提）
            const itemClickables = (list._pool ?? []).filter((p) =>
              (p as unknown as { components?: unknown[] }).components?.some(
                (c) => (c as { constructor?: { name?: string } }).constructor?.name === 'ClickableComponent',
              ),
            ).length
            return {
              uiCamera: !!sys._uiCamera,
              uiClickableCount: uiClickables,
              itemClickableCount: itemClickables,
              viewport: sys.viewportElement ? `${sys.viewportElement.tagName}.${sys.viewportElement.className}` : null,
              ready: sys.ready,
            }
          })(),
        }
      },
      getState: () => ({
        phase: this._phase,
        levelId: this._levelId,
        coins: this.resources.get('coins'),
        elixir: this.resources.get('elixir'),
        army: this.training.getArmySummary(),
      }),
    }
  logger.info('[Fish] 战斗调试桥已安装: window.__fishBattle { enterLevel, addArmy, deploy, gmSpawnTroop, selectTroop, getPlaceTroopId, debugClick, probe, getTroops, executeGM, startTickDriver, stopTickDriver, getBattle, getState }')
  }

  /** 调试 tick 驱动器定时器 id（null = 未启动） */
  private _debugTickTimer: number | null = null

  /**
   * 启动调试 tick 驱动器（Playwright 浏览器验证专用）：
   * hidden 页面 rAF 被浏览器节流（深度节流时 setInterval 可降至 ~1 次/分钟），
   * 本驱动器按真实时间差批量补偿 tick（每批最多 30s 游戏时间，30fps 步长），
   * 保证战斗在测试页实时推进。Electron 正常环境由 GameViewport rAF 驱动，无需调用。
   */
  private startDebugTickDriver(): void {
    this.stopDebugTickDriver()
    let last = performance.now()
    this._debugTickTimer = window.setInterval(() => {
      const now = performance.now()
      const elapsed = Math.min((now - last) / 1000, 30)
      last = now
      const steps = Math.round(elapsed / (1 / 30))
      for (let i = 0; i < steps; i++) {
        if (this._phase === 'game') this.tick(1 / 30)
      }
    }, 250)
    logger.info('[Fish] 调试 tick 驱动器已启动（hidden 页面 rAF 节流补偿）')
  }

  /** 停止调试 tick 驱动器 */
  private stopDebugTickDriver(): void {
    if (this._debugTickTimer === null) return
    clearInterval(this._debugTickTimer)
    this._debugTickTimer = null
    logger.info('[Fish] 调试 tick 驱动器已停止')
  }

  /**
   * 通用阶段切换：通过 World.SwitchToScene(name) 自动从 AssetRegistry 查找场景资产。
   * SwitchToScene 内部：Pause → DestroyAllActors → SetGameMode → loadSceneAsActors → extraSetup → BeginPlay
   * game 阶段场景名由 _levelId 决定：有关卡 → 关卡场景（mode="level" → FishLevelGameMode），
   * 否则 → 海域（mode="game" → FishGameMode）。
   */
  private switchToPhase(phase: Phase): boolean {
    this._phase = phase
    const sceneName = phase === 'menu' ? 'FishMenu'
      : phase === 'base' ? 'FishBaseIsland'
      : this._levelId ? (this.getLevel(this._levelId)?.scene ?? 'ClashMaster') : 'ClashMaster'
    logger.info(`[Fish] 切换阶段 → ${phase} (场景: ${sceneName})`)

    const ok = this.world.SwitchToScene(sceneName, () => {
      switch (phase) {
        case 'menu': this.setupMenuPhase(); break
        case 'base': this.setupBasePhase(); break
        case 'game': this._levelId ? this.setupLevelPhase() : this.setupGamePhase(); break
      }
    })
    if (!ok) logger.error(`[Fish] 切换阶段失败 → ${phase}`)
    return ok
  }

  /** 菜单阶段设置（在 SwitchToScene extraSetup 中执行，世界处于暂停态） */
  private setupMenuPhase(): void {
    logger.info('[Fish] setupMenuPhase: 配置主菜单...')
    const mode = this.world.gameMode as FishMainMenuGameMode
    this._menuGameMode = mode
    mode.onStartGame = () => this.enterBase()
    this.setupCamera(mode.gameCamera, 0, 0, 20)
    mode.cameraManager.RegisterCamera(mode.gameCamera)
    if (mode.controller) {
      this._controller = mode.controller
      logger.info(`[Fish] setupMenuPhase: controller 已就绪 → ${mode.controller.name}`)
    }
    else logger.error('[Fish] setupMenuPhase: controller 为空（StartPlay 未生成）')

    // UI 点击：初始化 PhySys 射线检测（相机 + 屏幕坐标换算容器，用 Game 视口 UI 层 DOM）
    if (this.world.gameRenderer?.uiLayer) PhySys.setup(mode.gameCamera.camera, this.world.gameRenderer.uiLayer)

    // 把 HUD 中所有 UIButtonComponent 的点击接到"开始游戏"
    const uiTree = this.world.ui.hud?.uiActor
    if (uiTree) {
      const bindButtons = (actor: import('@/engine').Actor) => {
        for (const comp of actor.getComponents(UIButtonComponent)) {
          if (comp.onClick) continue
          comp.onClick = () => mode.onStartGame?.()
          logger.info(`[Fish] 菜单按钮绑定 onClick: ${actor.name}`)
        }
        for (const child of actor.getChildren()) bindButtons(child)
      }
      bindButtons(uiTree)
    }
    logger.info('[Fish] setupMenuPhase: 完成（等待玩家点击开始）')
  }

  /** 基地阶段设置 */
  private setupBasePhase(): void {
    logger.info('[Fish] setupBasePhase: 配置部落冲突基地...')
    const mode = this.world.gameMode as FishBaseGameMode
    this._baseGameMode = mode
    // 持久化接线：本帧开始重建场景，恢复/构建期间一律静音同步（防默认布局覆盖存档键）；
    // onLayoutBuilt 在 BeginPlay 末尾触发（建筑尚在 pendingSpawn，等首个 base tick 提交）
    this._baseLayoutBuilt = false
    this._baseRestored = false
    this._pendingRestore = false
    this._restoreCleared = false
    mode.onLayoutBuilt = () => {
      this._baseLayoutBuilt = true
      this.tryRestoreBaseLayout()
    }
    mode.onLayoutChange = () => {
      if (this._baseRestored && mode === this._baseGameMode) {
        this.save.set('baseBuildings', mode.getLayoutSnapshot())
      }
    }
    mode.onStartFishing = () => this.startGameplay()
    mode.onClaimCoins = () => this.claimCoins()
    // 部落冲突基地：游戏自己的摄像机 actor（BaseCameraActor，每 new 一次都是新摄像机）
    // 交给 World 托管（spawnActor）：由 World 自动驱动 Tick（边缘平移检测）/BeginPlay/销毁生命周期
    spawnActor(mode.baseCamera)
    this.setupCamera(mode.baseCamera.cameraComponent, 12, 16, 18)
    mode.cameraManager.RegisterCamera(mode.baseCamera.cameraComponent)
    if (this.world.gameRenderer?.uiLayer) PhySys.setup(mode.baseCamera.camera, this.world.gameRenderer.uiLayer)
    if (mode.controller) {
      this._controller = mode.controller
      logger.info(`[Fish] setupBasePhase: controller 已切换 → ${mode.controller.name}（pawn=${mode.controller.pawn?.root.name}）`)
    }
    else logger.error('[Fish] setupBasePhase: controller 为空（StartPlay 未生成）')

    // 基地 HUD 的建筑菜单按钮绑定由 widget 资产上挂载的 BaseHudScript
    // （UIScriptComponent, script="gameplay/base/BaseHud"）在 BeginPlay 时接管，
    // 这里不再手写遍历 UI 树绑定——UI 结构（资产）与行为（脚本）解耦。
    logger.info('[Fish] setupBasePhase: 完成（已进入基地，HUD 按钮由 BaseHudScript 绑定）')
  }

  /** 游戏阶段设置 */
  private setupGamePhase(): void {
    logger.info('[Fish] setupGamePhase: 配置出征战斗...')
    const mode = this.world.gameMode as FishGameMode
    this._gameMode = mode
    mode.cameraManager.RegisterCamera(mode.gameCamera)
    this.setupCamera(mode.gameCamera, 0, 0, 20)

    const controller = mode.controller
    if (!controller) { logger.error('[Fish] setupGamePhase: controller 为空（StartPlay 未生成）'); return }
    this._controller = controller as FishPlayerController
    const pawn = controller.pawn
    if (!pawn) { logger.error('[Fish] setupGamePhase: controller 无 pawn'); return }
    this.pawn = pawn as FishCannon

    this.unsubGameState = mode.gameState.subscribe(() => {
      const gs = mode.gameState
      this._score = gs.score
      this._lastCannonLevel = this.pawn?.level ?? 1
      this.callbacks.onScoreChange?.(gs.score)
      this.callbacks.onPhaseChange?.(gs.phase)
      if (gs.phase === 'gameover' && !this._returningToBase) {
        this.callbacks.onGameOver?.()
        this.returnToBase()
      }
    })

    this.callbacks.onPhaseChange?.('playing')
    logger.info('[Fish] 游戏已启动')
  }

  /**
   * 关卡阶段设置（战斗：攻打敌方基地）。
   * 相机复用基地同款 BaseCameraActor（透视俯瞰 + 滚轮缩放 + 右键平移），
   * 交给 World 托管（SpawnActor），放兵交互由 FishLevelGameMode + HUD 脚本接管。
   */
  private setupLevelPhase(): void {
    logger.info(`[Fish] setupLevelPhase: 配置关卡战斗 "${this._levelId}"...`)
    const mode = this.world.gameMode as FishLevelGameMode
    this._levelGameMode = mode
    // 战斗摄像机 actor（与基地一致：每个关卡 new 一个新摄像机）
    spawnActor(mode.baseCamera)
    this.setupCamera(mode.baseCamera.cameraComponent, 12, 16, 18)
    mode.cameraManager.RegisterCamera(mode.baseCamera.cameraComponent)
    // UI 点击：初始化 PhySys 射线检测（战斗相机 + 屏幕坐标换算容器）
    if (this.world.gameRenderer?.uiLayer) PhySys.setup(mode.baseCamera.camera, this.world.gameRenderer.uiLayer)

    if (mode.controller) {
      this._controller = mode.controller
      logger.info(`[Fish] setupLevelPhase: controller 已就绪 → ${mode.controller.name}`)
    } else {
      logger.error('[Fish] setupLevelPhase: controller 为空（StartPlay 未生成）')
    }

    // 关卡战斗结算监听：胜利且带关卡 id → 记录通关（只写 KV 键；回城边界统一落盘）
    if (this.unsubGameState) { this.unsubGameState(); this.unsubGameState = null }
    this.unsubGameState = mode.gameState.subscribe(() => {
      if (mode.gameState.phase !== 'gameover' || !this._levelId) return
      if (mode.getBattleResult().win) addClearedLevel(this.save, this._levelId)
    })

    logger.info('[Fish] setupLevelPhase: 完成（战斗 HUD 由 BattleHudScript 接管）')
  }

  /** 领取初始金币 */
  private claimCoins() {
    this.resources.set('coins', INITIAL_COINS)
    logger.info(`[Fish] 领取初始金币，当前金币: ${this.resources.get('coins')}`)
  }

  // ════════════════════════════════════════════
  //  阶段路由
  // ════════════════════════════════════════════

  /** 切换到菜单阶段 */
  private startMenuMode(): boolean {
    logger.info('[Fish] 显示主菜单...')
    return this.switchToPhase('menu')
  }

  /** 进入基地（从菜单） */
  private enterBase() {
    logger.info('[Fish] 进入基地...')
    this.switchToPhase('base')
    // 尽快把领到的初始金币/恢复的运行时落一次盘
    this.syncToKV('enterBase')
  }

  /** 出征战斗 */
  private startGameplay(): boolean {
    logger.info('[Fish] 出征战斗...')
    this._phase = 'game'
    this._levelId = null
    if (this._controller) { this._controller.Unpossess(); this._controller = null }
    this._baseGameMode?.cameraManager.Clear()
    const ok = this.switchToPhase('game')
    if (ok) this.syncToKV('出征')
    return ok
  }

  /** 从游戏/关卡返回基地（Game Over / 暂停菜单"返回基地" / 手动返回） */
  returnToBase() {
    logger.info('[Fish] 返回基地...')
    this._phase = 'base'
    this._levelId = null
    // 停掉调试 tick 驱动器（战斗结束，无需继续补偿驱动）
    this.stopDebugTickDriver()

    if (this.unsubGameState) { this.unsubGameState(); this.unsubGameState = null }
    if (this._gameMode) { this._gameMode.cameraManager.Clear(); this._gameMode = null }
    if (this._levelGameMode) { this._levelGameMode.cameraManager.Clear(); this._levelGameMode = null }
    if (this._controller) { this._controller.Unpossess(); this._controller = null }
    this.pawn = null
    this._returningToBase = false

    this.switchToPhase('base')
    // 掠夺入账/通关记录已在战斗结算时写入 KV，这里统一落盘
    this.syncToKV('回城')
    logger.info(`[Fish] 返回基地，当前金币: ${this.resources.get('coins')}`)
  }

  // ════════════════════════════════════════════
  //  关卡（地图面板入口）
  // ════════════════════════════════════════════

  /** 关卡数据表（DataTable，键=关卡 id，值=关卡属性） */
  getLevelTable(): DataTable<LevelType> | undefined {
    return ConfigRegistry.getTable<LevelType>('fish.levels')
  }

  /** 按 id 查关卡 */
  getLevel(id: string): LevelType | undefined {
    return this.getLevelTable()?.getRow(id)
  }

  /**
   * 进入关卡（地图面板关卡节点点击）：
   * 复用 game 阶段 → 加载关卡场景（场景资产 mode="level" → FishLevelGameMode）。
   * 关卡内按 Esc 打开暂停菜单，可"返回基地"。
   */
  enterLevel(id: string): boolean {
    const level = this.getLevel(id)
    if (!level) {
      logger.warn(`[Fish] 进入关卡失败：关卡 "${id}" 不存在（关卡表未加载或行缺失）`)
      return false
    }
    logger.info(`[Fish] 进入关卡: ${level.name}（场景 ${level.scene}）`)
    this._levelId = id
    this._phase = 'game'
    if (this._controller) { this._controller.Unpossess(); this._controller = null }
    this._baseGameMode?.cameraManager.Clear()
    const ok = this.switchToPhase('game')
    if (ok) this.syncToKV(`进关-${id}`)
    return ok
  }

  // ════════════════════════════════════════════
  //  训练部队（组件入口）
  // ════════════════════════════════════════════

  /** 兵种数据表（DataTable，键=兵种 id，值=兵种属性） */
  getTroopTable(): DataTable<TroopType> | undefined {
    return ConfigRegistry.getTable<TroopType>('fish.troop')
  }

  /** 按 id 查兵种 */
  getTroop(id: string): TroopType | undefined {
    return this.getTroopTable()?.getRow(id)
  }

  /**
   * 训练兵种（部落冲突风格：金币扣费 → 训练倒计时 → 完成后入列军队）。
   * 入口统一在此：资源组件扣费 + 训练组件入队；失败原因经日志输出。
   */
  trainTroop(id: string): boolean {
    const troop = this.getTroop(id)
    if (!troop) {
      logger.warn(`[Fish] 训练失败：兵种 "${id}" 不存在（兵种表未加载或行缺失）`)
      return false
    }
    // 金币校验 + 扣费（资源组件）
    if (!this.resources.spend('coins', troop.cost)) {
      logger.warn(`[Fish] 训练失败：金币不足（需要 ${troop.cost}，当前 ${this.resources.get('coins')}）`)
      return false
    }
    // 入训练队列（容量校验在组件内）
    this.training.registerTroop(id, troop)
    if (!this.training.enqueue(id, troop)) {
      // 入队失败（容量不足）→ 退还金币
      this.resources.add('coins', troop.cost)
      return false
    }
    logger.info(`[Fish] 开始训练: ${troop.name}（-${troop.cost} 金币，剩余 ${this.resources.get('coins')}；队列 ${this.training.getQueue().length} 项）`)
    return true
  }

  // ════════════════════════════════════════════
  //  Tick / 渲染
  // ════════════════════════════════════════════

  override tick(dt: number) {
    // 存档周期 flush 计时（含 menu 阶段；策略内含周期项且 dirty 才真正写盘）
    this.save.tick(dt)
    if (this._phase === 'menu') return

    if (this._phase === 'base') {
      // 基地阶段：推进训练队列倒计时（训练组件挂在本实例，手动驱动）
      this.training.update(dt)
      this.world.manualTick(dt)
      // 布局恢复两帧消费（必须在 manualTick 之后：commitSpawn/commitDestroy 已提交）
      if (this._pendingRestore && this._baseGameMode) {
        const mode = this._baseGameMode
        if (!this._restoreCleared) {
          // 帧 A：清场。旧建筑标记销毁，但 Actor/碰撞体要等下一帧 commitDestroy 移除
          mode.clearClashLayout()
          this._restoreCleared = true
        } else {
          // 帧 B：幽灵碰撞体已移除，重放存档布局（走 placeBuilding 继承全部校验）
          const list = sanitizeBuildings(this.save.get('baseBuildings'))
          const placed = mode.rebuildLayoutFrom(list)
          this._pendingRestore = false
          this._restoreCleared = false
          this._baseRestored = true
          this.save.set('baseBuildings', mode.getLayoutSnapshot())
          logger.info(`[Fish] 基地布局已从存档恢复：${placed}/${list.length} 栋`)
        }
      }
      return
    }

    if (this._phase === 'game') {
      this.world.manualTick(dt)
      // 出征/关卡共用 game 阶段驱动（关卡空壳无玩法，仍驱动 world tick）
      const gm = this._gameMode ?? this._levelGameMode
      if (gm) {
        const gs = gm.gameState
        this.callbacks.onScoreChange?.(gs.score)
        this.callbacks.onPhaseChange?.(gs.phase)
      }
    }
  }

  override drawGizmos() {
    this.world.drawGizmos()
  }

  override syncCamera(targetCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera, aspect: number) {
    switch (this._phase) {
      case 'menu':
        this._menuGameMode?.cameraManager.ApplyToRenderer(targetCamera, aspect)
        break
      case 'base':
        this._baseGameMode?.cameraManager.ApplyToRenderer(targetCamera, aspect)
        break
      case 'game':
        (this._gameMode ?? this._levelGameMode)?.cameraManager.ApplyToRenderer(targetCamera, aspect)
        break
    }
  }

  /** 渲染器委托：返回当前阶段的主摄像机（游戏自己创建的摄像机 actor） */
  override getActiveCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera | null {
    switch (this._phase) {
      case 'menu': return this._menuGameMode?.cameraManager.GetActiveCameraObject() ?? null
      case 'base': return this._baseGameMode?.cameraManager.GetActiveCameraObject() ?? null
      case 'game': return (this._gameMode ?? this._levelGameMode)?.cameraManager.GetActiveCameraObject() ?? null
      default: return null
    }
  }

  // onPointerDown / onPointerMove 已由各阶段的 PlayerController 处理
  // （FishBasePlayerController / FishMainMenuPlayerController / FishPlayerController）

  /** 设置相机位置和朝向，并同步到 Actor root（避免 SyncFromActor 覆盖） */
  private setupCamera(cameraComp: CameraComponent, x: number, y: number, z: number) {
    const cam = cameraComp.camera
    cam.position.set(x, y, z)
    cam.lookAt(0, 0, 0)
    if ('updateProjectionMatrix' in cam) cam.updateProjectionMatrix()
    // 将相机 transform 写回 Actor root，否则每帧 SyncFromActor 会覆盖
    cameraComp.SyncToActor()
  }

  override stop() {
    if (this._stopped) return
    this._stopped = true
    // 自动落盘转发（autoFlush 含 onStop 时兜底刷一次；周期 flush 已覆盖直接关窗路径）
    this.save.onStop()
    logger.info('[Fish] 停止游戏...')
    this.events.clear()
    this.world.gameMode?.EndPlay()
    this.world.gameMode = null
    this.world.DestroyAllActors()
    this.world.scene.background = new THREE.Color(0x1a1a2e)
    this.world.Pause()
    this._menuGameMode?.cameraManager.Clear()
    this._baseGameMode?.cameraManager.Clear()
    this._gameMode?.cameraManager.Clear()
    this._controller = null
    this.pawn = null
    this._menuGameMode = null
    this._baseGameMode = null
    this._gameMode = null
    this._phase = 'menu'
    // 布局恢复门控复位（KV 内容保留；下次进基地重新走"构建 → 门控 → 恢复"）
    this._baseLayoutBuilt = false
    this._baseRestored = false
    this._pendingRestore = false
    this._restoreCleared = false
  }

  override destroy() {
    this.stop()
    // 自动落盘转发（onDestroy 策略；App 直接关窗来不及走这里，靠 ≤10s 周期 flush 兜底）
    this.save.onDestroy()
    if (this.unsubGameState) {
      this.unsubGameState()
      this.unsubGameState = null
    }
    this.world.Destroy()
  }
}
