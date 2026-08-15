/**
 * FishBaseGameMode — ClashMaster 村庄基地 GameMode（部落冲突风格基地）
 * 显示热带海岛基地场景（沙滩、棕榈树、茅草屋等），
 * 中央有一块部落冲突风格的方格草地地图，可放置不同颜色的立方体建筑。
 *
 * 玩法：
 *  - HUD 底部"地图"按钮进入建筑模式 → 打开建筑菜单（独立 widget，默认隐藏）
 *  - 建筑菜单点击选择要放置的建筑类型（不同颜色立方体，吸附网格）
 *  - 点击已放置建筑 → 选中（金色线框高亮），点击其他格子可移动
 *  - 菜单末尾红色"删除"按钮 → 删除选中的建筑
 */
import * as THREE from 'three'
import { GameMode, PhySys, logger, MeshComponent, type Actor } from '@/engine'
import { BaseCameraActor } from './BaseCameraActor'
import { FishBasePlayerController } from './FishBasePlayerController'
import { FishBasePawn } from './FishBasePawn'
import { CLASH_BUILDING_TYPES, type ClashBuildingType } from './ClashBuildingTypes'
import { ClashBuildingBaseActor, BarracksActor } from './ClashBuildingActors'
import { ClashBaseBuilder, PLACE_HALF } from './ClashBaseBuilder'
import { PlaceGridActor } from './PlaceGridActor'

/** 地面平面（y=0），用于屏幕坐标 → 世界坐标求交 */
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

export class FishBaseGameMode extends GameMode {
  /** 基地摄像机 Actor（继承 CameraActor，内置滚轮缩放；游戏实例持有，渲染器通过委托获取） */
  readonly baseCamera: BaseCameraActor

  // ═══════════════════════════════════
  //  部落冲突建造系统状态
  // ═══════════════════════════════════

  /** HUD 蓝图：基地主 HUD（顶部资源栏 + 地图按钮；建筑菜单是独立 widget，建筑模式才显示） */
  override HUDClass = 'asset/blueprints/ui/base_hud.widget.json'

  /** 基地地图构建器（专门负责创建地面/草地/初始建筑布局，BeginPlay 创建，EndPlay 回收） */
  private baseBuilder: ClashBaseBuilder | null = null
  /** 已放置的建筑（每个建筑一个 Actor 类实例） */
  private clashBuildings: ClashBuildingBaseActor[] = []
  /** 网格占用表：`${gx},${gz}` → 建筑 */
  private gridOccupied = new Map<string, ClashBuildingBaseActor>()
  /** 当前选择的建筑类型（null = 未进入放置模式） */
  private selectedType: ClashBuildingType | null = null
  /** 当前选中的已放置建筑 */
  private selectedBuilding: ClashBuildingBaseActor | null = null
  /** 放置模式跟随鼠标的半透明预览（MeshComponent 托管，showPreview 时替换） */
  private previewComp: MeshComponent | null = null
  private previewMesh: THREE.Mesh | null = null
  /** 放置示意网格 Actor（PlaceGridActor，默认隐藏，进入放置模式显示） */
  private placeGridActor: PlaceGridActor | null = null
  /** 兵营专属 UI 面板（打开时隐藏建造菜单 base_hud，关闭时恢复） */
  private barracksPanel: Actor | null = null
  /** 建筑模式状态（true = 建筑菜单显示，可放置/移动/删除建筑） */
  private buildMode = false
  /** 建筑菜单 UI Actor（build_menu.widget.json，根 active:false 默认隐藏，建筑模式才显示） */
  private buildMenuPanel: Actor | null = null
  /** 地图面板 UI Actor（base_map.widget.json，关卡选择面板，打开时生成） */
  private mapPanel: Actor | null = null


  /** 外部设置：点击"出征战斗"后的回调 */
  onStartFishing: (() => void) | null = null
  /** 外部设置：点击房子领取初始金币后的回调 */
  onClaimCoins: (() => void) | null = null
  /** 外部设置：建筑模式开关广播（BaseHudScript 注册 → HUD 自行隐藏/恢复；GameMode 不直接操控 HUD） */
  onBuildModeChange: ((active: boolean) => void) | null = null
  /** 外部设置：兵营面板开关广播（BaseHudScript 注册 → HUD 自行隐藏/恢复） */
  onBarracksPanelChange: ((open: boolean) => void) | null = null

  constructor() {
    super()
    this.baseCamera = new BaseCameraActor()
    // 屏蔽"鼠标移到屏幕边缘自动平移摄像机"（部落冲突风格边缘滚动）
    // 只关边缘滚动：右键拖拽平移 / 滚轮缩放不受影响
    this.baseCamera.rig.setEdgePanEnabled(false)
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
    // 创建放置示意网格（默认隐藏，进入放置模式时显示）
    this.createPlaceGrid()
    // 预生成建筑菜单（根 active:false 默认隐藏，建筑模式才显示）
    this.spawnBuildMenu()
  }

  override EndPlay() {
    this.clearClashBase()
    // 拥有者自清理：销毁本 GameMode 构造的 baseCamera。
    // 相机已托管（setupBasePhase SpawnActor）时走 World 销毁队列；未托管时
    // （如 ai.switchScene 裸切换不执行 extraSetup）由这里本地 EndPlay 回收，
    // 否则相机无 world 归属，reclaimForWorld 无法回收 → 永久泄漏。
    this.baseCamera?.destroy()
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
    // 右键平移开始时取消放置模式（右键平移与放置模式互斥）
    this.baseCamera.rig.onRightPanStart = () => this.cancelPlaceMode()
    // 相机平移边界与放置范围一致（±24，覆盖整个 48x48 地面）
    this.baseCamera.rig.panLimit = PLACE_HALF
    logger.info(`[BaseGM] SpawnPlayer: controller=${controller.name}`)
    return { controller, pawn }
  }

  /** 玩家点击出征 */
  startFishing() {
    this.onStartFishing?.()
  }

  // ════════════════════════════════════════════
  //  HUD 按钮驱动（由 FishGameInstance 绑定 UIButtonComponent.onClick）
  // ════════════════════════════════════════════

  /**
   * 切换建筑模式（HUD"建筑"按钮调用）：
   * 进入 → 显示建筑菜单 + 广播开启（BaseHudScript 收到后自行隐藏基地 HUD）；
   * 退出 → 隐藏菜单 + 广播关闭（HUD 自行恢复） + 清理放置/选中状态
   */
  toggleBuildMode() {
    this.buildMode = !this.buildMode
    if (this.buildMode) {
      if (this.buildMenuPanel) this.buildMenuPanel.bActive = true
      logger.info('[BaseGM] 进入建筑模式（建筑菜单已打开）')
      this.onBuildModeChange?.(true)
    } else {
      this.exitBuildMode()
    }
  }

  /** 退出建筑模式：隐藏建筑菜单 + 清理放置/选中状态 + 广播关闭（菜单关闭按钮 / 地图面板共用） */
  exitBuildMode() {
    this.buildMode = false
    if (this.buildMenuPanel) this.buildMenuPanel.bActive = false
    this.cancelPlaceMode()
    this.deselectBuilding()
    // 广播退出：HUD 由 BaseHudScript 恢复显示（组件自治，GameMode 不直接操控 HUD）
    this.onBuildModeChange?.(false)
    logger.info('[BaseGM] 退出建筑模式（建筑菜单已隐藏）')
  }

  /** 预生成建筑菜单 UI（build_menu.widget.json，挂到 HUD；根 active:false 默认隐藏） */
  private spawnBuildMenu() {
    const w = this.world
    if (!w || this.buildMenuPanel) return
    this.buildMenuPanel = w.ui.spawnUIActor('asset/blueprints/ui/build_menu.widget.json')
    if (!this.buildMenuPanel) {
      logger.error('[BaseGM] 建筑菜单生成失败')
      return
    }
    logger.info('[BaseGM] 建筑菜单已预生成（默认隐藏，建筑模式才显示）')
  }

  /**
   * 切换地图面板（HUD"地图"按钮调用）：
   * 打开 → 生成 base_map.widget.json（关卡选择）；自动退出建筑模式（两面板互斥单向）；
   * 关闭 → 销毁面板。
   */
  toggleMapPanel() {
    if (this.mapPanel) {
      this.closeMapPanel()
      return
    }
    // 打开地图面板时自动退出建筑模式（建筑菜单隐藏；关闭地图面板后可重新进入）
    this.exitBuildMode()
    const w = this.world
    if (!w) {
      logger.error('[BaseGM] 打开地图面板失败：world 为空')
      return
    }
    const panel = w.ui.spawnUIActor('asset/blueprints/ui/base_map.widget.json')
    if (!panel) {
      logger.error('[BaseGM] 地图面板生成失败')
      return
    }
    this.mapPanel = panel
    logger.info('[BaseGM] 打开地图面板（建筑模式已自动退出）')
  }

  /** 关闭地图面板（由 MapPanel 脚本关闭按钮调用） */
  closeMapPanel() {
    if (!this.mapPanel) return
    this.mapPanel.destroy()
    this.mapPanel = null
    logger.info('[BaseGM] 关闭地图面板')
  }

  /**
   * HUD 建筑按钮点击：选择要放置的建筑类型（再次点击同类型取消）。
   * @param typeId 建筑类型 id（townhall/barracks/goldmine/elixir/cannon/wall）
   */
  selectBuildingType(typeId: string) {
    // 退出移动模式
    this.deselectBuilding()
    // 切换选择：再次点击同类型取消
    if (this.selectedType?.id === typeId) {
      this.cancelPlaceMode()
      logger.info('[BaseGM] 取消放置模式')
      return
    }
    this.selectedType = CLASH_BUILDING_TYPES.find((t) => t.id === typeId) ?? null
    if (this.selectedType) {
      this.showPreview(this.selectedType)
      // 进入放置模式 → 显示放置示意网格
      this.setPlaceGridVisible(true)
      logger.info(`[BaseGM] 选择放置: ${this.selectedType.name}`)
    } else {
      logger.warn(`[BaseGM] 未知建筑类型: ${typeId}`)
    }
  }

  /** 取消放置模式：清除选中类型 + 隐藏预览 + 隐藏放置示意网格 */
  private cancelPlaceMode() {
    this.selectedType = null
    this.hidePreview()
    this.setPlaceGridVisible(false)
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
   * 建筑从蓝图资产生成：baseClass 引用具体 Actor 类（每个建筑一个类），
   * 网格坐标写类的 gridX/gridZ 字段。
   * @returns 是否放置成功
   */
  private placeBuilding(typeId: string, gx: number, gz: number): boolean {
    const world = this.world
    const type = CLASH_BUILDING_TYPES.find((t) => t.id === typeId)
    if (!world || !type) return false
    if (Math.abs(gx) > PLACE_HALF || Math.abs(gz) > PLACE_HALF) return false
    const key = `${gx},${gz}`
    if (this.gridOccupied.has(key)) return false

    const building = world.SpawnActorFromBlueprint(type.blueprint) as ClashBuildingBaseActor | null
    if (!building) {
      logger.error(`[BaseGM] 放置建筑失败: 蓝图 "${type.blueprint}" 生成失败 (${type.name})`)
      return false
    }
    // SpawnActorFromBlueprint 内部已入队；这里补网格坐标并定位
    building.gridX = gx
    building.gridZ = gz
    building.setPosition(gx, 0, gz)
    this.clashBuildings.push(building)
    this.gridOccupied.set(key, building)
    logger.info(`[BaseGM] 放置建筑: ${type.name} @ (${gx}, ${gz})`)
    return true
  }

  /** 点击已放置建筑：兵营 → 打开兵营专属 UI（隐藏建造菜单）；其他建筑选中（高亮）/ 取消选中 */
  onBuildingClick(b: ClashBuildingBaseActor) {
    // 非建筑模式：只有兵营可打开面板，其他建筑不响应选中/移动
    if (!this.buildMode && !(b instanceof BarracksActor)) return
    // 兵营：打开兵营专属 UI，不进入选中/移动模式
    if (b instanceof BarracksActor) {
      this.openBarracksPanel()
      return
    }
    if (this.selectedBuilding === b) {
      this.deselectBuilding()
    } else {
      this.deselectBuilding()
      this.selectedBuilding = b
      b.setSelected(true)
      // 退出放置模式，进入移动模式：点击地面移动建筑
      this.cancelPlaceMode()
    }
  }

  /**
   * 打开兵营专属 UI：隐藏建造菜单（base_hud），生成 barracks_ui.widget.json 挂到 HUD。
   * 面板关闭按钮由 BarracksUi.script.ts 绑定到 closeBarracksPanel。
   */
  private openBarracksPanel() {
    const w = this.world
    if (!w || this.barracksPanel) return
    // 退出选中/放置模式（兵营 UI 打开时互斥）
    this.deselectBuilding()
    this.cancelPlaceMode()
    // 地图面板与兵营面板互斥：打开兵营时关闭地图面板（建筑菜单独立控制，见下）
    this.closeMapPanel()
    // 广播兵营面板开启：HUD 由 BaseHudScript 自行隐藏（组件自治，GameMode 不直接操控 HUD）
    this.onBarracksPanelChange?.(true)
    // 建筑模式下同步隐藏建筑菜单（兵营面板打开时互斥）
    if (this.buildMenuPanel) this.buildMenuPanel.bActive = false
    // 生成兵营面板（挂到当前 HUD）
    const panel = w.ui.spawnUIActor('asset/blueprints/ui/barracks_ui.widget.json')
    if (!panel) {
      logger.error('[BaseGM] 兵营 UI 生成失败，恢复建造菜单')
      this.onBarracksPanelChange?.(false)
      return
    }
    this.barracksPanel = panel
    logger.info('[BaseGM] 打开兵营 UI（建造菜单已隐藏）')
  }

  /** 关闭兵营专属 UI：销毁面板，广播关闭（HUD 由 BaseHudScript 恢复显示），建筑模式下恢复建筑菜单 */
  closeBarracksPanel() {
    if (!this.barracksPanel) return
    this.barracksPanel.destroy()
    this.barracksPanel = null
    // 广播兵营面板关闭：HUD 由 BaseHudScript 恢复（非建筑模式下显示，建筑模式保持隐藏）
    this.onBarracksPanelChange?.(false)
    // 建筑模式下恢复建筑菜单
    if (this.buildMode && this.buildMenuPanel) this.buildMenuPanel.bActive = true
    logger.info('[BaseGM] 关闭兵营 UI，恢复建造菜单')
  }

  private deselectBuilding() {
    if (this.selectedBuilding) {
      this.selectedBuilding.setSelected(false)
      this.selectedBuilding = null
    }
  }

  // ════════════════════════════════════════════
  //  鼠标交互（由 FishBasePlayerController 转发）
  // ════════════════════════════════════════════

  /** 鼠标按下：放置建筑 / 移动选中建筑（仅建筑模式响应） */
  onScreenDown(sx: number, sy: number) {
    if (!this.buildMode) return
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

  // ════════════════════════════════════════════
  //  放置示意网格（放置模式提示：网格吸附位置可视化）
  // ════════════════════════════════════════════

  /** 创建放置示意网格：覆盖整个放置范围（±PLACE_HALF，每格 1 单位），默认隐藏 */
  private createPlaceGrid() {
    const w = this.world
    if (!w || this.placeGridActor) return
    // 格子规则（游戏侧计算）：建筑中心在整数坐标（格子中心），
    // 网格线画在格子边界 = 中心坐标 ±0.5（半整数），即 [-PLACE_HALF-0.5, PLACE_HALF+0.5]
    // SpawnActorOfType：组件内自动 new PlaceGridActor + 入队（经 World 工厂建线 + LineComponent 托管，随 Actor 销毁自动释放）
    this.placeGridActor = w.SpawnActorOfType(PlaceGridActor, 'PlaceGrid', {
      min: -PLACE_HALF - 0.5,
      max: PLACE_HALF + 0.5,
      step: 1,
      color: 0xffffff,
      transparent: true,
      opacity: 0.4,
      y: 0.01,
    })
    logger.info('[BaseGM] 放置示意网格 Actor 已创建（格子边界 ±' + (PLACE_HALF + 0.5) + '，建筑中心对齐格子中心，默认隐藏）')
  }

  /** 切换放置示意网格显隐 */
  private setPlaceGridVisible(visible: boolean): void {
    this.placeGridActor?.setVisible(visible)
  }

  /** 移动建筑：先移除旧占用，再放置到新格子 */
  private placeBuildingAt(b: ClashBuildingBaseActor, gx: number, gz: number): boolean {
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
    // 解除右键平移回调引用（防悬挂）
    this.baseCamera.rig.onRightPanStart = null
    // 地图构建器 EndPlay：注销对象注册表；装饰 Actor 由 World.DestroyAllActors 统一销毁
    this.baseBuilder?.EndPlay()
    this.baseBuilder = null
    this.previewComp = null
    this.previewMesh = null
    // PlaceGrid Actor 由 World.DestroyAllActors 统一销毁（其 LineComponent 自动释放线条资源）
    this.placeGridActor = null
    // 兵营面板是 UI Actor，由 World 销毁时 UIManager.destroyAll 统一销毁，这里只清引用
    this.barracksPanel = null
    this.buildMenuPanel = null
    this.mapPanel = null
    this.buildMode = false
    this.clashBuildings = []
    this.gridOccupied.clear()
    this.selectedType = null
    this.selectedBuilding = null
  }
}
