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
import { GameMode, PhySys, logger, MeshComponent } from '@/engine'
import { BaseCameraActor } from './BaseCameraActor'
import { FishBasePlayerController } from './FishBasePlayerController'
import { FishBasePawn } from './FishBasePawn'
import { ClashBuildingActor, CLASH_BUILDING_TYPES, type ClashBuildingType } from './ClashBuildingActor'
import { ClashBaseBuilder, PLACE_HALF } from './ClashBaseBuilder'

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

  /** 基地地图构建器（专门负责创建地面/草地/初始建筑布局，BeginPlay 创建，EndPlay 回收） */
  private baseBuilder: ClashBaseBuilder | null = null
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
    // 基地地图由专门的构建类创建（地面/草地/初始建筑布局），放置回调走本 GameMode 的 placeBuilding
    this.baseBuilder = new ClashBaseBuilder(this.world!)
    this.baseBuilder.build((id, gx, gz) => this.placeBuilding(id, gx, gz))
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
    // 滚轮缩放 + 右键平移：把 controller 的输入组件绑定到基地摄像机云台
    this.baseCamera.rig.bindInput(controller.inputComponent)
    // 相机平移边界与放置范围一致（±24，覆盖整个 48x48 地面）
    this.baseCamera.rig.panLimit = PLACE_HALF
    logger.info(`[BaseGM] SpawnPlayer: controller=${controller.name}`)
    return { controller, pawn }
  }

  /** 玩家点击出海 */
  startFishing() {
    this.onStartFishing?.()
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
    if (Math.abs(gx) > PLACE_HALF || Math.abs(gz) > PLACE_HALF) return false
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
    if (Math.abs(gx) > PLACE_HALF || Math.abs(gz) > PLACE_HALF) return

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
    if (Math.abs(gx) > PLACE_HALF || Math.abs(gz) > PLACE_HALF) {
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
    const decor = this.baseBuilder?.decor
    if (!w || !decor) return
    this.hidePreview()
    const mesh = w.createBoxMesh(type.size, type.height, type.size, type.color, true, 0.5)
    mesh.visible = false
    // 替换装饰 Actor 上的预览组件（旧组件移除时自动释放旧 mesh 资源）
    if (this.previewComp) decor.removeComponent(this.previewComp)
    this.previewComp = new MeshComponent(decor, mesh, 'PreviewMesh')
    decor.addComponent(this.previewComp)
    this.previewMesh = mesh
  }

  private hidePreview() {
    if (this.previewMesh) {
      this.previewMesh.visible = false
    }
  }

  /** 移动建筑：先移除旧占用，再放置到新格子 */
  private placeBuildingAt(b: ClashBuildingActor, gx: number, gz: number): boolean {
    if (Math.abs(gx) > PLACE_HALF || Math.abs(gz) > PLACE_HALF) return false
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
    // 地图构建器 EndPlay：注销对象注册表；装饰 Actor 由 World.DestroyAllActors 统一销毁
    this.baseBuilder?.EndPlay()
    this.baseBuilder = null
    this.previewComp = null
    this.previewMesh = null
    this.clashBuildings = []
    this.gridOccupied.clear()
    this.selectedType = null
    this.selectedBuilding = null
  }
}
