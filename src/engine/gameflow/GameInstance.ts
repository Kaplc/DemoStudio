/**
 * GameInstance — 游戏实例抽象基类
 * 定义所有游戏实例的标准接口
 * 子类需实现：start/tick/syncCamera/stop/destroy 以及 controller 属性
 */
import * as THREE from 'three'
import { PlayerController } from '../input/PlayerController'
import { InputSys } from '../input/InputSys'
import { AObject } from '../entity/AObject'
import { GMModule } from '../gm/GMModule'
import { GameViewportComponent } from './GameViewportComponent'
import { EditorGameBridgeComponent } from './EditorGameBridgeComponent'
import { World } from './World'
import type { GameMode } from './GameMode'
import { logger } from '../Logger'

export interface GameInstanceCallbacks {
  onScoreChange?: (score: number) => void
  onPhaseChange?: (phase: string) => void
  onGameOver?: () => void
}

export abstract class GameInstance extends AObject {
  // ─── 单例：当前活跃的游戏实例（由 Game.createInstance 设置、shutdown 清除）───
  private static _current: GameInstance | null = null

  /** 当前活跃实例（全局唯一；SceneRendererComponent 等组件自行从此处获取 DOM/实例） */
  static get current(): GameInstance | null {
    return GameInstance._current
  }

  /** 设置/清除当前活跃实例（Game 生命周期管理） */
  static setCurrent(inst: GameInstance | null): void {
    GameInstance._current = inst
  }

  /** 当前实例关联的 World */
  readonly world: World

  /** 游戏视口组件（持有渲染容器 DOM） */
  readonly viewport: GameViewportComponent

  constructor() {
    super()
    this.world = new World()
    this.viewport = this.addComponent(GameViewportComponent)
    // 编辑器只读桥：编辑器经此组件读取游戏场景（不注入编辑器内容）
    this.addComponent(EditorGameBridgeComponent)
  }

  getWorld(): World | null {
    return this.world
  }

  /** 输入系统（Viewport → Controller 路由） */
  readonly inputSys = new InputSys()

  /** GM 命令模块（调试命令系统：控制台面板 + ai.gmCommand 桥接；生命周期随实例） */
  readonly gm = new GMModule(this)

  /**
   * 初始场景阶段/模式标识，由 Viewport 从 defaultScene 的 SceneAsset.mode 读取并注入。
   * 子类在 start() 中据此决定启动哪个 GameMode。
   */
  initialMode?: string

  /** 当前 GameMode（子类各自持有具体类型实例） */
  protected abstract get gameMode(): GameMode

  /** 当前玩家控制器（用于输入路由） */
  abstract get controller(): PlayerController | null

  /** 状态变化回调 */
  protected callbacks: GameInstanceCallbacks = {}

  /** 注册状态变化回调 */
  setCallbacks(cbs: GameInstanceCallbacks): void {
    this.callbacks = cbs
  }

  /** GameState 订阅取消函数 */
  private _unsubGameState: (() => void) | null = null

  /**
   * 子类返回具体的 GameMode 实例。
   * 不走 start() 流程的子类（如 FishGameInstance）可以不覆盖此方法。
   */
  protected createGameMode(): GameMode {
    throw new Error(`${this.constructor.name} 未实现 createGameMode()，但调用了 start()`)
  }

  /**
   * 启动游戏：初始化 GameMode、自动生成玩家、进入运行态。
   * 子类通过 onStart() 钩子插入特化逻辑（如生成初始道具/鱼群）。
   */
  start(): boolean {
    logger.info(`[${this.constructor.name}] 启动游戏...`)

    // 创建 GameMode 并挂载到 World
    const gm = this.createGameMode()
    this.world.SetGameMode(gm)
    this.world.Stop()

    // 订阅 GameState 状态变化 → 回调
    this._unsubGameState = gm.gameState.subscribe(() => {
      const gs = gm.gameState
      this.callbacks.onScoreChange?.(gs.score)
      this.callbacks.onPhaseChange?.(gs.phase)
      if (gs.phase === 'gameover') {
        this.callbacks.onGameOver?.()
      }
    })

    gm.InitGame()
    gm.StartPlay()
    const ctrl = gm.controller
    if (!ctrl) {
      logger.error(`[${this.constructor.name}] StartPlay 后 controller 为空`)
      return false
    }
    this.onControllerReady(ctrl)
    return this.onStart(ctrl)
  }

  /** 子类钩子：controller 就绪后，子类将 controller 保存到自己的类型化字段 */
  protected onControllerReady(_ctrl: PlayerController): void {}

  /** 子类钩子：在 InitGame + StartPlay + controller 就绪后，插入特化逻辑并调 world.BeginPlay() */
  protected onStart(_ctrl: PlayerController): boolean {
    this.world.BeginPlay()
    return true
  }

  /** 每帧 Tick（由外部渲染循环驱动） */
  abstract tick(dt: number): void

  /** 每帧绘制调试 Gizmos（默认空操作；拥有 World 的实例可重写为 world.drawGizmos()） */
  drawGizmos(): void {}

  /** onPointerDown/onPointerMove 已废弃 — 由 Viewport → inputSys 统一路由 */

  /**
   * 从 PlayerCameraManager 同步到目标摄像机(透视或正交)。
   * 已废弃：改为 getActiveCamera() 委托（渲染器直接用游戏相机渲染，不再复制）。
   */
  abstract syncCamera(targetCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera, aspect: number): void

  /**
   * 获取当前主摄像机（渲染器每帧调用此委托，直接用返回的相机渲染）。
   * 子类从自己的 CameraManager 返回活跃相机；返回 null = 暂不渲染主场景。
   */
  getActiveCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera | null {
    return null
  }

  /** 停止游戏：销毁 Actor、暂停运行 */
  abstract stop(): void

  /** 完全销毁：清理所有资源 */
  destroy(): void {
    if (this._unsubGameState) {
      this._unsubGameState()
      this._unsubGameState = null
    }
  }

  /**
   * 终态化输入子系统（幂等：BObject.EndPlay 自动 markDestroyed + 注册表注销）。
   * 由 Game.shutdown 在实例 destroy() 之后调用。
   */
  teardown(): void {
    this.gm.dispose()
    this.inputSys.EndPlay()
  }
}
