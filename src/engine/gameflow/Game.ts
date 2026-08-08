/**
 * Game — 游戏入口类
 * Viewport 通过此类管理游戏的生命周期
 * 职责：创建并包装 GameInstance、管理 Tick/Camera 同步的注册/注销、输入路由
 *
 * 用法：
 *   const game = new Game(sceneMgr)
 *   game.createInstance(projectName, shared, container) // 创建游戏实例
 *   game.launch()   // 启动
 *   game.shutdown() // 停止
 *   game.update(dt) // 每帧（自动注册到 sceneMgr.onUpdate）
 *
 * Game 视口渲染器（GameSceneManager）由 World.ensureGameRenderer 创建并挂载，
 * DOM 由组件内部从 GameInstance.current.renderContainer 获取。
 */
import * as THREE from 'three'
import { logger, PhySys } from '..'
import type { GameSceneManager } from '../rendering/GameSceneManager'
import type { SceneRenderHost } from '../rendering/SceneRenderHost'
import { GameInstance } from './GameInstance'
import type { GameInstanceCallbacks } from './GameInstance'
import { AIModule } from '../ai/AIModule'
import { GameFactoryRegistry } from '../tools/GameFactoryRegistry'
import type { World } from './World'

export class Game {
  private _instance: GameInstance | null = null

  private sceneMgr: SceneRenderHost | null = null
  private removeTick: (() => void) | null = null
  /** 防止 shutdown 被重复调用（effect cleanup 和切换工程可能同时触发） */
  private _shutdown = true

  /** 实例状态回调（createInstance 创建实例时自动注入） */
  private _callbacks: GameInstanceCallbacks = {}

  constructor(sceneMgr?: SceneRenderHost | null) {
    this.sceneMgr = sceneMgr ?? null
    this._shutdown = false  // 初始状态允许 shutdown
  }

  get instance(): GameInstance | null { return this._instance }

  /** 注册实例状态回调（启动游戏前调用；createInstance 时自动注入） */
  setCallbacks(cbs: GameInstanceCallbacks) {
    this._callbacks = cbs
  }

  /**
   * 创建游戏实例（每次启动新建，确保代码变更生效）。
   * 由工厂按项目名创建，自动注入回调；已有实例先销毁。
   * @returns 创建的实例；项目未注册工厂/创建失败时返回 null
   */
  createInstance(projectName: string, shared: THREE.Scene, container: HTMLElement | null): GameInstance | null {
    // 已有实例（上次运行残留）先销毁
    if (this._instance) {
      this.shutdown()
      this._instance = null
    }
    if (!GameFactoryRegistry.has(projectName)) {
      logger.warn(`[Game] 工程 "${projectName}" 未注册游戏实例工厂，跳过创建`)
      return null
    }
    const inst = GameFactoryRegistry.create(projectName, shared, container)
    if (!inst) {
      logger.error(`[Game] 游戏实例创建失败: ${projectName}`)
      return null
    }
    inst.setCallbacks(this._callbacks)
    this._instance = inst
    // 单例：当前活跃实例（GameSceneManager 等组件自行从 GameInstance.current 获取 DOM）
    GameInstance.setCurrent(inst)
    this._shutdown = false  // 新实例需要新的 shutdown 生命周期
    logger.info(`[Game] 游戏实例已创建: ${inst.constructor.name} (${projectName})`)
    return inst
  }

  /**
   * 当前 Game 视口渲染器组件（创建/挂载由 World.ensureGameRenderer 负责，
   * DOM 由组件内部从 GameInstance.current.renderContainer 获取；无容器时为 null）
   */
  private ensureGameMgr(): GameSceneManager | null {
    const world = this._instance ? (this._instance as unknown as { world?: World }).world : null
    if (!world) return null
    return world.ensureGameRenderer()
  }

  /** 关联 Scene 视口渲染宿主（可在构造后设置） */
  setRenderers(sceneMgr: SceneRenderHost) {
    this.sceneMgr = sceneMgr
  }

  /** 启动游戏 */
  launch(): boolean {
    logger.info('[Game] 启动游戏...')

    const inst = this._instance
    if (!inst) {
      logger.error('[Game] 无游戏实例，请先调用 createInstance()')
      return false
    }

    // Game 视口渲染器：DOM 保存在 instance.renderContainer，启动时取出创建
    const gameMgr = this.ensureGameMgr()

    // 启动游戏实例（UI 渲染统一走 UI 摄像机 + CanvasTexture 体系，无 DOM UI 层）
    logger.info(`[Game] 启动游戏实例: ${inst.constructor.name}`)
    const ok = inst.start()
    if (!ok) {
      logger.error(`[Game] 游戏实例 start() 返回 false，启动失败: ${inst.constructor.name}`)
      return false
    }

    // 启用 Game 渲染
    if (gameMgr) {
      gameMgr.setControlsEnabled(true)
      // UI 独立场景接入叠加渲染（widget 与 3D 场景分离，场景由 UIManager 持有）
      const world = (inst as unknown as { world?: World }).world
      if (world?.ui?.scene) {
        gameMgr.attachUIScene(world.ui.scene)
        // 双摄像机：PhySys 注入 UI 独立相机，UI 层点击用平行射线（优先于 3D）
        PhySys.setupUI(gameMgr.uiCamera)
      }
      gameMgr.start()
      logger.info('[GameSceneManager] 渲染循环已启动')
    }

    // Tick + Gizmos 绘制挂到 Scene View 的 rAF 上
    if (this.sceneMgr) {
      this.removeTick = this.sceneMgr.onUpdate((dt) => {
        inst.tick(dt)
        inst.drawGizmos()
      })
      logger.info('[Game] GameInstance.tick/drawGizmos 已挂到 Scene 视口 rAF')
    }

    // Game 摄像机：注册委托，渲染器每帧从游戏实例获取当前主摄像机直接渲染
    if (gameMgr) {
      gameMgr.setCameraProvider(() => inst.getActiveCamera())
      logger.info('[Game] 相机委托已注册（渲染器从游戏实例获取主摄像机）')
    }

    logger.info('[Game] 游戏已启动')

    // AI 事件模块：附加运行上下文（world 来自游戏实例的 duck-typed 字段）
    const world = (inst as unknown as { world?: World }).world
    if (world) {
      AIModule.instance.attachContext(world, inst)
    } else {
      logger.warn('[Game] 游戏实例无 world 字段，AI 事件模块上下文未附加')
    }
    return true
  }

  /** 停止游戏 */
  shutdown() {
    if (this._shutdown) return
    this._shutdown = true
    logger.info('[Game] 停止游戏...')

    // 注销回调
    this.removeTick?.()
    this.removeTick = null
    logger.info('[Game] Tick 回调已注销')

    // 完全销毁游戏实例（stop + world.Destroy + 组件注销）
    this._instance?.destroy()
    // 单例：清除当前活跃实例
    GameInstance.setCurrent(null)
    logger.info('[Game] 游戏实例已销毁，单例已清除')

    // AI 事件模块：清空运行上下文
    AIModule.instance.detachContext()

    // 禁用 Game 渲染、解除相机委托、重置视角
    const gameMgr = this.ensureGameMgr()
    if (gameMgr) {
      gameMgr.setCameraProvider(null)
      gameMgr.setControlsEnabled(false)
      gameMgr.attachUIScene(null)
      PhySys.setupUI(null)
      gameMgr.stop()
      gameMgr.clearFrame()
      gameMgr.resetView()
    }

    // 清理 PhySys 全局状态（物理解耦模块引用，避免多实例串扰）
    PhySys.clear()
  }

  /** 每帧更新（如未通过 onUpdate 自动驱动时手动调用） */
  update(dt: number) {
    this._instance?.tick(dt)
  }

  /** 销毁游戏实例 */
  destroy() {
    this.shutdown()
  }
}
