/**
 * FishBaseGameMode — 捕鱼达人海岛基地 GameMode
 * 显示热带海岛基地场景（沙滩、棕榈树、茅草屋等），
 * 玩家可在此选择"出海捕鱼"或查看信息。
 *
 * 房子点击/悬停由 FishHouseActor 的 ClickableComponent 自动处理，
 * 通过 PhySys 单例统一调度。
 */
import * as THREE from 'three'
import { GameMode, CameraComponent, logger } from '@/engine'
import { FishBasePlayerController } from './FishBasePlayerController'
import { FishBasePawn } from './FishBasePawn'
import { FishHouseActor } from './FishHouseActor'

export class FishBaseGameMode extends GameMode {
  readonly gameCamera: CameraComponent

  /** 停泊炮台 */
  private dockedCannon: THREE.Group | null = null
  /** 装饰鸟群 */
  private decorBirds: THREE.Mesh[] = []
  /** 基地房子 Actor */
  private houseActor: FishHouseActor | null = null
  /** 程序化生成的棕榈树 groups */
  private palmTrees: THREE.Group[] = []

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
    // 鸟群缓慢盘旋
    for (let i = 0; i < this.decorBirds.length; i++) {
      const bird = this.decorBirds[i]
      const phase = bird.userData.phase + dt * bird.userData.speed
      bird.userData.phase = phase
      const baseX = bird.userData.baseX
      const baseY = bird.userData.baseY
      bird.position.x = baseX + Math.sin(phase * 0.3) * 0.5
      bird.position.y = baseY + Math.sin(phase * 0.7) * 0.3
      bird.rotation.z = Math.sin(phase * 0.5) * 0.1
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
    const scene = world.scene

    // ─── 停泊炮台（3D 方块搭建） ───
    const cannonGroup = new THREE.Group()

    // 底座
    const baseMat = new THREE.MeshBasicMaterial({ color: 0x5d4037 })
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.15, 0.6), baseMat)
    base.position.y = 0.15
    cannonGroup.add(base)

    // 炮身（圆柱用 box 近似）
    const barrelMat = new THREE.MeshBasicMaterial({ color: 0x455a64 })
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.15, 0.6), barrelMat)
    barrel.position.set(0, 0.35, 0.2)
    cannonGroup.add(barrel)

    // 炮管口
    const tipMat = new THREE.MeshBasicMaterial({ color: 0x37474f })
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, 0.1), tipMat)
    tip.position.set(0, 0.35, 0.55)
    cannonGroup.add(tip)

    // 轮子（小方块）
    const wheelMat = new THREE.MeshBasicMaterial({ color: 0x3e2723 })
    const wl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.05), wheelMat)
    wl.position.set(-0.3, 0.08, 0.2)
    cannonGroup.add(wl)
    const wr = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.05), wheelMat)
    wr.position.set(0.3, 0.08, 0.2)
    cannonGroup.add(wr)

    cannonGroup.position.set(2.5, 0, 2.5)
    scene.add(cannonGroup)

    // ─── 棕榈树（程序化生成，补充 JSON 场景） ───
    this.spawnPalmTree(scene, -3, 0, -5, 0.9)
    this.spawnPalmTree(scene, 4, 0, -6, 1.1)
    this.spawnPalmTree(scene, -5, 0, 4, 1.0)
    this.spawnPalmTree(scene, 7, 0, 3, 0.8)
    this.spawnPalmTree(scene, -7, 0, -3, 0.7)
    this.spawnPalmTree(scene, 0, 0, -8, 1.2)

    // ─── 沙滩灌木 ───
    this.spawnBush(scene, -2.5, 0, -2, 0.5)
    this.spawnBush(scene, 3, 0, -2.5, 0.4)
    this.spawnBush(scene, -3, 0, 3, 0.6)
    this.spawnBush(scene, 1.5, 0, 4, 0.35)
    this.spawnBush(scene, -1, 0, -4, 0.45)

    // ─── 海鸟在天空盘旋 ───
    for (let i = 0; i < 5; i++) {
      const birdGeo = new THREE.PlaneGeometry(0.3, 0.1)
      const birdMat = new THREE.MeshBasicMaterial({
        color: 0x37474f,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const bird = new THREE.Mesh(birdGeo, birdMat)
      const angle = (i / 5) * Math.PI * 2
      const radius = 8 + Math.random() * 4
      const baseX = Math.cos(angle) * radius
      const baseY = 4 + Math.random() * 2
      bird.position.set(baseX, baseY, Math.sin(angle) * radius)
      bird.rotation.x = 0.2
      bird.userData = {
        baseX,
        baseY,
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 0.3,
      }
      scene.add(bird)
      this.decorBirds.push(bird)
    }

    // ─── 房子 Actor ───
    this.houseActor = new FishHouseActor('BeachHouse')
    this.houseActor.onClaimCoins = () => this.onClaimCoins?.()
    this.houseActor.world = world
    world.scene.add(this.houseActor.root)
    this.houseActor.BeginPlay()
    logger.debug('[BaseGM] 海岛小屋 Actor 已生成')
  }

  /** 生成一棵程序化棕榈树 */
  private spawnPalmTree(scene: THREE.Scene, x: number, _y: number, z: number, scale: number) {
    const group = new THREE.Group()

    // 树干
    const trunkMat = new THREE.MeshBasicMaterial({ color: 0x6d4c41 })
    const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.12 * scale, 1.5 * scale, 0.12 * scale), trunkMat)
    trunk.position.y = 0.75 * scale
    trunk.rotation.z = (Math.random() - 0.5) * 0.15
    trunk.rotation.x = (Math.random() - 0.5) * 0.15
    group.add(trunk)

    // 树冠（多层球体）
    const leafMat = new THREE.MeshBasicMaterial({ color: 0x2e7d32 })
    const crown1 = new THREE.Mesh(new THREE.SphereGeometry(0.6 * scale, 6, 6), leafMat)
    crown1.position.set(0, 1.6 * scale, 0)
    group.add(crown1)

    const leafMat2 = new THREE.MeshBasicMaterial({ color: 0x388e3c })
    const crown2 = new THREE.Mesh(new THREE.SphereGeometry(0.5 * scale, 6, 6), leafMat2)
    crown2.position.set(0.3 * scale, 1.8 * scale, 0.2 * scale)
    group.add(crown2)

    const crown3 = new THREE.Mesh(new THREE.SphereGeometry(0.45 * scale, 6, 6), leafMat2)
    crown3.position.set(-0.25 * scale, 1.9 * scale, -0.2 * scale)
    group.add(crown3)

    const crown4 = new THREE.Mesh(new THREE.SphereGeometry(0.4 * scale, 6, 6), leafMat)
    crown4.position.set(0.1 * scale, 2.0 * scale, -0.3 * scale)
    group.add(crown4)

    group.position.set(x, 0, z)
    scene.add(group)
    this.palmTrees.push(group)
  }

  /** 生成一株灌木 */
  private spawnBush(scene: THREE.Scene, x: number, _y: number, z: number, scale: number) {
    const group = new THREE.Group()

    const mat1 = new THREE.MeshBasicMaterial({ color: 0x43a047 })
    const b1 = new THREE.Mesh(new THREE.SphereGeometry(0.3 * scale, 5, 5), mat1)
    b1.position.set(0, 0.15 * scale, 0)
    group.add(b1)

    const mat2 = new THREE.MeshBasicMaterial({ color: 0x66bb6a })
    const b2 = new THREE.Mesh(new THREE.SphereGeometry(0.25 * scale, 5, 5), mat2)
    b2.position.set(0.2 * scale, 0.1 * scale, 0.1 * scale)
    group.add(b2)

    const b3 = new THREE.Mesh(new THREE.SphereGeometry(0.2 * scale, 5, 5), mat2)
    b3.position.set(-0.15 * scale, 0.08 * scale, -0.1 * scale)
    group.add(b3)

    group.position.set(x, 0, z)
    scene.add(group)
  }

  private clearBaseDecor() {
    const scene = this.world?.scene
    if (!scene) return

    if (this.dockedCannon) {
      scene.remove(this.dockedCannon)
      this.dockedCannon.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose()
          ;(node.material as THREE.MeshBasicMaterial).dispose()
        }
      })
      this.dockedCannon = null
    }

    // 销毁房子 Actor
    if (this.houseActor) {
      this.houseActor.EndPlay()
      scene.remove(this.houseActor.root)
      this.houseActor = null
    }

    // 清除鸟群
    for (const b of this.decorBirds) {
      scene.remove(b)
      b.geometry.dispose()
      ;(b.material as THREE.MeshBasicMaterial).dispose()
    }
    this.decorBirds = []

    // 清除棕榈树
    for (const g of this.palmTrees) {
      scene.remove(g)
      g.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose()
          ;(node.material as THREE.MeshBasicMaterial).dispose()
        }
      })
    }
    this.palmTrees = []
  }
}
