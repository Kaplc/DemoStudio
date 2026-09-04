/**
 * HelloGameMode — 外部工程根示例：游戏规则
 * 注册玩家生成点 + 相机，Tick 驱动 Pawn 弹跳
 */
import { GameMode, CameraComponent, SpawnComponent } from '@/engine'
import { HelloPlayerController } from './HelloPlayerController'
import { HelloPawn } from './HelloPawn'

export class HelloGameMode extends GameMode {
  public spawnComponent: SpawnComponent
  public gameCamera: CameraComponent

  playerRef: HelloPawn | null = null
  private t = 0

  constructor() {
    super()
    this.spawnComponent = new SpawnComponent(this)
    this.addComponent(this.spawnComponent)

    this.gameCamera = new CameraComponent(this, 'GameCamera')
    this.gameCamera.SetView(60, 0.1, 200)
    this.gameCamera.priority = 10
    this.addComponent(this.gameCamera)
  }

  override InitGame() {
    super.InitGame()
    this.playerRef = null
    this.gameState.reset()

    this.spawnComponent.ClearSpawnPoints()
    this.spawnComponent.AddSpawnPoint(0, 1, 0, 'Start')

    this.cameraManager.RegisterCamera(this.gameCamera)
    const cam = this.gameCamera.camera
    cam.position.set(0, 4, 12)
    cam.lookAt(0, 1, 0)
    this.gameCamera.SyncToActor()
  }

  override spawnPlayerInternal() {
    const controller = new HelloPlayerController()
    const pawn = this.spawnComponent.SpawnPawn(new HelloPawn(), 0)
    this.playerRef = pawn as HelloPawn
    return { controller, pawn }
  }

  override Tick(dt: number) {
    super.Tick(dt)
    this.t += dt
    this.t += dt
    if (this.playerRef) {
      this.playerRef.root.position.y = 1 + Math.sin(this.t * 2) * 0.5
    }
  }
}