/**
 * Game — 游戏入口类
 * Viewport 通过此类管理游戏的生命周期
 * 职责：包装 GameInstance、管理 Tick/Camera 同步的注册/注销、输入路由
 *
 * 用法：
 *   const game = new Game(gameInstance, sceneMgr, gameMgr)
 *   game.launch()   // 启动
 *   game.shutdown() // 停止
 *   game.update(dt) // 每帧（自动注册到 sceneMgr.onUpdate）
 */
import { PreviewSceneManager, GameSceneManager, logger } from '..'
import { GameInstance } from './GameInstance'
import { GameUI } from '../ui/GameUI'
import { AIModule } from '../ai/AIModule'
import type { World } from './World'

export class Game {
  private _instance: GameInstance
  readonly ui: GameUI

  private sceneMgr: PreviewSceneManager | null = null
  private gameMgr: GameSceneManager | null = null
  private removeTick: (() => void) | null = null
  private removeCamSync: (() => void) | null = null
  /** 防止 shutdown 被重复调用（effect cleanup 和切换工程可能同时触发） */
  private _shutdown = true

  constructor(instance: GameInstance, sceneMgr?: PreviewSceneManager | null, gameMgr?: GameSceneManager | null) {
    this._instance = instance
    this.ui = new GameUI()
    this.sceneMgr = sceneMgr ?? null
    this.gameMgr = gameMgr ?? null
    this._shutdown = false  // 初始状态允许 shutdown
  }

  get instance(): GameInstance { return this._instance }

  /** 更换游戏实例（切换工程时使用），会先停止当前实例 */
  setInstance(newInstance: GameInstance) {
    if (this._instance === newInstance) return
    this.shutdown()
    this._instance.destroy()
    this._instance = newInstance
    this._shutdown = false  // 新实例需要新的 shutdown 生命周期
  }

  /** 关联渲染器（可在构造后设置） */
  setRenderers(sceneMgr: PreviewSceneManager, gameMgr: GameSceneManager) {
    this.sceneMgr = sceneMgr
    this.gameMgr = gameMgr
  }

  /** 启动游戏 */
  launch(): boolean {
    logger.info('[Game] 启动游戏...')

    // UI 覆盖层：挂载到 Game 视口的 UI 层
    if (this.gameMgr) {
      this.gameMgr.mountGameUI(this.ui)
      logger.info('[Game] GameUI 容器已挂载到 GameSceneManager.uiLayer')
    } else {
      logger.warn('[Game] gameMgr 为空，GameUI 容器未挂载')
    }

    // 注入 UI 系统 + 启动游戏实例
    this._instance.ui = this.ui
    logger.info(`[Game] 启动游戏实例: ${this._instance.constructor.name}`)
    const ok = this.instance.start()
    if (!ok) {
      logger.error(`[Game] 游戏实例 start() 返回 false，启动失败: ${this._instance.constructor.name}`)
      return false
    }

    // 启用 Game 渲染
    if (this.gameMgr) {
      this.gameMgr.setControlsEnabled(true)
      // UI 独立场景接入叠加渲染（widget 与 3D 场景分离，场景由 UIManager 持有）
      const world = (this._instance as unknown as { world?: World }).world
      if (world?.ui?.scene) {
        this.gameMgr.attachUIScene(world.ui.scene)
      }
      this.gameMgr.start()
      logger.info('[GameSceneManager] 渲染循环已启动')
    }

    // Tick 挂到 Scene View 的 rAF 上
    if (this.sceneMgr) {
      this.removeTick = this.sceneMgr.onUpdate((dt) => this.instance.tick(dt))
      logger.info('[Game] GameInstance.tick 已挂到 Scene 视口 rAF')
    }

    // Game 摄像机同步
    if (this.gameMgr) {
      this.removeCamSync = this.gameMgr.onUpdate(() => {
        this.instance.syncCamera(this.gameMgr!.camera, this.gameMgr!.aspect)
      })
      logger.info('[Game] 摄像机同步回调已注册')
    }

    logger.info('[Game] 游戏已启动')

    // AI 事件模块：附加运行上下文（world 来自游戏实例的 duck-typed 字段）
    const world = (this._instance as unknown as { world?: World }).world
    if (world) {
      AIModule.instance.attachContext(world, this._instance)
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
    this.removeCamSync?.()
    this.removeCamSync = null
    logger.info('[Game] Tick/相机同步回调已注销')

    // 停止游戏实例
    this.instance.stop()
    logger.info('[Game] 游戏实例已停止')

    // AI 事件模块：清空运行上下文
    AIModule.instance.detachContext()

    // DOM / React 清理由 React 生命周期自然处理（this.ui.el 作为 uiLayer 的子节点，
    // 会在 Viewport 卸载时由 React 自动清理）。此处不做手动 unmount/remove，
    // 避免与 React reconciliation 中的 DOM 操作冲突。
    this.ui.clearElements()

    // 禁用 Game 渲染、重置视角
    if (this.gameMgr) {
      this.gameMgr.setControlsEnabled(false)
      this.gameMgr.attachUIScene(null)
      this.gameMgr.stop()
      this.gameMgr.clearFrame()
      this.gameMgr.resetView()
    }
  }

  /** 每帧更新（如未通过 onUpdate 自动驱动时手动调用） */
  update(dt: number) {
    this.instance.tick(dt)
  }

  /** 销毁游戏实例 */
  destroy() {
    this.shutdown()
    this.ui.dispose()
    this.instance.destroy()
  }
}
