/**
 * RacingGameMode — 赛车游戏规则
 * 控制：计时、圈数、检查点、游戏结束
 */
import * as THREE from 'three'
import { GameMode, SpawnComponent, CameraComponent, gizmos, logger } from '@/engine'
import { RacingCarPawn } from './RacingCarPawn'
import { RacingPlayerController } from './RacingPlayerController'
import { DEFAULT_CONFIG } from './types'
import type { GameConfig, GamePhase } from './types'

const _v3 = new THREE.Vector3()
const _v3b = new THREE.Vector3()
const _trackCenter = new THREE.Vector3()
const _lookTarget = new THREE.Vector3()

export class RacingGameMode extends GameMode {
  public spawnComponent: SpawnComponent
  public gameCamera: CameraComponent

  private config: GameConfig

  /** 玩家引用 */
  playerRef: RacingCarPawn | null = null

  /** 游戏阶段 */
  public currentPhase: GamePhase = 'countdown'
  public countdownTimer = 0

  /** 检查点角度 (12 个检查点均匀分布在赛道圆周上) */
  private checkpointAngles: number[] = []
  private nextCheckpointIndex = 0
  private checkpointRadius = 0

  /** 起始/终点线角度 */
  private static readonly START_ANGLE = 0

  constructor() {
    super()
    this.config = { ...DEFAULT_CONFIG }

    this.spawnComponent = new SpawnComponent(this)
    this.addComponent(this.spawnComponent)

    // 游戏摄像机（第三人称追尾视角）
    this.gameCamera = new CameraComponent(this, 'GameCamera')
    this.gameCamera.SetView(55, 0.1, 200)
    this.gameCamera.priority = 10
    this.addComponent(this.gameCamera)

    // 初始化检查点 (沿跑道圆周均匀分布 8 个)
    const cpCount = 8
    for (let i = 0; i < cpCount; i++) {
      this.checkpointAngles.push((Math.PI * 2 / cpCount) * i)
    }
  }

  override InitGame() {
    super.InitGame()
    this.playerRef = null
    this.currentPhase = 'countdown'
    this.countdownTimer = this.config.countdownTime
    this.nextCheckpointIndex = 0
    this.checkpointRadius = this.config.trackRadius
    this.gameState.reset()

    // 配置生成点
    this.spawnComponent.ClearSpawnPoints()
    // 赛车生在跑道外侧，朝向赛道
    const startX = this.config.trackRadius - 3
    this.spawnComponent.AddSpawnPoint(startX, 0.15, 0, 'Start')

    // 摄像机初始位置
    this.cameraManager.RegisterCamera(this.gameCamera)
    const cam = this.gameCamera.camera
    cam.position.set(0, 15, -20)
    cam.lookAt(0, 0, 0)
    this.gameCamera.SyncToActor()
  }

  override StartPlay() {
    super.StartPlay()
  }

  override Tick(dt: number) {
    super.Tick(dt)

    const player = this.playerRef
    if (!player) return

    // 阶段逻辑
    switch (this.currentPhase) {
      case 'countdown':
        this.countdownTimer -= dt
        if (this.countdownTimer <= 0) {
          this.currentPhase = 'racing'
          this.gameState.setPhase('playing')
          logger.info('[Racing] GO!')
        }
        break

      case 'racing':
        this.updateRacing(player, dt)
        break

      case 'finished':
        break

      case 'gameover':
        break
    }

    // 摄像机跟随
    this.updateCameraFollow(player)
  }

  private updateRacing(player: RacingCarPawn, dt: number) {
    // 检查是否通过起点/终点线
    this.checkStartFinish(player, dt)

    // 时间限制
    if (player.raceTime >= this.config.timeLimit) {
      this.currentPhase = 'gameover'
      this.gameState.setPhase('gameover')
      logger.warn('[Racing] 时间到!')
    }
  }

  /** 检查经过起点线 */
  private checkStartFinish(player: RacingCarPawn, dt: number) {
    const pos = player.position
    const carAngle = Math.atan2(pos.z, pos.x) // -PI ~ PI

    // 起点线在角度 0 (正 X 轴方向)
    // 检测赛车从附近经过
    const dist = Math.sqrt(pos.x * pos.x + pos.z * pos.z)
    const onTrack = dist > this.config.trackRadius - this.config.trackWidth / 2 &&
                    dist < this.config.trackRadius + this.config.trackWidth / 2

    if (!onTrack) return

    // 用角度判断是否越过起点线 (角度 ≈ 0，且赛车在赛道宽度内)
    const angleDiff = Math.abs(carAngle)
    if (angleDiff < 0.2) {
      // 在起点线附近，检查当前角度 vs 上一帧角度判断方向
      if (player.currentLapTime > 0.5) {
        // 方向检测：根据位置变化判断是正向通过还是反向
        const prevAngle = player.raceTime > dt
          ? this.getPreviousAngle(player) : carAngle

        let crossed = carAngle * prevAngle < 0 && Math.abs(carAngle) < 0.3
        // 从 -PI 到 +PI 的跨跃也算一圈
        if (prevAngle > 2.5 && carAngle < -2.5) {
          crossed = true
        }

        if (crossed) {
          player.completeLap()
          if (player.lapCount >= this.config.lapsToWin) {
            player.finished = true
            this.currentPhase = 'finished'
            this.gameState.setPhase('gameover')
            logger.info(`[Racing] 🏆 完成所有圈数! 总用时: ${player.raceTime.toFixed(2)}s`)
          }
        }
      }
    }
  }

  /** 获取上一帧的赛车角度 (通过记录) */
  private _prevAngle = 0
  private getPreviousAngle(player: RacingCarPawn): number {
    const angle = this._prevAngle
    this._prevAngle = Math.atan2(player.position.z, player.position.x)
    return angle
  }

  /** 第三人称追尾摄像机 */
  private updateCameraFollow(player: RacingCarPawn) {
    const cam = this.gameCamera.camera
    const ppos = player.position
    const speed = player.speed

    // 获取赛车朝向
    _v3.set(0, 0, 1).applyQuaternion(player.root.quaternion)

    // 摄像机在车后方+上方
    const followDist = 8 + Math.min(5, Math.abs(speed) * 0.15)
    const followHeight = 4 + Math.min(3, Math.abs(speed) * 0.08)

    _lookTarget.copy(ppos)
    _lookTarget.y += 0.5

    // 后方偏移 = 朝向的反方向 + 上方
    cam.position.copy(_lookTarget)
    cam.position.x -= _v3.x * followDist
    cam.position.z -= _v3.z * followDist
    cam.position.y += followHeight

    // 始终看向赛车
    cam.lookAt(_lookTarget)
    this.gameCamera.SyncToActor()
  }

  override spawnPlayerInternal() {
    const controller = new RacingPlayerController()
    const pawn = this.spawnComponent.SpawnPawn(new RacingCarPawn(), 0)
    this.playerRef = pawn as RacingCarPawn
    return { controller, pawn }
  }

  override IsGameOver(): boolean {
    return this.currentPhase === 'finished' || this.currentPhase === 'gameover'
  }

  // ═══ Gizmos ═══

  override OnDrawGizmos() {
    const r = this.config.trackRadius
    const halfW = this.config.trackWidth / 2

    // 赛道内外圈
    gizmos.color = 0x888888
    const segments = 32
    for (let i = 0; i < segments; i++) {
      const a1 = (Math.PI * 2 / segments) * i
      const a2 = (Math.PI * 2 / segments) * (i + 1)

      // 内圈
      _v3.set(Math.cos(a1) * (r - halfW), 0.05, Math.sin(a1) * (r - halfW))
      _v3b.set(Math.cos(a2) * (r - halfW), 0.05, Math.sin(a2) * (r - halfW))
      gizmos.DrawLine(_v3, _v3b)

      // 外圈
      _v3.set(Math.cos(a1) * (r + halfW), 0.05, Math.sin(a1) * (r + halfW))
      _v3b.set(Math.cos(a2) * (r + halfW), 0.05, Math.sin(a2) * (r + halfW))
      gizmos.DrawLine(_v3, _v3b)
    }

    // 起点线
    gizmos.color = 0xffffff
    _v3.set(r - halfW, 0.05, 0)
    _v3b.set(r + halfW, 0.05, 0)
    gizmos.DrawLine(_v3, _v3b)

    if (!this.world?.running) return
  }
}
