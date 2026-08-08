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
 */
import * as THREE from 'three'
import { GameMode, PhySys, logger, GenericActor, MeshComponent, LineComponent } from '@/engine'
import { BaseCameraActor } from './BaseCameraActor'
import { FishBasePlayerController } from './FishBasePlayerController'
import { FishBasePawn } from './FishBasePawn'
import { ClashBuildingActor, CLASH_BUILDING_TYPES, type ClashBuildingType } from './ClashBuildingActor'

/** 部落冲突地图半边长（格数），地图为 GRID_HALF*2 x GRID_HALF*2 格，每格 1 单位 */
const GRID_HALF = 5

/** 地面平面（y=0），用于屏幕坐标 → 世界坐标求交 */
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

export class FishBaseGameMode extends GameMode {
  /** 基地摄像机 Actor（继承 CameraActor，内置滚轮缩放；游戏实例持有，渲染器通过委托获取） */
  readonly baseCamera: BaseCameraActor

  // ═══════════════════════════════════
  //  部落冲突建造系统状态
  // ═══════════════════════════════════

  /** HUD 蓝图：部落冲突建筑菜单 UI（由 World.SwitchScene 统一创建） */
  override HUDClass = 'asset/blueprints/ui/base_hud.widget.json'

  /** 装饰根 Actor（地面/草地/网格线/预览块统一挂载，经 World 托管生命周期） */
  private clashDecor: GenericActor | null = null
  /** 垫底地面（挂 clashDecor，MeshComponent 托管） */
  private baseGround: THREE.Mesh | null = null
  /** 草地网格（挂 clashDecor，MeshComponent 托管） */
  private clashGrass: THREE.Mesh | null = null
  /** 网格线（挂 clashDecor，LineComponent 托管） */
  private gridLines: THREE.LineSegments | null = null
  /** 已放置的建筑 */
  private clashBuildings: ClashBuildingActor[] = []
  /** 网格占用表：`${gx},${gz}` → 建筑 */
  private gridOccupied = new Map<string, ClashBuildingActor>()
  /** 当前选择的建筑类型（null = 未进入放置模式） */
  private selectedType: ClashBuildingType | null = null
  /** 当前选中的已放置建筑 */
  private selectedBuilding: ClashBuildingActor | null = null
  /** 放置模式跟随鼠标的半透明预览（MeshComponent 托管，showPreview 时替换） */
  private previewComp: MeshComponent | null = null
  private previewMesh: THREE.Mesh | null = null


  /** 外部设置：点击"出海捕鱼"后的回调 */
  onStartFishing: (() => void) | null = null
  /** 外部设置：点击房子领取初始金币后的回调 */
  onClaimCoins: (() => void) | null = null

  constructor() {
    super()
    this.baseCamera = new BaseCameraActor()
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
    this.spawnClashBase()
  }

  override EndPlay() {
    this.clearClashBase()
    super.EndPlay()
  }

  override Tick(dt: number) {
    super.Tick(dt)
    // baseCamera 已由 World 托管（SpawnActor），其 Tick（云台边缘平移检测）由 World 自动驱动
  }

  /** 记录最近鼠标屏幕坐标（转发给基地摄像机云台组件做屏幕边缘平移） */
  setMouseScreen(sx: number, sy: number): void {
    this.baseCamera.rig.setMouseScreen(sx, sy)
  }

  override spawnPlayerInternal() {
    const controller = new FishBasePlayerController()
    controller.gameMode = this
    const pawn = new FishBasePawn()
    // 滚轮缩放：把 controller 的输入组件绑定到基地摄像机云台（订阅滚轮事件）
    this.baseCamera.rig.bindInput(controller.inputComponent)
    logger.info(`[BaseGM] SpawnPlayer: controller=${controller.name}`)
    return { controller, pawn }
  }

  /** 玩家点击出海 */
  startFishing() {
    this.onStartFishing?.()
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

    // ─── 装饰根 Actor：地面/草地/网格线统一挂载，经 World 托管生命周期 ───
    // （DestroyAllActors/Destroy 时组件 EndPlay 自动释放 geometry/material）
    const decor = new GenericActor('ClashDecor')

    // ─── 垫底地面（场景资产已清空，提供整体地面承接装饰）───
    const ground = world.createPlaneMesh(48, 48, 0x2e7d32)
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.05
    decor.addComponent(new MeshComponent(decor, ground, 'GroundMesh'))
    this.baseGround = ground

    // ─── 草地（部落冲突风格：方形草地地图，中央区域）───
    const grass = world.createPlaneMesh(11, 11, 0x7cb342)
    grass.rotation.x = -Math.PI / 2
    grass.position.y = -0.02
    decor.addComponent(new MeshComponent(decor, grass, 'GrassMesh'))
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
    const gridLines = new THREE.LineSegments(lineGeo, lineMat)
    gridLines.position.y = -0.015
    decor.addComponent(new LineComponent(decor, gridLines, 'GridLines'))
    this.gridLines = gridLines

    // 装饰 Actor 进 World 统一管理
    this.clashDecor = decor
    world.SpawnActor(decor)

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
    const mesh = w.createBoxMesh(type.size, type.height, type.size, type.color, true, 0.5)
    mesh.visible = false
    // 替换装饰 Actor 上的预览组件（旧组件移除时自动释放旧 mesh 资源）
    if (this.clashDecor) {
      if (this.previewComp) this.clashDecor.removeComponent(this.previewComp)
      this.previewComp = new MeshComponent(this.clashDecor, mesh, 'PreviewMesh')
      this.clashDecor.addComponent(this.previewComp)
    }
    this.previewMesh = mesh
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
    // 装饰根 Actor（地面/草地/网格线/预览块）由 World.DestroyAllActors 统一销毁，
    // 组件 EndPlay 自动释放 geometry/material（不再手动 scene.remove）
    this.clashDecor = null
    this.previewComp = null
    this.baseGround = null
    this.clashGrass = null
    this.gridLines = null
    this.previewMesh = null
    this.clashBuildings = []
    this.gridOccupied.clear()
    this.selectedType = null
    this.selectedBuilding = null
  }
}
