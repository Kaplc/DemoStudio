/**
 * FishBaseGameMode — 捕鱼达人海岛基地 GameMode（部落冲突风格基地）
 * 显示热带海岛基地场景（沙滩、棕榈树、茅草屋等），
 * 中央有一块部落冲突风格的方格草地地图，可放置不同颜色的立方体建筑。
 *
 * 玩法：
 *  - 底部一排彩色建筑按钮（菜单），点击选择要放置的建筑类型
 *  - 点击草地网格 → 放置建筑（不同颜色立方体，吸附网格）
 *  - 点击已放置建筑 → 选中（金色线框高亮），点击其他格子可移动
 *  - 菜单末尾红色"删除"按钮 → 删除选中的建筑
 *
 * 房子点击/悬停由 FishHouseActor 的 ClickableComponent 自动处理，
 * 通过 PhySys 单例统一调度。
 */
import * as THREE from 'three'
import { GameMode, CameraComponent, CameraZoomComponent, Actor, GenericActor, MeshComponent, PhySys, type World, logger } from '@/engine'
import { FishBasePlayerController } from './FishBasePlayerController'
import { FishBasePawn } from './FishBasePawn'
import { FishHouseActor } from './FishHouseActor'
import { ClashBuildingActor, CLASH_BUILDING_TYPES, type ClashBuildingType } from './ClashBuildingActor'

/** 部落冲突地图半边长（格数），地图为 GRID_HALF*2 x GRID_HALF*2 格，每格 1 单位 */
const GRID_HALF = 5

/** 地面平面（y=0），用于屏幕坐标 → 世界坐标求交 */
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

export class FishBaseGameMode extends GameMode {
  readonly gameCamera: CameraComponent
  /** 基地相机滚轮缩放组件（与 gameCamera 同挂本 Actor） */
  readonly cameraZoom: CameraZoomComponent

  /** 基地房子 Actor */
  private houseActor: FishHouseActor | null = null
  /** 所有通过 World.SpawnActor 生成的装饰 Actor */
  private decorActors: Actor[] = []
  /** 海鸟 Actor（独立跟踪以在 Tick 中更新动画） */
  private birdActors: Actor[] = []

  // ═══════════════════════════════════
  //  部落冲突建造系统状态
  // ═══════════════════════════════════

  /** HUD 蓝图：部落冲突建筑菜单 UI（由 World.SwitchScene 统一创建） */
  override HUDClass = 'asset/blueprints/ui/base_hud.widget.json'

  /** 垫底地面（直接挂 scene，非 Actor） */
  private baseGround: THREE.Mesh | null = null
  /** 草地网格（直接挂 scene，非 Actor） */
  private clashGrass: THREE.Mesh | null = null
  /** 网格线（直接挂 scene，非 Actor） */
  private gridLines: THREE.LineSegments | null = null
  /** 已放置的建筑 */
  private clashBuildings: ClashBuildingActor[] = []
  /** 网格占用表：`${gx},${gz}` → 建筑 */
  private gridOccupied = new Map<string, ClashBuildingActor>()
  /** 当前选择的建筑类型（null = 未进入放置模式） */
  private selectedType: ClashBuildingType | null = null
  /** 当前选中的已放置建筑 */
  private selectedBuilding: ClashBuildingActor | null = null
  /** 放置模式跟随鼠标的半透明预览 */
  private previewMesh: THREE.Mesh | null = null


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
    // 滚轮缩放：绕基地中心（原点）拉近/拉远，由 FishBasePlayerController.OnScroll 驱动
    this.cameraZoom = new CameraZoomComponent(this, 'BaseCameraZoom')
    this.cameraZoom.target.set(0, 0, 0)
    this.addComponent(this.cameraZoom)
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
    this.spawnClashBase()
  }

  override EndPlay() {
    this.clearClashBase()
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
    controller.gameMode = this
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
    cannonActor.setPosition(-8, 0, 6)
    world.SpawnActor(cannonActor)
    this.decorActors.push(cannonActor)

    // ─── 棕榈树（程序化生成，补充 JSON 场景）→ GenericActor + MeshComponent ───
    const treePositions = [[-9, -8, 0.9], [9, -8, 1.1], [-9, 8, 1.0], [9, 8, 0.8], [-11, 0, 0.7], [0, -11, 1.2]]
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
    const bushPositions = [[-9, -4, 0.5], [9, -4, 0.4], [-9, 4, 0.6], [9, 4, 0.35], [-6, -9, 0.45]]
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
    // 房子挪到沙滩角落，避免挡住中央部落冲突地图
    this.houseActor.setPosition(8, 0, 8)
    this.houseActor.onClaimCoins = () => this.onClaimCoins?.()
    logger.debug('[BaseGM] 海岛小屋 Actor 已生成（blueprint: beach_house）')
  }

  // ════════════════════════════════════════════
  //  部落冲突建造系统
  // ════════════════════════════════════════════

  /** 生成部落冲突地图：草地 + 网格线 + 底部建筑菜单 + 初始建筑 */
  private spawnClashBase() {
    const world = this.world
    if (!world) {
      logger.debug('[BaseGM] spawnClashBase: world 为空')
      return
    }

    // ─── 垫底地面（场景资产已清空，提供整体地面承接装饰）───
    const ground = world.createPlaneMesh(48, 48, 0x2e7d32)
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.05
    world.scene.add(ground)
    this.baseGround = ground

    // ─── 草地（部落冲突风格：方形草地地图，中央区域）───
    const grass = world.createPlaneMesh(11, 11, 0x7cb342)
    grass.rotation.x = -Math.PI / 2
    grass.position.y = -0.02
    world.scene.add(grass)
    this.clashGrass = grass

    // ─── 网格线（11x11 格子，每格 1 单位）───
    const linePoints: THREE.Vector3[] = []
    const half = GRID_HALF + 0.5
    for (let i = -half; i <= half; i++) {
      linePoints.push(new THREE.Vector3(i, 0, -half), new THREE.Vector3(i, 0, half))
      linePoints.push(new THREE.Vector3(-half, 0, i), new THREE.Vector3(half, 0, i))
    }
    const lineGeo = new THREE.BufferGeometry().setFromPoints(linePoints)
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 })
    this.gridLines = new THREE.LineSegments(lineGeo, lineMat)
    this.gridLines.position.y = -0.015
    world.scene.add(this.gridLines)

    // ─── 初始建筑（部落冲突开局布局）───
    this.placeBuilding('townhall', 0, 0)
    this.placeBuilding('barracks', -3, 2)
    this.placeBuilding('goldmine', 3, -2)
    this.placeBuilding('elixir', -3, -3)
    this.placeBuilding('cannon', 3, 3)
    this.placeBuilding('wall', 2, 1)
    this.placeBuilding('wall', 1, 2)
    this.placeBuilding('wall', 0, 2)

    logger.info(`[BaseGM] 部落冲突基地已生成（地图 ${GRID_HALF * 2 + 1}x${GRID_HALF * 2 + 1} 格）`)
  }

  // ════════════════════════════════════════════
  //  HUD 按钮驱动（由 FishGameInstance 绑定 UIButtonComponent.onClick）
  // ════════════════════════════════════════════

  /**
   * HUD 建筑按钮点击：选择要放置的建筑类型（再次点击同类型取消）。
   * @param typeId 建筑类型 id（townhall/barracks/goldmine/elixir/cannon/wall）
   */
  selectBuildingType(typeId: string) {
    // 退出移动模式
    this.deselectBuilding()
    // 切换选择：再次点击同类型取消
    if (this.selectedType?.id === typeId) {
      this.selectedType = null
      this.hidePreview()
      logger.info('[BaseGM] 取消放置模式')
      return
    }
    this.selectedType = CLASH_BUILDING_TYPES.find((t) => t.id === typeId) ?? null
    if (this.selectedType) {
      this.showPreview(this.selectedType)
      logger.info(`[BaseGM] 选择放置: ${this.selectedType.name}`)
    } else {
      logger.warn(`[BaseGM] 未知建筑类型: ${typeId}`)
    }
  }

  /** HUD 删除按钮点击：删除当前选中的建筑 */
  deleteSelectedBuilding() {
    if (!this.selectedBuilding) {
      logger.info('[BaseGM] 未选中建筑，无法删除')
      return
    }
    const b = this.selectedBuilding
    this.gridOccupied.delete(`${b.gridX},${b.gridZ}`)
    this.clashBuildings = this.clashBuildings.filter((x) => x !== b)
    b.destroy()
    this.selectedBuilding = null
    logger.info('[BaseGM] 已删除选中建筑')
  }

  /**
   * 放置建筑（网格吸附，格子坐标 = 世界坐标整数）。
   * @returns 是否放置成功
   */
  private placeBuilding(typeId: string, gx: number, gz: number): boolean {
    const world = this.world
    const type = CLASH_BUILDING_TYPES.find((t) => t.id === typeId)
    if (!world || !type) return false
    if (Math.abs(gx) > GRID_HALF || Math.abs(gz) > GRID_HALF) return false
    const key = `${gx},${gz}`
    if (this.gridOccupied.has(key)) return false

    const building = new ClashBuildingActor(`Building_${type.id}`, type, gx, gz)
    building.setPosition(gx, 0, gz)
    building.onSelect = (b) => this.onBuildingClick(b)
    world.SpawnActor(building)
    this.clashBuildings.push(building)
    this.gridOccupied.set(key, building)
    logger.info(`[BaseGM] 放置建筑: ${type.name} @ (${gx}, ${gz})`)
    return true
  }

  /** 点击已放置建筑：选中（高亮）/ 取消选中 */
  private onBuildingClick(b: ClashBuildingActor) {
    if (this.selectedBuilding === b) {
      this.deselectBuilding()
    } else {
      this.selectedBuilding?.setSelected(false)
      this.selectedBuilding = b
      b.setSelected(true)
      // 退出放置模式，进入移动模式：点击地面移动建筑
      this.selectedType = null
      this.hidePreview()
    }
  }

  private deselectBuilding() {
    this.selectedBuilding?.setSelected(false)
    this.selectedBuilding = null
  }

  // ════════════════════════════════════════════
  //  鼠标交互（由 FishBasePlayerController 转发）
  // ════════════════════════════════════════════

  /** 鼠标按下：放置建筑 / 移动选中建筑 */
  onScreenDown(sx: number, sy: number) {
    const ground = this.screenToGround(sx, sy)
    if (!ground) return

    // 吸附到网格
    const gx = Math.round(ground.x)
    const gz = Math.round(ground.z)
    if (Math.abs(gx) > GRID_HALF || Math.abs(gz) > GRID_HALF) return

    // 选中建筑 + 点击地面 → 移动建筑
    if (this.selectedBuilding) {
      if (this.placeBuildingAt(this.selectedBuilding, gx, gz)) {
        logger.info(`[BaseGM] 移动建筑 → (${gx}, ${gz})`)
      }
      return
    }

    // 放置模式：放置当前选中的类型
    if (this.selectedType) {
      this.placeBuilding(this.selectedType.id, gx, gz)
    }
  }

  /** 鼠标移动：放置模式下更新半透明预览位置 */
  onScreenMove(sx: number, sy: number) {
    if (!this.selectedType || !this.previewMesh) return
    const ground = this.screenToGround(sx, sy)
    if (!ground) {
      this.hidePreview()
      return
    }
    const gx = Math.round(ground.x)
    const gz = Math.round(ground.z)
    if (Math.abs(gx) > GRID_HALF || Math.abs(gz) > GRID_HALF) {
      this.hidePreview()
      return
    }
    const type = this.selectedType
    this.previewMesh.visible = true
    this.previewMesh.position.set(gx, 0.15 + type.height / 2, gz)
  }

  /** 屏幕坐标 → 地面交点（y=0 平面），用于网格放置 */
  private screenToGround(sx: number, sy: number): THREE.Vector3 | null {
    const raycaster = PhySys.screenToRay(sx, sy)
    if (!raycaster) return null
    const hit = new THREE.Vector3()
    raycaster.ray.intersectPlane(_groundPlane, hit)
    return hit
  }

  /** 显示放置预览方块 */
  private showPreview(type: ClashBuildingType) {
    const w = this.world
    if (!w) return
    this.hidePreview()
    this.previewMesh = w.createBoxMesh(type.size, type.height, type.size, type.color, true, 0.5)
    this.previewMesh.visible = false
    w.scene.add(this.previewMesh)
  }

  private hidePreview() {
    if (this.previewMesh) {
      this.previewMesh.visible = false
    }
  }

  /** 移动建筑：先移除旧占用，再放置到新格子 */
  private placeBuildingAt(b: ClashBuildingActor, gx: number, gz: number): boolean {
    if (Math.abs(gx) > GRID_HALF || Math.abs(gz) > GRID_HALF) return false
    const key = `${gx},${gz}`
    const other = this.gridOccupied.get(key)
    if (other && other !== b) return false

    // 释放旧格子
    this.gridOccupied.delete(`${b.gridX},${b.gridZ}`)
    b.gridX = gx
    b.gridZ = gz
    b.setPosition(gx, 0, gz)
    this.gridOccupied.set(key, b)
    return true
  }

  /** 清理部落冲突建造系统资源 */
  private clearClashBase() {
    if (this.baseGround) {
      this.world?.scene.remove(this.baseGround)
      this.baseGround.geometry.dispose()
      ;(this.baseGround.material as THREE.Material).dispose()
      this.baseGround = null
    }
    if (this.clashGrass) {
      this.world?.scene.remove(this.clashGrass)
      this.clashGrass.geometry.dispose()
      ;(this.clashGrass.material as THREE.Material).dispose()
      this.clashGrass = null
    }
    if (this.gridLines) {
      this.world?.scene.remove(this.gridLines)
      this.gridLines.geometry.dispose()
      ;(this.gridLines.material as THREE.Material).dispose()
      this.gridLines = null
    }
    this.hidePreview()
    if (this.previewMesh) {
      this.world?.scene.remove(this.previewMesh)
      this.previewMesh.geometry.dispose()
      ;(this.previewMesh.material as THREE.Material).dispose()
      this.previewMesh = null
    }
    this.clashBuildings = []
    this.gridOccupied.clear()
    this.selectedType = null
    this.selectedBuilding = null
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
