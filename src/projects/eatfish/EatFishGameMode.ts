/**
 * EatFishGameMode — 大鱼吃小鱼游戏规则
 * 控制：小鱼生成、碰撞检测、计分、游戏结束
 */
import * as THREE from 'three'
import { GameMode, SpawnComponent, CameraComponent, gizmos, logger, ConfigRegistry, getAllActors, spawnActorOfType } from '@/engine'
import type { DataTable } from '@/engine'
import { EatFishPawn } from './EatFishPawn'
import { EatFishFoodPawn } from './EatFishFoodPawn'
import { EatFishPredatorPawn } from './EatFishPredatorPawn'
import { EatFishPlayerController } from './EatFishPlayerController'
import { FishSchool } from './FishSchool'
import type { GameConfig, FishArchetype } from './types'

const _v3 = new THREE.Vector3()
const _v3b = new THREE.Vector3()
const _camTarget = new THREE.Vector3()

export class EatFishGameMode extends GameMode {
  public spawnComponent: SpawnComponent
  public gameCamera: CameraComponent

  private foodFish: EatFishFoodPawn[] = []
  private predators: EatFishPredatorPawn[] = []
  /** 鱼群列表 */
  private schools: FishSchool[] = []
  private config: GameConfig
  /** 鱼类原型数据表（DataTable 演示；表未加载时为 null） */
  private fishTable: DataTable<FishArchetype> | null = null

  /** 玩家引用（每帧用于摄像机跟随） */
  playerRef: EatFishPawn | null = null

  // 追踪已吃鱼的数量用于难度递增
  private eatCount = 0

  constructor() {
    super()
    // 配置表由 EatFishGameInstance 构造时统一加载（见 EatFishGameInstance），此处直接读取
    this.config = { ...ConfigRegistry.getConfig<GameConfig>('eatfish.eatfish') }
    this.spawnComponent = new SpawnComponent(this)
    this.addComponent(this.spawnComponent)

    // 游戏摄像机（俯视 2.5D 视角）
    this.gameCamera = new CameraComponent(this, 'GameCamera')
    this.gameCamera.SetView(45, 0.1, 200)
    this.gameCamera.priority = 10
    this.addComponent(this.gameCamera)
  }

  override InitGame() {
    super.InitGame()
    this.foodFish = []
    this.predators = []
    this.schools = []
    this.playerRef = null
    this.eatCount = 0

    // 取鱼类原型数据表（DataTable 演示；未加载时为 null，下游用 if 守卫）
    this.fishTable = ConfigRegistry.getTable<FishArchetype>('eatfish.fish') ?? null

    // 配置生成点
    this.spawnComponent.ClearSpawnPoints()
    this.spawnComponent.AddSpawnPoint(0, 0.5, 0, 'PlayerSpawn')

    // 注册并设置游戏摄像机初始位置（与 updateCameraFollow 一致）
    this.cameraManager.RegisterCamera(this.gameCamera)
    const cam = this.gameCamera.camera
    cam.position.set(0, 18, 10)
    cam.lookAt(0, 0.5, 0)
    this.gameCamera.SyncToActor()
  }

  override StartPlay() {
    super.StartPlay()
  }

  // ═══════════════════════════════════
  //  生成管理
  // ═══════════════════════════════════

  /** 生成食物鱼（独立鱼，不属于鱼群） */
  SpawnFoodFish() {
    const food = spawnActorOfType(EatFishFoodPawn)
    // DataTable 演示：若原型表已加载，用随机原型行设置完整属性（颜色/大小/速度/分值）
    if (this.fishTable && this.fishTable.size > 0) {
      const names = this.fishTable.getRowNames()
      const row = this.fishTable.getRow(names[Math.floor(Math.random() * names.length)])
      if (row) {
        food.setArchetype(row)
      }
    }
    this.foodFish.push(food)
  }

  /** 生成一个鱼群 */
  SpawnSchool(colorTheme: number[]) {
    const school = new FishSchool(colorTheme, this.config)
    const centerX = (Math.random() - 0.5) * (this.config.arenaHalf * 2 - 6)
    const centerZ = (Math.random() - 0.5) * (this.config.arenaHalf * 2 - 6)

    for (let i = 0; i < this.config.fishPerSchool; i++) {
      const fish = spawnActorOfType(EatFishFoodPawn)
      // 在鱼群中心附近分散
      const angle = Math.random() * Math.PI * 2
      const dist = Math.random() * 2
      fish.setPosition(
        centerX + Math.cos(angle) * dist,
        0.5,
        centerZ + Math.sin(angle) * dist,
      )
      fish.setBodyColor(colorTheme[i % colorTheme.length])
      school.addMember(fish)
      this.foodFish.push(fish)
    }

    this.schools.push(school)
  }

  /** 生成捕食者鱼 */
  SpawnPredator() {
    const predator = spawnActorOfType(EatFishPredatorPawn)
    this.predators.push(predator)
    logger.info(`[EatFish] 生成捕食者, 当前数量: ${this.predators.length}`)
  }

  /** 初始生成所有鱼 */
  SpawnInitialFish() {
    // 生成鱼群
    for (let i = 0; i < this.config.schoolCount; i++) {
      const colors = this.config.schoolColors[i % this.config.schoolColors.length]
      this.SpawnSchool(colors)
    }

    // 生成一些独立游动的鱼作为散兵
    const remaining = this.config.foodFishCount - (this.config.schoolCount * this.config.fishPerSchool)
    for (let i = 0; i < Math.max(0, remaining); i++) {
      this.SpawnFoodFish()
    }

    // 生成捕食者
    for (let i = 0; i < this.config.predatorCount; i++) {
      this.SpawnPredator()
    }

    logger.info(`[EatFish] 生成完成: ${this.schools.length}个鱼群 + 独立鱼, ${this.predators.length}个捕食者`)
  }

  /** 补充食物鱼 */
  private maintainFoodCount() {
    const alive = this.foodFish.filter(f => !f.bPendingDestroy)
    const target = this.config.foodFishCount + Math.floor(this.eatCount / 5)
    if (alive.length >= Math.min(target, 30)) return

    // 优先补充到现有鱼群
    const activeSchools = this.schools.filter(s => s.alive)
    for (const school of activeSchools) {
      const schoolAlive = school.getAliveMembers()
      if (schoolAlive.length < this.config.fishPerSchool && alive.length < target) {
        const fish = spawnActorOfType(EatFishFoodPawn)
        // 在鱼群中心附近生成
        const angle = Math.random() * Math.PI * 2
        const dist = Math.random() * 1.5
        fish.setPosition(
          school.center.x + Math.cos(angle) * dist,
          0.5,
          school.center.z + Math.sin(angle) * dist,
        )
        fish.setBodyColor(school.colors[0])
        school.addMember(fish)
        this.foodFish.push(fish)
      }
    }

    // 如果还不够，生成独立鱼
    const stillAlive = this.foodFish.filter(f => !f.bPendingDestroy)
    for (let i = stillAlive.length; i < Math.min(target, 30); i++) {
      this.SpawnFoodFish()
    }
  }

  /** 补充捕食者 */
  private maintainPredatorCount() {
    const alive = this.predators.filter(p => !p.bPendingDestroy)
    // 每吃 8 条鱼增加一个捕食者
    const target = this.config.predatorCount + Math.floor(this.eatCount / 8)
    for (let i = alive.length; i < Math.min(target, 5); i++) {
      this.SpawnPredator()
    }
  }

  // ═══════════════════════════════════
  //  碰撞检测
  // ═══════════════════════════════════

  private checkCollisions(player: EatFishPawn) {
    if (player.invincible) return

    const playerPos = player.position
    const playerScale = player.getScale()

    // 检测与食物鱼的碰撞
    for (const food of this.foodFish) {
      if (food.bPendingDestroy) continue

      _v3.copy(food.position).sub(playerPos)
      const dist = _v3.length()
      const foodSize = food.getSizeScale()
      const collisionDist = (playerScale + foodSize) * 0.6

      if (dist < collisionDist) {
        // 吃鱼！
        if (playerScale > foodSize * 0.8) {
          this.OnEatFood(player, food)
        }
      }
    }

    // 检测与捕食者的碰撞
    for (const pred of this.predators) {
      if (pred.bPendingDestroy) continue

      _v3.copy(pred.position).sub(playerPos)
      const dist = _v3.length()
      const predSize = pred.getSizeScale()
      const collisionDist = (playerScale + predSize) * 0.5

      if (dist < collisionDist) {
        // 如果玩家比捕食者大很多，可以反杀捕食者
        if (playerScale > predSize * 1.5) {
          this.OnEatPredator(player, pred)
        } else {
          // 否则被吃掉
          this.OnPlayerEaten(player)
          return
        }
      }
    }
  }

  /** 吃食物鱼 */
  OnEatFood(player: EatFishPawn, food: EatFishFoodPawn) {
    const foodSize = food.getSizeScale()
    // 表加载时按原型分值计分；否则回退到按大小计算的分数
    const points = food.archetypeScore ?? Math.max(1, Math.floor((1 / foodSize) * 3))
    this.gameState.addScore(points)
    player.Grow(this.config.growPerEat)
    this.eatCount++

    // 从所在鱼群移除
    this.removeFromSchool(food)

    logger.info(`[EatFish] 吃鱼! +${points}分, 大小: ${player.getScale().toFixed(2)}`)
    food.destroy()
  }

  /** 将鱼从所属鱼群移除 */
  private removeFromSchool(fish: EatFishFoodPawn) {
    for (const school of this.schools) {
      const idx = school.members.indexOf(fish)
      if (idx >= 0) {
        school.removeMember(fish)
        break
      }
    }
  }

  /** 反杀捕食者 */
  OnEatPredator(player: EatFishPawn, predator: EatFishPredatorPawn) {
    this.gameState.addScore(10)
    player.Grow(this.config.growPerEat * 3)
    this.eatCount += 3

    logger.info(`[EatFish] 反杀捕食者! +10分`)

    predator.destroy()
    // 延迟重生捕食者
    setTimeout(() => {
      if (this.world?.running) {
        this.SpawnPredator()
      }
    }, 5000)
  }

  /** 被吃掉（游戏结束） */
  OnPlayerEaten(player: EatFishPawn) {
    logger.warn('[EatFish] 玩家被吃掉了! Game Over')
    this.gameState.setPhase('gameover')
  }

  override Tick(dt: number) {
    super.Tick(dt)
    if (this.gameState.phase !== 'playing') return

    // 更新鱼群
    for (const school of this.schools) {
      if (school.alive) {
        school.tick(dt, this.config.arenaHalf)
      }
    }

    // 独立鱼使用自己的 Tick
    for (const fish of this.foodFish) {
      if (fish.bPendingDestroy) continue
      // 只在非鱼群成员时使用独立 Tick
      let inSchool = false
      for (const school of this.schools) {
        if (school.members.indexOf(fish) >= 0) {
          inSchool = true
          break
        }
      }
      if (!inSchool) {
        fish.tickIndependent(dt)
      }
    }

    // 维护鱼群数量
    this.maintainFoodCount()
    this.maintainPredatorCount()

    // 碰撞检测
    const player = this.findPlayer()
    if (player) {
      this.checkCollisions(player)
    }

    // ─── 摄像机跟随玩家 ───
    this.updateCameraFollow()
  }

  /** 每帧更新摄像机位置：正上方俯视跟随，不跟踪玩家旋转 */
  private updateCameraFollow() {
    const player = this.playerRef
    if (!player) return

    const cam = this.gameCamera.camera
    const ppos = player.position

    // 摄像机在玩家正上方偏后，瞄准鱼的位置（y=0.5），不受朝向影响
    _camTarget.set(ppos.x, 0.5, ppos.z)
    cam.position.set(_camTarget.x, 18, _camTarget.z + 10)
    cam.lookAt(_camTarget)
    this.gameCamera.SyncToActor()
  }

  private findPlayer(): EatFishPawn | null {
    if (!this.world) return null
    for (const actor of getAllActors()) {
      if (actor instanceof EatFishPawn) return actor
    }
    return null
  }

  override IsGameOver(): boolean {
    return this.gameState.phase === 'gameover'
  }

  override spawnPlayerInternal() {
    const controller = new EatFishPlayerController()
    const pawn = this.spawnComponent.SpawnPawn(new EatFishPawn(), 0)
    this.playerRef = pawn as EatFishPawn
    return { controller, pawn }
  }

  /** 游戏结束后可以调用此方法清理鱼群 */
  CleanupFish() {
    for (const food of this.foodFish) {
      if (!food.bPendingDestroy) food.destroy()
    }
    for (const pred of this.predators) {
      if (!pred.bPendingDestroy) pred.destroy()
    }
    this.foodFish = []
    this.predators = []
    this.schools = []
    this.playerRef = null
  }

  // ═══ Gizmos 调试绘制 ═══

  override OnDrawGizmos() {
    const half = this.config.arenaHalf
    const y = 0.02

    // 竞技场范围（蓝色网格线）
    gizmos.color = 0x2244aa
    for (let x = -half; x <= half; x += 2) {
      _v3.set(x, y, -half)
      _v3b.set(x, y, half)
      gizmos.DrawLine(_v3, _v3b)
    }
    for (let z = -half; z <= half; z += 2) {
      _v3.set(-half, y, z)
      _v3b.set(half, y, z)
      gizmos.DrawLine(_v3, _v3b)
    }

    if (!this.world?.running) return

    // 外框
    gizmos.color = 0x4488ff
    _v3.set(0, 0.5, 0)
    _v3b.set(half * 2, 1, half * 2)
    gizmos.DrawWireCube(_v3, _v3b)
  }
}
