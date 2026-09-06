/**
 * ArenaGameMode — 竞技场游戏模式（M1 垂直切片：1 房间可玩）
 *
 * 职责：
 *  - 跟随相机（引擎 A4 FollowCameraComponent）注册与目标绑定
 *  - 玩家生成（Pawn 摆到场景 PlayerSpawn 点）+ 代码构建 HUD（ArenaHud）
 *  - 房间波次：开局刷 3 只史莱姆（SlimeActor，引擎 A8 FSM 驱动）
 *  - 清房检测：全部死亡 → 开门（门体上滑）+ 消息
 *  - 拾取触发：回血圈（场景 isTrigger 触发器，引擎 A1）进入即回血（一次性）
 *  - 音频监听点：每帧把玩家位置注入 AudioSys（3D 衰减基准）
 */
import * as THREE from 'three'
import { GameMode } from '@/engine'
import { CameraActor } from '@/engine'
import { FollowCameraComponent } from '@/engine'
import { BoxColliderComponent } from '@/engine'
import { audioSys } from '@/engine/audio/AudioSys'
import { logger } from '@/engine/Logger'
import type { Actor, PlayerController, Pawn, World } from '@/engine'
import { ArenaPlayerPawn } from './ArenaPlayerPawn'
import { ArenaPlayerController } from './ArenaPlayerController'
import { ArenaHud } from './ArenaHud'
import { SlimeActor } from './SlimeActor'

/** 房间配置（M1 内联；M2 迁波次配置表 + 房间递进） */
const SLIME_SPAWNS: Array<[number, number]> = [
  [-8, -6],
  [8, -6],
  [0, -10],
]
const DOOR_OPEN_HEIGHT = 3.6
const DOOR_OPEN_SPEED = 2.2

export class ArenaGameMode extends GameMode {
  cameraActor: CameraActor
  follow: FollowCameraComponent
  player: ArenaPlayerPawn | null = null
  /** 房间状态（AI 快照/e2e 断言） */
  roomCleared = false
  doorOpened = false
  kills = 0

  private _slimes: SlimeActor[] = []
  private _hud: ArenaHud | null = null
  private _door: Actor | null = null
  private _doorOpenedAmount = 0
  private _healUsed = false
  private _doorCollider: BoxColliderComponent | null = null
  private _pendingSpawnDelay = 0.8

  constructor() {
    super()
    // 第三人称跟随相机（独立 CameraActor，BeginPlay 时 spawn 进世界）
    this.cameraActor = new CameraActor('ArenaFollowCamera', 'perspective')
    this.cameraActor.SetView(55, 0.1, 300)
    this.cameraActor.priority = 10
    this.follow = this.cameraActor.addComponent(FollowCameraComponent)
    this.follow.offset = [0, 11, 12]
    this.follow.followSpeed = 6
    this.follow.lookAtHeight = 1.2
  }

  override InitGame(): void {
    super.InitGame()
    this.roomCleared = false
    this.doorOpened = false
    this.kills = 0
    this._slimes = []
    this._healUsed = false
    this._pendingSpawnDelay = 0.8
  }

  override spawnPlayerInternal(): { controller: PlayerController; pawn: Pawn } {
    return { controller: new ArenaPlayerController(), pawn: new ArenaPlayerPawn() }
  }

  /** 玩家生成完成（StartPlay 阶段；BeginPlay 前引用已就绪） */
  protected override OnPawnSpawned(pawn: Pawn): void {
    super.OnPawnSpawned(pawn)
    this.player = pawn as unknown as ArenaPlayerPawn
  }

  override BeginPlay(): void {
    super.BeginPlay()
    const world = this.world
    if (!world) return

    // 重力世界直接速度控制语义：默认摩擦关闭（摩擦预算 ∝ |g|）
    world.physics.setDefaultFriction(0)

    // 相机生成 + 注册 + 玩家绑定
    world.actorMgr.SpawnActor(this.cameraActor)
    this.cameraManager.RegisterCamera(this.cameraActor.cameraComponent)
    if (this.player) {
      this.follow.setTarget(this.player, true)
    }

    // 场景物定位：出生点 / 门 / 回血圈
    const spawn = world.findActorByName('PlayerSpawn')
    if (spawn && this.player) {
      const p = spawn.root.position
      // dynamic body 是位置权威（syncActorFromBody 每帧回写 root）——
      // 出生点定位必须同时写 body，仅 setPosition 会被下一物理帧覆盖回原点
      const body = this.player.collider.body
      if (body) {
        body.wakeUp()
        body.position.set(p.x, p.y + this.player.collider.offset[1], p.z)
        body.velocity.set(0, 0, 0)
      }
      this.player.setPosition(p.x, p.y, p.z)
      this.follow.setTarget(this.player, true)
    }
    this._door = world.findActorByName('Door')
    this._doorCollider = this._door?.getComponent(BoxColliderComponent) ?? null
    this._setupHealCircle(world)

    // 战斗反馈装配：受击音 + 死亡回调
    const player = this.player
    if (player) {
      player.health.onDamaged = () => {
        player.flashHurt()
        audioSys.playAt('player.hurt', player.root.position, { maxDistance: 40 })
        this.follow.shake(0.12, 0.18)
      }
      player.health.onDied = () => {
        audioSys.play('player.die')
        this.follow.shake(0.3, 0.4)
        this.gameState.setPhase('gameover')
        logger.info('[Arena] 玩家死亡 — gameover')
      }
    }

    // HUD（代码构建；M2 迁 .widget.html 源格式）
    this._hud = new ArenaHud()
    world.actorMgr.SpawnActor(this._hud)

    logger.info('[Arena] BeginPlay 完成（等待刷怪）')
  }

  /** 回血圈触发器（A1）：玩家进入 → 回满血一次。
   *  注：触发体用 Box 而非 Circle(Cylinder)——cannon sphere×convex 对深穿透
   *  （球心进入凸体内部）不产出接触，box×sphere 路径可靠。 */
  private _setupHealCircle(world: World): void {
    const heal = world.findActorByName('HealCircle')
    if (!heal) return
    const trigger = heal.getComponent(BoxColliderComponent)
    if (!trigger) {
      logger.warn('[Arena] HealCircle 缺少 BoxColliderComponent 触发体')
      return
    }
    if (!trigger) return
    trigger.onTriggerEnter = (e) => {
      if (this._healUsed || !this.player) return
      if (e.other.owner !== this.player) return
      if (this.player.health.isDead) return
      this._healUsed = true
      const healed = this.player.health.heal(this.player.health.maxHp)
      if (healed > 0) {
        audioSys.play('heal', { volume: 0.9 })
        this.player.particles.emit({
          count: 18,
          speed: [1, 3],
          spread: 'hemisphere',
          lifetime: [0.3, 0.6],
          size: 0.12,
          color: ['#3ddc84', '#a8ffcf'],
          gravity: -4,
          additive: true,
          localOffset: [0, 0.5, 0],
        })
        logger.info('[Arena] 回血圈生效（一次性）')
      }
    }
  }

  /** 相机震动透传（连击第三段重击调用） */
  shakeCamera(intensity: number, duration: number): void {
    this.follow.shake(intensity, duration)
  }

  override Tick(dt: number): void {
    super.Tick(dt)
    const world = this.world
    if (!world) return

    // 音频监听点跟随玩家（3D 衰减基准）
    if (this.player) {
      const p = this.player.root.position
      audioSys.setListener(p.x, p.y, p.z)
    }

    // 延迟刷怪（等相机/物理稳定）
    if (this._pendingSpawnDelay > 0) {
      this._pendingSpawnDelay -= dt
      if (this._pendingSpawnDelay <= 0) this._spawnWave(world)
    }

    // 门开启动画（上滑；static 碰撞体经 onTransformChanged 自动同步）
    if (this.doorOpened && this._door && this._doorOpenedAmount < DOOR_OPEN_HEIGHT) {
      this._doorOpenedAmount = Math.min(DOOR_OPEN_HEIGHT, this._doorOpenedAmount + DOOR_OPEN_SPEED * dt)
      this._door.setPosition(this._door.root.position.x, 1.5 + this._doorOpenedAmount, this._door.root.position.z)
      this._doorCollider?.syncStaticPosition()
    }

    this._hud?.sync({
      hp: this.player?.health.hp ?? 0,
      maxHp: this.player?.health.maxHp ?? 1,
      kills: this.kills,
      total: SLIME_SPAWNS.length,
      message: this.player?.health.isDead
        ? '你死了…（重启再来）'
        : this.roomCleared
          ? '房间已清除！大门开启（M2：下一间）'
          : '清除所有史莱姆！',
      comboStage: this.player?.combat.stage ?? 0,
    })
  }

  /** 刷波：3 只史莱姆（M2 起走波次配置表） */
  private _spawnWave(world: World): void {
    for (let i = 0; i < SLIME_SPAWNS.length; i++) {
      const [x, z] = SLIME_SPAWNS[i]
      const slime = new SlimeActor(`Slime_${i + 1}`)
      slime.setPosition(x, 0.9, z)
      this.registerSlime(slime)
      world.actorMgr.SpawnActor(slime)
    }
    logger.info(`[Arena] 波次生成: ${SLIME_SPAWNS.length} 只史莱姆`)
  }

  /** 登记史莱姆进清点（波次与 GM 生成共用；目标与死亡回调在此装配） */
  registerSlime(slime: SlimeActor): void {
    slime.target = this.player
    slime.onDeathComplete = () => this._onSlimeGone(slime)
    this._slimes.push(slime)
  }

  /** 击杀清点：全灭 → 清房开门 */
  private _onSlimeGone(slime: SlimeActor): void {
    this._slimes = this._slimes.filter((s) => s !== slime)
    this.kills++
    audioSys.play('pickup.coin', { volume: 0.6 })
    if (this._slimes.length === 0 && !this.roomCleared) {
      this.roomCleared = true
      this.doorOpened = true
      audioSys.play('door.open')
      logger.info('[Arena] 房间清除 — 大门开启')
    }
  }

  /** GM/e2e 辅助：存活史莱姆列表 */
  get aliveSlimes(): SlimeActor[] {
    return this._slimes.filter((s) => !s.health.isDead)
  }
}
