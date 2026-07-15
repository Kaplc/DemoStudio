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
import * as THREE from 'three'
import { SceneManager, logger } from '..'
import { GameInstance } from './GameInstance'
import { GameUI } from './GameUI'

export class Game {
  private _instance: GameInstance
  readonly ui: GameUI

  private sceneMgr: SceneManager | null = null
  private gameMgr: SceneManager | null = null
  private removeTick: (() => void) | null = null
  private removeCamSync: (() => void) | null = null
  private removeUiRender: (() => void) | null = null

  constructor(instance: GameInstance, sceneMgr?: SceneManager | null, gameMgr?: SceneManager | null) {
    this._instance = instance
    this.ui = new GameUI()
    this.sceneMgr = sceneMgr ?? null
    this.gameMgr = gameMgr ?? null
  }

  get instance(): GameInstance { return this._instance }

  /** 更换游戏实例（切换工程时使用），会先停止当前实例 */
  setInstance(newInstance: GameInstance) {
    if (this._instance === newInstance) return
    this.shutdown()
    this._instance.destroy()
    this._instance = newInstance
  }

  /** 关联渲染器（可在构造后设置） */
  setRenderers(sceneMgr: SceneManager, gameMgr: SceneManager) {
    this.sceneMgr = sceneMgr
    this.gameMgr = gameMgr
  }

  /** 启动游戏 */
  launch(): boolean {
    logger.info('[Game] 启动游戏...')

    // 启用 Game 渲染
    if (this.gameMgr) {
      if (this.gameMgr.controls) this.gameMgr.controls.enabled = true
      this.gameMgr.start()
    }

    // 注入 UI 系统 + 启动游戏实例
    this._instance.ui = this.ui
    const ok = this.instance.start()
    if (!ok) return false

    // Tick 挂到 Scene View 的 rAF 上
    if (this.sceneMgr) {
      this.removeTick = this.sceneMgr.onUpdate((dt) => this.instance.tick(dt))
    }

    // Game 摄像机同步（WASD 激活时跳过）
    if (this.gameMgr) {
      this.removeCamSync = this.gameMgr.onUpdate(() => {
        const mgr = this.gameMgr!
        if (!mgr.isWASDActive) {
          this.instance.syncCamera(mgr.camera, mgr.camera.aspect)
        }
      })
    }

    // UI 渲染：Game 视口渲染完毕后覆盖 UI
    if (this.gameMgr) {
      this.removeUiRender = this.gameMgr.onAfterRender(() => {
        const mgr = this.gameMgr!
        // 更新 UI 尺寸（跟随游戏视口）
        if (mgr.camera.aspect !== this.ui['width'] / this.ui['height']) {
          const w = mgr.renderer.domElement.width
          const h = mgr.renderer.domElement.height
          if (w > 0 && h > 0) this.ui.resize(w, h)
        }
        this.ui.render(mgr.renderer)
      })
    }

    logger.info('[Game] 游戏已启动')
    return true
  }

  /** 停止游戏 */
  shutdown() {
    logger.info('[Game] 停止游戏...')

    // 注销回调
    this.removeTick?.()
    this.removeTick = null
    this.removeCamSync?.()
    this.removeCamSync = null
    this.removeUiRender?.()
    this.removeUiRender = null

    // 停止游戏实例
    this.instance.stop()

    // 禁用 Game 渲染、重置视角
    if (this.gameMgr) {
      if (this.gameMgr.controls) this.gameMgr.controls.enabled = false
      this.gameMgr.stop()
      this.gameMgr.clearFrame()
      this.gameMgr.camera.position.set(17, 17, 17)
      const gc = this.gameMgr.controls
      if (gc) {
        gc.target.set(0, 0, 0)
        gc.update()
      }
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
