/**
 * Hoi4GameInstance — 游戏实例（阶段路由 + 存档 + 相机委托）
 *
 * 单场景：世界地图（mode="map" → Hoi4GameMode）。
 * 配置加载在构造期启动（glob 异步）；存档 KV 手动落盘。
 */
import * as THREE from 'three'
import { GameInstance, logger, spawnActor, SaveSlotComponent } from '@/engine'
import type { PlayerController } from '@/engine'
import { Hoi4GameMode } from './gameplay/base/Hoi4GameMode'
import { Hoi4PlayerController } from './gameplay/base/Hoi4PlayerController'
import { Hoi4ConfigLoader } from './Hoi4ConfigLoader'

export const HOI4_SAVE_FILE = 'projects/hoi4/data/save.json'

export class Hoi4GameInstance extends GameInstance {
  private _gameMode: Hoi4GameMode | null = null
  private _controller: Hoi4PlayerController | null = null

  /** 存档：KV 内存优先，saveGame/loadGame 显式落盘/回读 */
  readonly save: SaveSlotComponent

  constructor() {
    super()
    // 配置表注册（glob 异步加载；GameMode.tryBootstrap 轮询就绪）
    new Hoi4ConfigLoader().init()
    this.save = new SaveSlotComponent(this, { filePath: HOI4_SAVE_FILE })
  }

  override get gameMode(): Hoi4GameMode {
    if (!this._gameMode) throw new Error('[Hoi4GameInstance] gameMode 未初始化（start 未调用）')
    return this._gameMode
  }

  /** 兼容基类契约（start 前调用会抛错，与 fish 同款） */
  override createGameMode(): Hoi4GameMode {
    throw new Error('[Hoi4GameInstance] 走 SwitchToScene 创建 GameMode，勿直接 createGameMode')
  }

  override get controller(): PlayerController | null {
    return this._controller
  }

  override start(): boolean {
    logger.info('[Hoi4] 游戏实例启动')
    const ok = this.world.SwitchToScene('Hoi4Map', () => {
      const mode = this.world.gameMode as Hoi4GameMode
      this._gameMode = mode
      spawnActor(mode.camera)
      mode.cameraManager.RegisterCamera(mode.camera.cameraComponent)
      mode.camera.place()
      if (this.world.gameRenderer?.uiLayer) {
        // PhySys 相机在 GameMode.BeginPlay 已 setup；此处兜底（时序依赖 renderer 就绪）
      }
      if (mode.controller instanceof Hoi4PlayerController) {
        this._controller = mode.controller
      } else {
        logger.error('[Hoi4] controller 未就绪')
      }
      // 异步读档（不阻塞启动；读档在 bootstrap 之后回填由 restoreSave 自行门槛）
      void this.loadGameAsync()
    })
    if (!ok) logger.error('[Hoi4] 切换地图场景失败')
    return ok
  }

  /** 异步读档 → 回填（幂等：存档不存在则静默） */
  private async loadGameAsync(): Promise<void> {
    const loaded = await this.save.load()
    if (!loaded) return
    const snap = this.save.get<import('@/engine').KVValue>('hoi4save')
    if (!snap) return
    this._gameMode?.restoreSave(snap)
  }

  /** 手动保存（GM/菜单入口） */
  async saveGame(): Promise<boolean> {
    const mode = this._gameMode
    if (!mode) return false
    const snap = mode.captureSave()
    if (!snap) {
      logger.warn('[Hoi4] 保存失败：游戏尚未初始化完成')
      return false
    }
    this.save.set('hoi4save', snap as import('@/engine').KVValue)
    const ok = await this.save.flush(true)
    logger.info(`[Hoi4] 手动保存${ok ? '成功' : '失败'} → ${HOI4_SAVE_FILE}`)
    return ok
  }

  /** 手动读取 */
  async loadGame(): Promise<boolean> {
    const loaded = await this.save.load()
    if (!loaded) return false
    const snap = this.save.get<import('@/engine').KVValue>('hoi4save')
    if (!snap) return false
    return this._gameMode?.restoreSave(snap) ?? false
  }

  override tick(dt: number) {
    this.world.manualTick(dt)
  }

  override drawGizmos() {
    this.world.drawGizmos()
  }

  override syncCamera(_targetCamera: THREE.PerspectiveCamera, _aspect: number) {
    // 相机委托已改为 getActiveCamera()（渲染器直接用游戏相机）
  }

  override getActiveCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera | null {
    if (!this._gameMode) return null
    return this._gameMode.cameraManager.GetActiveCameraObject()
  }

  override stop() {
    if (!this._controller && !this._gameMode) return
    logger.info('[Hoi4] 停止游戏...')
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
