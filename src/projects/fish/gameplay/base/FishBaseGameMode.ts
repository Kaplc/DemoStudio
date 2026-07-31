/**
 * FishBaseGameMode — 捕鱼达人海岛基地 GameMode
 * 显示热带海岛基地场景（沙滩、棕榈树、茅草屋等），
 * 玩家可在此选择"出海捕鱼"或查看信息。
 *
 * 房子点击/悬停由 FishHouseActor 的 ClickableComponent 自动处理，
 * 通过 PhySys 单例统一调度。
 */
import * as THREE from 'three'
import { GameMode, CameraComponent, Actor, GenericActor, MeshComponent, type World, logger } from '@/engine'
import { FishBasePlayerController } from './FishBasePlayerController'
import { FishBasePawn } from './FishBasePawn'
import { FishHouseActor } from './FishHouseActor'

export class FishBaseGameMode extends GameMode {
  readonly gameCamera: CameraComponent

  /** 基地房子 Actor */
  private houseActor: FishHouseActor | null = null
  /** 所有通过 World.SpawnActor 生成的装饰 Actor */
  private decorActors: Actor[] = []
  /** 海鸟 Actor（独立跟踪以在 Tick 中更新动画） */
  private birdActors: Actor[] = []

  /** 外部设置：点击"出海捕鱼"后的回调 */
  onStartFishing: (() => void) | null = null
  /** 外部设置：点击房子领取初始金币后的回调 */
  onClaimCoins: (() => void) | null = null

  constructor() {
    super()
    this.gameCamera = new CameraComponent(this, 'BaseCamera', 'perspective')
    this.gameCamera.fov = 35
    this.gameCamera.near = 0.1
    this.gameCamera.far = 200
    this.gameCamera.priority = 10
    this.addComponent(this.gameCamera)
  }

  override InitGame() {
    super.InitGame()
    this.gameState.setPhase('waiting')
  }

  override StartPlay() {
    this.gameState.setPhase('waiting')
  }

  override BeginPlay() {
    super.BeginPlay()
    this.spawnBaseDecor()
  }

  override EndPlay() {
    this.clearBaseDecor()
    super.EndPlay()
  }

  override Tick(dt: number) {
    super.Tick(dt)
    // 鸟群缓慢盘旋（Actor 的 root 持有基础位置，子 mesh 为动画偏移）
    for (let i = 0; i < this.birdActors.length; i++) {
      const actor = this.birdActors[i]
      const bird = actor.root.children[0] as THREE.Mesh
      const ud = bird.userData
      ud.phase += dt * ud.speed
      bird.position.x = Math.sin(ud.phase * 0.3) * 0.5
      bird.position.y = Math.sin(ud.phase * 0.7) * 0.3
      actor.root.rotation.z = Math.sin(ud.phase * 0.5) * 0.1
    }
  }

  override SpawnPlayer() {
    const controller = new FishBasePlayerController()
    const pawn = new FishBasePawn()
    return { controller, pawn }
  }

  /** 玩家点击出海 */
  startFishing() {
    this.onStartFishing?.()
  }

  /** 清除并重新生成装饰 */
  resetDecor() {
    this.clearBaseDecor()
    this.spawnBaseDecor()
  }

  /** 生成海岛装饰（炮台 + 棕榈树 + 灌木 + 鸟 + 房子） */
  private spawnBaseDecor() {
    const world = this.world
    if (!world) {
      logger.debug('[BaseGM] spawnBaseDecor: world 为空')
      return
    }

    // ─── 停泊炮台（使用 World 工厂方法构建）→ GenericActor + MeshComponent ───
    const cannonGroup = world.createGroup()

    // 底座
    const base = world.createBoxMesh(0.6, 0.15, 0.6, 0x5d4037)
    base.position.y = 0.15
    cannonGroup.add(base)

    // 炮身
    const barrel = world.createBoxMesh(0.2, 0.15, 0.6, 0x455a64)
    barrel.position.set(0, 0.35, 0.2)
    cannonGroup.add(barrel)

    // 炮管口
    const tip = world.createBoxMesh(0.25, 0.12, 0.1, 0x37474f)
    tip.position.set(0, 0.35, 0.55)
    cannonGroup.add(tip)

    // 轮子（小方块）
    const wl = world.createBoxMesh(0.1, 0.1, 0.05, 0x3e2723)
    wl.position.set(-0.3, 0.08, 0.2)
    cannonGroup.add(wl)
    const wr = world.createBoxMesh(0.1, 0.1, 0.05, 0x3e2723)
    wr.position.set(0.3, 0.08, 0.2)
    cannonGroup.add(wr)

    const cannonActor = new GenericActor('Cannon')
    for (const child of [...cannonGroup.children]) {
      if (child instanceof THREE.Mesh) {
        cannonGroup.remove(child)
        cannonActor.addComponent(new MeshComponent(cannonActor, child))
      }
    }
    cannonActor.setPosition(2.5, 0, 2.5)
    world.SpawnActor(cannonActor)
    this.decorActors.push(cannonActor)

    // ─── 棕榈树（程序化生成，补充 JSON 场景）→ GenericActor + MeshComponent ───
    const treePositions = [[-3, -5, 0.9], [4, -6, 1.1], [-5, 4, 1.0], [7, 3, 0.8], [-7, -3, 0.7], [0, -8, 1.2]]
    for (const [tx, tz, tscale] of treePositions) {
      const group = this.buildPalmTree(world, tx, tz, tscale)
      const actor = new GenericActor('PalmTree')
      for (const child of [...group.children]) {
        if (child instanceof THREE.Mesh) {
          group.remove(child)
          actor.addComponent(new MeshComponent(actor, child))
        }
      }
      actor.root.position.copy(group.position)
      world.SpawnActor(actor)
      this.decorActors.push(actor)
    }

    // ─── 沙滩灌木 → GenericActor + MeshComponent ───
    const bushPositions = [[-2.5, -2, 0.5], [3, -2.5, 0.4], [-3, 3, 0.6], [1.5, 4, 0.35], [-1, -4, 0.45]]
    for (const [bx, bz, bscale] of bushPositions) {
      const group = this.buildBush(world, bx, bz, bscale)
      const actor = new GenericActor('Bush')
      for (const child of [...group.children]) {
        if (child instanceof THREE.Mesh) {
          group.remove(child)
          actor.addComponent(new MeshComponent(actor, child))
        }
      }
      actor.root.position.copy(group.position)
      world.SpawnActor(actor)
      this.decorActors.push(actor)
    }

    // ─── 海鸟在天空盘旋 → GenericActor + MeshComponent ───
    for (let i = 0; i < 5; i++) {
      const bird = world.createPlaneMesh(0.3, 0.1, 0x37474f, true, 0.5, THREE.DoubleSide)
      const angle = (i / 5) * Math.PI * 2
      const radius = 8 + Math.random() * 4
      const baseX = Math.cos(angle) * radius
      const baseY = 4 + Math.random() * 2
      bird.userData = {
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 0.3,
      }
      const birdActor = new GenericActor('Bird')
      birdActor.addComponent(new MeshComponent(birdActor, bird))
      birdActor.root.position.set(baseX, baseY, Math.sin(angle) * radius)
      birdActor.root.rotation.x = 0.2
      world.SpawnActor(birdActor)
      this.birdActors.push(birdActor)
    }

    // ─── 房子 Actor → 从 Blueprint 实例化（beach_house，行为类 blueprint 范例）───
    const house = world.SpawnActorFromBlueprint('asset/blueprints/beach_house.blueprint.json')
    if (house) {
      this.houseActor = house as FishHouseActor
    } else {
      // 回退：blueprint / baseClass 未注册时直接构造，保证功能可用
      this.houseActor = new FishHouseActor('BeachHouse')
      world.SpawnActor(this.houseActor)
    }
    this.houseActor.onClaimCoins = () => this.onClaimCoins?.()
    logger.debug('[BaseGM] 海岛小屋 Actor 已生成（blueprint: beach_house）')
  }

  /** 构建一棵程序化棕榈树，返回已定位的 Group */
  private buildPalmTree(world: World, x: number, z: number, scale: number): THREE.Group {
    const group = world.createGroup()

    // 树干
    const trunk = world.createBoxMesh(0.12 * scale, 1.5 * scale, 0.12 * scale, 0x6d4c41)
    trunk.position.y = 0.75 * scale
    trunk.rotation.z = (Math.random() - 0.5) * 0.15
    trunk.rotation.x = (Math.random() - 0.5) * 0.15
    group.add(trunk)

    // 树冠（多层球体）
    const crown1 = world.createSphereMesh(0.6 * scale, 0x2e7d32, 6)
    crown1.position.set(0, 1.6 * scale, 0)
    group.add(crown1)

    const crown2 = world.createSphereMesh(0.5 * scale, 0x388e3c, 6)
    crown2.position.set(0.3 * scale, 1.8 * scale, 0.2 * scale)
    group.add(crown2)

    const crown3 = world.createSphereMesh(0.45 * scale, 0x388e3c, 6)
    crown3.position.set(-0.25 * scale, 1.9 * scale, -0.2 * scale)
    group.add(crown3)

    const crown4 = world.createSphereMesh(0.4 * scale, 0x2e7d32, 6)
    crown4.position.set(0.1 * scale, 2.0 * scale, -0.3 * scale)
    group.add(crown4)

    group.position.set(x, 0, z)
    return group
  }

  /** 构建一株灌木，返回已定位的 Group */
  private buildBush(world: World, x: number, z: number, scale: number): THREE.Group {
    const group = world.createGroup()

    const b1 = world.createSphereMesh(0.3 * scale, 0x43a047, 5)
    b1.position.set(0, 0.15 * scale, 0)
    group.add(b1)

    const b2 = world.createSphereMesh(0.25 * scale, 0x66bb6a, 5)
    b2.position.set(0.2 * scale, 0.1 * scale, 0.1 * scale)
    group.add(b2)

    const b3 = world.createSphereMesh(0.2 * scale, 0x66bb6a, 5)
    b3.position.set(-0.15 * scale, 0.08 * scale, -0.1 * scale)
    group.add(b3)

    group.position.set(x, 0, z)
    return group
  }

  private clearBaseDecor() {
    // 所有装饰 Actor（炮台/棕榈树/灌木/海鸟/房子）已由 World.DestroyAllActors()
    // 自动调用 EndPlay() 释放 geometry/material 并从场景移除，此处仅清空引用
    this.houseActor = null
    this.decorActors = []
    this.birdActors = []
  }
}
