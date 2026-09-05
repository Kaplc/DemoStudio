/**
 * FishBaseGameMode — ClashMaster 村庄基地 GameMode（部落冲突风格基地）
 * 显示热带海岛基地场景（沙滩、棕榈树、茅草屋等），
 * 中央有一块部落冲突风格的方格草地地图，可放置不同颜色的立方体建筑。
 *
 * 玩法：
 *  - HUD 底部"地图"按钮进入建筑模式 → 打开建筑菜单（独立 widget，默认隐藏）
 *  - 建筑菜单点击选择要放置的建筑类型（不同颜色立方体，吸附网格；虚影绿=可放/红=占用）
 *  - 城墙等 continuous 类型：按住左键拖过格子连续放置（部落冲突风格圈地）
 *  - 点击已放置建筑 → 选中（金色线框高亮），点击其他格子可移动
 *  - 菜单末尾红色"删除"按钮 → 删除选中的建筑
 */
import * as THREE from 'three'
import { GameMode, PhySys, logger, MeshComponent, BoxMeshComponent, CollisionLayer, ColliderComponent, Instantiate, GameInstance, GenericActor, UITransformComponent, type Actor } from '@/engine'
import { BaseCameraActor } from './BaseCameraActor'
import { FishBasePlayerController } from './FishBasePlayerController'
import { FishBasePawn } from './FishBasePawn'
import { CLASH_BUILDING_TYPES, type ClashBuildingType } from './ClashBuildingTypes'
import { ClashBuildingBaseActor } from './ClashBuildingActors'
import { ClashBaseBuilder, PLACE_HALF } from './ClashBaseBuilder'
import { PlaceGridActor } from './PlaceGridActor'
import { clearObstacleReward, spawnObstaclesForBase, finishObstacleClear, obstacleCount } from './ObstacleSystem'
import { fastForwardGemCost } from './ProductionService'
import { BuildingInfoState, BuildingUpgradeState } from './BuildingPanelState'
import type { FishGameInstance } from '../FishGameInstance'

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

  /** 基地地图构建器（创建预览宿主 + 初始建筑布局，BeginPlay 创建，EndPlay 回收） */
  private baseBuilder: ClashBaseBuilder | null = null
  /** 已放置的建筑（每个建筑一个 Actor 类实例） */
  private clashBuildings: ClashBuildingBaseActor[] = []
  /** 网格占用表：`${gx},${gz}` → 建筑 */
  private gridOccupied = new Map<string, ClashBuildingBaseActor>()
  /** 障碍物占用集合（与建筑共用格子判断；`${gx},${gz}` 键） */
  private obstacleOccupied = new Set<string>()
  /** 当前选择的建筑类型（null = 未进入放置模式） */
  private selectedType: ClashBuildingType | null = null
  /** 当前选中的已放置建筑 */
  private selectedBuilding: ClashBuildingBaseActor | null = null
  /** 拖动连放去重游标：上一次连放吸附的格子键（`${gx},${gz}`，同格不重复放置；按住手势态归 Controller，经 onScreenMove 参数透传） */
  private lastDragKey: string | null = null
  /** 放置模式跟随鼠标的半透明预览（MeshComponent 托管，showPreview 时替换） */
  private previewComp: MeshComponent | null = null
  private previewMesh: THREE.Mesh | null = null
  /** 预览宿主子 Actor（挂 decor 下，切类型时销毁重建防累积泄漏） */
  private previewHost: GenericActor | null = null
  /** 放置示意网格 Actor（PlaceGridActor，默认隐藏，进入放置模式显示） */
  private placeGridActor: PlaceGridActor | null = null
  /** 兵营专属 UI 面板（打开时隐藏建造菜单 base_hud，关闭时恢复） */
  private barracksPanel: Actor | null = null
  /** 实验室专属 UI 面板（研究入口，打开时互斥关闭其他模态） */
  private laboratoryPanel: Actor | null = null
  /** 任务面板（成就 + 每日任务，打开时互斥关闭其他模态） */
  private tasksPanel: Actor | null = null
  /** 建筑升级面板（点击建筑时打开） */
  private buildingUpgradePanel: Actor | null = null
  /** 宝石商店面板（HUD按钮打开） */
  private gemShopPanel: Actor | null = null
  /** 建筑信息牌（场景 UI：点击建筑弹出，跟随建筑上方；同一时刻最多一张） */
  private buildingInfoPanel: Actor | null = null
  /** 当前展示信息牌的建筑（重开/关闭判定用） */
  private buildingInfoTarget: ClashBuildingBaseActor | null = null
  /** 收集泡泡（场景 UI：金矿/水库积压 ≥80% 容量时生成，建筑头顶） */
  private collectBubbles = new Map<ClashBuildingBaseActor, Actor>()
  /** 建筑模式状态（true = 建筑菜单显示，可放置/移动/删除建筑） */
  private buildMode = false
  /** 建筑菜单 UI Actor（build_menu.widget.json，根 active:false 默认隐藏，建筑模式才显示） */
  private buildMenuPanel: Actor | null = null
  /** 地图面板 UI Actor（base_map.widget.json，关卡选择面板，打开时生成） */
  private mapPanel: Actor | null = null
  /** 存档管理菜单（save_menu.widget.json，Esc 呼出时生成） */
  private saveMenuPanel: Actor | null = null
  /** 模态 UI 打开中（存档菜单）：屏蔽地面点击，防面板下点穿操作建筑 */
  uiModalOpen = false

  /** 外部设置：每帧基地经营回调（收集泡泡巡检/进度刷新，FishGameInstance.tick base 分支驱动） */
  onBaseTick: (() => void) | null = null


  /** 外部设置：点击"出征战斗"后的回调 */
  onStartFishing: (() => void) | null = null
  /** 外部设置：点击房子领取初始金币后的回调 */
  onClaimCoins: (() => void) | null = null
  /** 外部设置：建筑模式开关广播（BaseHudScript 注册 → HUD 自行隐藏/恢复；GameMode 不直接操控 HUD） */
  onBuildModeChange: ((active: boolean) => void) | null = null
  /** 外部设置：兵营面板开关广播（BaseHudScript 注册 → HUD 自行隐藏/恢复） */
  onBarracksPanelChange: ((open: boolean) => void) | null = null
  /** 外部设置：任务面板开关广播（BaseHudScript 注册 → HUD 自行隐藏/恢复） */
  onTasksPanelChange: ((open: boolean) => void) | null = null
  /** 外部设置：宝石商店面板开关广播（BaseHudScript 注册 → HUD 自行隐藏/恢复） */
  onGemShopChange: ((open: boolean) => void) | null = null
  /** 外部设置：初始布局构建完成（BeginPlay 末尾触发一次；持久化恢复门控用） */
  onLayoutBuilt: (() => void) | null = null
  /** 外部设置：布局变化广播（放置/移动/删除成功后；持久化采集用，恢复期由宿主静音） */
  onLayoutChange: (() => void) | null = null

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
    // 必须调基类：基类 StartPlay 内含 SpawnPlayer()（创建 FishBasePlayerController）。
    // 漏掉会导致 mode.controller 为 null → 基地放置建筑/相机操作等输入全部失效。
    super.StartPlay()
    // 基地为建造态而非游玩态（基类已置 playing，这里回到 waiting）
    this.gameState.setPhase('waiting')
  }

  override BeginPlay() {
    super.BeginPlay()
    // 草地/景物由场景资产 FishBaseIsland 创建（SwitchToScene 的 loadSceneAsActors），
    // 这里只构建初始建筑布局（放置回调走本 GameMode 的 placeBuilding）并创建预览宿主
    this.baseBuilder = new ClashBaseBuilder(this.world!)
    this.baseBuilder.build((id, gx, gz) => this.placeBuilding(id, gx, gz))
    // 障碍物生成（树/石头，占格不可建；存档快照恢复由宿主层处理，这里按存档键补差）
    spawnObstaclesForBase(this)
    // 创建放置示意网格（默认隐藏，进入放置模式时显示）
    this.createPlaceGrid()
    // 预生成建筑菜单（根 active:false 默认隐藏，建筑模式才显示）
    this.spawnBuildMenu()
    // 初始布局构建完成（此刻建筑还在 pendingSpawn 队列，等下一帧 manualTick 提交）
    this.onLayoutBuilt?.()
  }

  override EndPlay() {
    this.clearClashBase()
    // 拥有者自清理：销毁本 GameMode 构造的 baseCamera。
    // 相机已托管（setupBasePhase SpawnActor）时走 World 销毁队列；未托管时
    // （如通过 GM 命令等裸切换不执行 extraSetup）由这里本地 EndPlay 回收，
    // 否则相机无 world 归属，reclaimForWorld 无法回收 → 永久泄漏。
    this.baseCamera?.destroy()
    super.EndPlay()
  }

  override Tick(dt: number) {
    super.Tick(dt)
    // 收集泡泡巡检（积压 ≥80% 生成 / 回落销毁；幂等，成本极低）
    this.refreshCollectBubbles()
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
    // Esc：呼出/关闭存档管理菜单（手动存档/读档入口）
    controller.inputComponent.BindAction('base-save-menu', 'Escape', 'pressed', () => this.toggleSaveMenu())
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
  //  存档管理菜单（save_menu.widget.json，Esc 呼出）
  // ════════════════════════════════════════════

  /** Esc 切换存档菜单 */
  toggleSaveMenu() {
    if (this.saveMenuPanel) this.closeSaveMenu()
    else this.openSaveMenu()
  }

  /** 打开存档菜单：自动退出建造/选中模式（互斥），并置模态标记屏蔽地面点击 */
  openSaveMenu() {
    const w = this.world
    if (!w || this.saveMenuPanel) return
    // 与建筑菜单/地图面板互斥单向：打开本面板先收起其他模态
    if (this.mapPanel) this.closeMapPanel()
    if (this.tasksPanel) this.closeTasksPanel()
    this.closeBuildingInfoPanel()
    this.exitBuildMode()
    const panel = w.ui.spawnUIActor('asset/blueprints/ui/save_menu.widget.json')
    if (!panel) {
      logger.error('[BaseGM] 存档菜单生成失败')
      return
    }
    this.saveMenuPanel = panel
    this.uiModalOpen = true
    logger.info('[BaseGM] 打开存档菜单')
  }

  /** 关闭存档菜单（关闭按钮 / 再次按 Esc / 读取成功后自动关） */
  closeSaveMenu() {
    if (!this.saveMenuPanel) return
    this.saveMenuPanel.destroy()
    this.saveMenuPanel = null
    this.uiModalOpen = false
    logger.info('[BaseGM] 关闭存档菜单')
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
    this.closeBuildingInfoPanel()
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

  /** 取消放置模式：清除选中类型 + 隐藏预览 + 隐藏放置示意网格 + 重置拖放游标 */
  private cancelPlaceMode() {
    this.selectedType = null
    this.hidePreview()
    this.setPlaceGridVisible(false)
    this.lastDragKey = null
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
    this.onLayoutChange?.()
  }

  /**
   * 放置合法性校验（越界/占格/碰撞三重检查，预览与放置共用同一口径）：
   *  - 越界：|gx|/|gz| > PLACE_HALF
   *  - 占格：gridOccupied（建筑）/ obstacleOccupied（障碍物）
   *  - 碰撞：物理查询与既有建筑 AABB 重叠
   * @param silent true = 静默模式（预览/拖动连放高频调用，失败不刷 warn 日志）
   */
  private canPlaceAt(type: ClashBuildingType, gx: number, gz: number, silent = false): boolean {
    if (!this.world) return false
    if (Math.abs(gx) > PLACE_HALF || Math.abs(gz) > PLACE_HALF) return false
    const key = `${gx},${gz}`
    if (this.gridOccupied.has(key)) return false
    if (this.obstacleOccupied.has(key)) {
      if (!silent) logger.warn(`[BaseGM] 放置失败：位置 (${gx},${gz}) 被障碍物占用`)
      return false
    }
    // 物理查询：与已放置建筑（static 碰撞体）重叠则拒绝（建筑半宽 = type.size/2）
    const half = type.size / 2
    if (this.world.physics.overlapTest(new THREE.Vector3(gx, 0, gz), half, half, { group: CollisionLayer.BUILDING })) {
      if (!silent) logger.warn(`[BaseGM] 放置失败：位置 (${gx},${gz}) 与既有建筑碰撞重叠`)
      return false
    }
    return true
  }

  /**
   * 放置建筑（网格吸附，格子坐标 = 世界坐标整数）。
   * 建筑从蓝图资产生成：baseClass 引用具体 Actor 类（每个建筑一个类），
   * 网格坐标写类的 gridX/gridZ 字段。
   * 冲突检测：canPlaceAt（越界/占用表/物理查询三重校验，与预览着色共用口径）。
   * @param silent true = 静默模式（拖动连放重复路径，失败不刷 warn 日志）
   * @returns 是否放置成功
   */
  private placeBuilding(typeId: string, gx: number, gz: number, silent = false): boolean {
    const world = this.world
    const type = CLASH_BUILDING_TYPES.find((t) => t.id === typeId)
    if (!world || !type) return false
    if (!this.canPlaceAt(type, gx, gz, silent)) return false
    const key = `${gx},${gz}`

    const building = Instantiate(type.blueprint) as ClashBuildingBaseActor | null
    if (!building) {
      logger.error(`[BaseGM] 放置建筑失败: 蓝图 "${type.blueprint}" 生成失败 (${type.name})`)
      return false
    }
    // BlueprintAsset.Instantiate 内部已入队；这里补网格坐标并定位
    building.gridX = gx
    building.gridZ = gz
    building.setPosition(gx, 0, gz)
    // 碰撞体通过 onTransformChanged 自动同步（ColliderComponent.BeginPlay 中订阅）
    this.clashBuildings.push(building)
    this.gridOccupied.set(key, building)
    logger.info(`[BaseGM] 放置建筑: ${type.name} @ (${gx}, ${gz})`)
    this.onLayoutChange?.()
    return true
  }

  /** 点击已放置建筑：建筑模式走选中/移动；其余统一弹出建筑信息牌（升级/收集入口在信息牌上） */
  onBuildingClick(b: ClashBuildingBaseActor) {
    if (this.uiModalOpen) return // 模态 UI 打开中，屏蔽建筑选中/面板穿透
    // 建筑模式：选中/移动（点击目标已是建筑，信息牌不参与）
    if (this.buildMode) {
      if (this.selectedBuilding === b) {
        this.deselectBuilding()
      } else {
        this.deselectBuilding()
        this.selectedBuilding = b
        b.setSelected(true)
        // 退出放置模式，进入移动模式：点击地面移动建筑
        this.cancelPlaceMode()
      }
      return
    }
    // 非建筑模式：统一弹出信息牌（同一建筑再点 = 关闭）
    if (this.buildingInfoTarget === b) {
      this.closeBuildingInfoPanel()
      return
    }
    this.openBuildingInfoPanel(b)
  }

  /** GameInstance 引用（生产/进度服务互调用） */
  get gameInstance(): FishGameInstance | null {
    return GameInstance.current as FishGameInstance | null
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
    if (this.laboratoryPanel) this.closeLaboratoryPanel()
    if (this.tasksPanel) this.closeTasksPanel()
    this.closeBuildingInfoPanel()
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

  // ════════════════════════════════════════════
  //  实验室面板（兵种研究入口）
  // ════════════════════════════════════════════

  /** 打开实验室面板（laboratory_ui.widget.json，互斥关闭其他模态） */
  private openLaboratoryPanel() {
    const w = this.world
    if (!w || this.laboratoryPanel) return
    this.deselectBuilding()
    this.cancelPlaceMode()
    this.closeMapPanel()
    if (this.barracksPanel) this.closeBarracksPanel()
    if (this.tasksPanel) this.closeTasksPanel()
    this.closeBuildingInfoPanel()
    const panel = w.ui.spawnUIActor('asset/blueprints/ui/laboratory_ui.widget.json')
    if (!panel) {
      logger.error('[BaseGM] 实验室 UI 生成失败')
      return
    }
    this.laboratoryPanel = panel
    logger.info('[BaseGM] 打开实验室 UI')
  }

  /** 关闭实验室面板（脚本关闭按钮调用） */
  closeLaboratoryPanel() {
    if (!this.laboratoryPanel) return
    this.laboratoryPanel.destroy()
    this.laboratoryPanel = null
    logger.info('[BaseGM] 关闭实验室 UI')
  }

  // ════════════════════════════════════════════
  //  任务面板（成就 + 每日任务）
  // ════════════════════════════════════════════

  /** 切换任务面板（HUD"任务"按钮调用） */
  toggleTasksPanel() {
    if (this.tasksPanel) this.closeTasksPanel()
    else this.openTasksPanel()
  }

  /** 打开任务面板（tasks_ui.widget.json，互斥关闭其他模态） */
  private openTasksPanel() {
    const w = this.world
    if (!w || this.tasksPanel) return
    this.exitBuildMode()
    this.closeMapPanel()
    if (this.barracksPanel) this.closeBarracksPanel()
    if (this.laboratoryPanel) this.closeLaboratoryPanel()
    this.closeBuildingInfoPanel()
    const panel = w.ui.spawnUIActor('asset/blueprints/ui/tasks_ui.widget.json')
    if (!panel) {
      logger.error('[BaseGM] 任务面板生成失败')
      return
    }
    this.tasksPanel = panel
    this.onTasksPanelChange?.(true)
    logger.info('[BaseGM] 打开任务面板（成就 + 每日任务）')
  }

  /** 关闭任务面板（脚本关闭按钮调用） */
  closeTasksPanel() {
    if (!this.tasksPanel) return
    this.tasksPanel.destroy()
    this.tasksPanel = null
    this.onTasksPanelChange?.(false)
    logger.info('[BaseGM] 关闭任务面板')
  }

  // ════════════════════════════════════════════
  //  建筑升级（点击升级入口由建筑面板/调试桥调用）
  // ════════════════════════════════════════════

  /** 升级指定建筑（资源/队列校验在 ProductionService；成功后记录日志） */
  upgradeBuilding(buildingId: string): boolean {
    const inst = this.gameInstance
    if (!inst) return false
    const ok = inst.production.startBuildingUpgrade(buildingId)
    if (ok) logger.info(`[BaseGM] 建筑升级已排队: ${buildingId}（升级中不可删除/再次升级）`)
    return ok
  }

  /** 宝石秒完成当前升级（折算规则见 fastForwardGemCost） */
  fastForwardUpgrade(): boolean {
    const inst = this.gameInstance
    const timer = inst?.production.getUpgrading()
    if (!inst || !timer) return false
    return inst.production.fastForward(timer, '建筑升级', (t) => {
      // 立即结算：把 finishAt 拨到过去，下一帧 updateTimers 自然完成
      t.finishAt = Date.now() - 1
    })
  }

  /** 升级费用预览（面板显示；未配表返回 null） */
  upgradePreview(buildingId: string): { cost: number, time: number, nextLevel: number, maxed: boolean } | null {
    const inst = this.gameInstance
    if (!inst) return null
    const next = inst.production.getBuildingLevel(buildingId) + 1
    const stats = inst.production.buildingStats(buildingId, next)
    if (!stats) return { cost: 0, time: 0, nextLevel: next, maxed: true }
    return { cost: stats.upgradeCost, time: stats.upgradeTime, nextLevel: next, maxed: false }
  }

  /** 当前升级剩余秒数（HUD/面板显示；无升级返回 null） */
  upgradeRemainingSec(): number | null {
    const t = this.gameInstance?.production.getUpgrading()
    if (!t) return null
    return Math.max(0, Math.ceil((t.finishAt - Date.now()) / 1000))
  }

  /** 加速费用（宝石数；无升级返回 null） */
  upgradeFastForwardCost(): number | null {
    const t = this.gameInstance?.production.getUpgrading()
    if (!t) return null
    return fastForwardGemCost(Math.max(0, Math.ceil((t.finishAt - Date.now()) / 1000)))
  }

  // ════════════════════════════════════════════
  //  障碍物（ObstacleSystem 回调）
  // ════════════════════════════════════════════

  /** 障碍物点击清除入口（ObstacleSystem 内部绑定到 ClickableComponent） */
  clearObstacle(id: string): boolean {
    const inst = this.gameInstance
    if (!inst) return false
    return clearObstacleReward(this, id)
  }

  /** 清除完成回调（ProductionService.updateTimers → 宿主 → 本方法）：移除占格并掉落 */
  onObstacleCleared(id: string): void {
    finishObstacleClear(this, id)
  }

  // ════════════════════════════════════════════
  //  障碍物占格 API（ObstacleSystem 调用）
  // ════════════════════════════════════════════

  /** 格子是否空闲（建筑占用表 + 障碍物占用集合 + 放置范围） */
  isGridFree(gx: number, gz: number): boolean {
    if (Math.abs(gx) > PLACE_HALF || Math.abs(gz) > PLACE_HALF) return false
    const key = `${gx},${gz}`
    return !this.gridOccupied.has(key) && !this.obstacleOccupied.has(key)
  }

  /** 障碍物占用格子（放置成功后调用） */
  occupyObstacleGrid(gx: number, gz: number): void {
    this.obstacleOccupied.add(`${gx},${gz}`)
  }

  /** 障碍物释放格子（清除完成后调用） */
  freeObstacleGrid(gx: number, gz: number): void {
    this.obstacleOccupied.delete(`${gx},${gz}`)
  }

  /** 当前场上障碍物数量（GM/调试桥用） */
  get obstacleTotal(): number {
    return obstacleCount(this)
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

  /** 鼠标按下：放置建筑 / 移动选中建筑（仅建筑模式响应）；空地点击关闭信息牌 */
  onScreenDown(sx: number, sy: number) {
    if (this.uiModalOpen) return // 模态 UI 打开中（存档菜单），屏蔽地面点击防穿透
    if (!this.buildMode) {
      // 非建筑模式点空地：关闭建筑信息牌（命中建筑的一击已被 ClickableComponent 消费，不会到这）
      this.closeBuildingInfoPanel()
      return
    }
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

    // 放置模式：放置当前选中的类型（continuous 类型的连放由拖动手势驱动，见 onScreenMove）
    if (this.selectedType) {
      this.placeBuilding(this.selectedType.id, gx, gz)
    }
  }

  /**
   * 鼠标移动：放置模式下更新半透明预览位置（绿=可放/红=不可放），
   * 按住（dragging）时每进入一个新格子尝试连放一块（失败静默跳过不断链）。
   * @param dragging 左键按住中（拖动手势态由 Controller 透传，GameMode 不存储）
   */
  onScreenMove(sx: number, sy: number, dragging = false) {
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
    // 合法性着色：canPlaceAt 与实际放置共用同一口径（预览说能放就真能放）
    const ok = this.canPlaceAt(type, gx, gz, true)
    ;(this.previewMesh.material as THREE.MeshStandardMaterial).color.setHex(ok ? type.color : 0xff4444)
    // 拖动连放：continuous 类型按住期间进入新格子 → 尝试放置（silent 长按重复路径必须静默）
    if (dragging && type.continuous) {
      const key = `${gx},${gz}`
      if (key !== this.lastDragKey) {
        this.lastDragKey = key
        this.placeBuilding(type.id, gx, gz, true)
      }
    }
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
    // 预览宿主：场景资产的装饰根 Actor（草地随场景资产生成，预览挂它下面统一回收）
    const decor = w?.findActorByName('BattleGround') ?? this.baseBuilder?.decor
    if (!w || !decor) {
      logger.warn('[BaseGM] showPreview: 未找到预览宿主（场景 BattleGround 与 builder.decor 均为空，检查场景资产）')
      return
    }
    this.hidePreview()
    // 独立预览子 Actor：宿主（BattleGround 草地）已有 Plane mesh，
    // 直接在宿主上挂 MeshComponent 会被"一个 Actor 只能挂一个 Mesh"拒绝挂树
    // （日志报 [MeshComponent] 拒绝挂载 ... 被拒: "PreviewMesh"）→ 拆子 Actor 挂载。
    // 切类型时销毁旧子 Actor（内联节点无 world 归属，走本地 EndPlay 递归释放组件资源）；
    // 本地 EndPlay 不自动脱离父树 → 必须手动 detach，否则 decor.children 残留幽灵节点
    if (this.previewHost) {
      this.previewHost.destroy()
      this.previewHost.detach()
      this.previewHost = null
    }
    const host = new GenericActor('PreviewHost')
    host.attachTo(decor)
    // 宿主（BattleGround 草地平面）在场景资产里绕 X 轴转了 -90°，直接挂它下面
    // 局部 y/z 轴与世界系错位：position.set(gx, h, gz) 的 y 分量会落到世界 -z、
    // z 分量变成世界 -y（虚影被埋进地下 y=-gz，俯视摄像机永远看不见）。
    // 补偿：host 世界旋转 = 父链世界旋转的逆 → host 局部系与世界系对齐，
    // mesh.position 保持世界系语义（gx, 0.15+h/2, gz）直接可用。
    decor.root.updateWorldMatrix(true, false)
    host.root.quaternion.copy(decor.root.getWorldQuaternion(new THREE.Quaternion()).invert())
    const mesh = w.createBoxMesh(type.size, type.height, type.size, type.color, true, 0.5)
    mesh.visible = false
    this.previewComp = new BoxMeshComponent(host, mesh, 'PreviewMesh')
    host.addComponent(this.previewComp)
    this.previewHost = host
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
    this.placeGridActor = w.actorMgr.SpawnActorOfType(PlaceGridActor, 'PlaceGrid', {
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

  /** 移动建筑：先移除旧占用，再放置到新格子（物理查询排除自身碰撞体） */
  private placeBuildingAt(b: ClashBuildingBaseActor, gx: number, gz: number): boolean {
    if (Math.abs(gx) > PLACE_HALF || Math.abs(gz) > PLACE_HALF) return false
    const key = `${gx},${gz}`
    const other = this.gridOccupied.get(key)
    if (other && other !== b) return false
    // 物理查询（排除自身）：移动后是否与既有建筑碰撞重叠
    const half = b.type.size / 2
    if (this.world!.physics.overlapTest(
      new THREE.Vector3(gx, 0, gz), half, half,
      { group: CollisionLayer.BUILDING, exclude: this.findColliderOf(b) ?? undefined },
    )) {
      logger.warn(`[BaseGM] 移动失败：位置 (${gx},${gz}) 与既有建筑碰撞重叠`)
      return false
    }

    // 释放旧格子
    this.gridOccupied.delete(`${b.gridX},${b.gridZ}`)
    b.gridX = gx
    b.gridZ = gz
    b.setPosition(gx, 0, gz)
    this.gridOccupied.set(key, b)
    // 碰撞体通过 onTransformChanged 自动同步
    this.onLayoutChange?.()
    return true
  }

  /** 沿 Actor 子树查找碰撞体组件（建筑碰撞体挂建筑根） */
  private findColliderOf(b: ClashBuildingBaseActor): ColliderComponent | null {
    const stack: Actor[] = [b]
    while (stack.length > 0) {
      const a = stack.pop()!
      const c = a.getAllComponents().find((comp) => comp instanceof ColliderComponent) as ColliderComponent | undefined
      if (c) return c
      stack.push(...a.getChildren())
    }
    return null
  }

  // ════════════════════════════════════════════
  //  布局快照 / 清场 / 重建（持久化支持，由 FishGameInstance 调用）
  // ════════════════════════════════════════════

  /** 当前布局快照（存档采集用）：建筑类型 id + 锚点格子坐标 */
  getLayoutSnapshot(): Array<{ id: string; gx: number; gz: number }> {
    return this.clashBuildings.map((b) => ({ id: b.type.id, gx: b.gridX, gz: b.gridZ }))
  }

  /**
   * 清空当前布局（存档恢复第一步）：逐个标记销毁 + 同步清空占用表。
   * 注意：destroy 走 pendingDestroy 队列，Actor 与碰撞体要到下一帧
   * manualTick 的 commitDestroy 才真正移除——宿主必须隔一帧再重放建筑，
   * 否则幽灵碰撞体会把重放位置全部判为重叠拒绝。
   * @returns 标记销毁的建筑数
   */
  clearClashLayout(): number {
    const count = this.clashBuildings.length
    for (const b of [...this.clashBuildings]) b.destroy()
    this.clashBuildings = []
    this.gridOccupied.clear()
    if (count > 0) logger.info(`[BaseGM] 布局恢复清场：${count} 栋建筑待下一帧移除`)
    return count
  }

  /**
   * 按快照重放布局（存档恢复第二步，须在 clearClashLayout 隔帧后调用）：
   * 逐条走私有 placeBuilding，自动继承越界/占位/碰撞三重校验——非法条目
   * （越界、同格互踩、未知类型）静默拒绝，由返回值记账。
   * @returns 成功重建的建筑数
   */
  rebuildLayoutFrom(list: ReadonlyArray<{ id: string; gx: number; gz: number }>): number {
    let placed = 0
    for (const item of list ?? []) {
      if (this.placeBuilding(item.id, item.gx, item.gz)) placed++
    }
    return placed
  }

  // ════════════════════════════════════════════
  //  建筑信息牌（场景 UI：点击建筑弹出，摆在建筑上方）
  // ════════════════════════════════════════════

  /** 打开建筑信息牌（场景 UI，摆建筑上方 billboard；同一时刻最多一张） */
  private openBuildingInfoPanel(b: ClashBuildingBaseActor) {
    const w = this.world
    if (!w) return
    // 已有信息牌先关旧的（点击其他建筑直接切换；同一建筑再点=关闭已在 onBuildingClick 拦截）
    if (this.buildingInfoPanel) this.closeBuildingInfoPanel()
    BuildingInfoState.currentBuildingId = b.type.id
    // world 模式必须顶层生成且引擎忽略 target（挂 HUD 子树会让场景分流失效），
    // 位姿由 spawn 后显式 setPosition 表达（BaseHologram 同款先例）。
    // 资产已声明锚点时以下 opts 不生效（以资产为准），仅作资产未声明时的兜底
    const handle = w.ui.spawnAnchoredWidget('asset/blueprints/ui/building_info.widget.json', null, {
      mode: 'world',
      faceCamera: true,
      pxPerMeter: 300,
      pixelDensity: 2,
      alwaysOnTop: true,
    })
    if (!handle) {
      logger.error('[BaseGM] 建筑信息牌生成失败')
      return
    }
    const top = b.actorLocation
    handle.transform?.setPosition(top.x, top.y + (b.type.height + 0.15) / 2 + 1.1, top.z)
    this.buildingInfoPanel = handle.actor
    this.buildingInfoTarget = b
    logger.info(`[BaseGM] 打开建筑信息牌: ${b.type.name}`)
  }

  /** 关闭建筑信息牌（信息牌关闭按钮 / 空地点击 / 再点同一建筑调用） */
  closeBuildingInfoPanel() {
    if (!this.buildingInfoPanel) return
    this.buildingInfoPanel.destroy()
    this.buildingInfoPanel = null
    this.buildingInfoTarget = null
    logger.info('[BaseGM] 关闭建筑信息牌')
  }

  /** 按建筑类型收集该矿积压（信息牌收集入口；校验在 ProductionService.collect） */
  collectFromBuilding(typeId: string): number {
    const inst = this.gameInstance
    if (!inst || (typeId !== 'goldmine' && typeId !== 'elixir')) return 0
    const got = inst.production.collect(typeId)
    if (got > 0) logger.info(`[BaseGM] 信息牌收集 ${typeId}: +${got}`)
    return got
  }

  /** 收集泡泡点击结算入口（脚本只传自身 actor，矿种由泡泡→建筑映射反查，规则归 GameMode） */
  collectFromBubble(bubble: Actor): number {
    for (const [b, actor] of this.collectBubbles) {
      if (actor === bubble) {
        return this.collectFromBuilding(b.type.id)
      }
    }
    logger.warn('[BaseGM] 收集泡泡点击：未找到所属建筑（泡泡可能刚被移除）')
    return 0
  }

  // ════════════════════════════════════════════
  //  收集泡泡（金矿/水库积压 ≥80% 容量时出现，点击一键收集）
  // ════════════════════════════════════════════

  /** 收集泡泡出现阈值（积压/容量比例；配表容量 600 起，80% = 480 即约 4 分钟积满） */
  private static readonly COLLECT_BUBBLE_RATIO = 0.8

  /** 每帧巡检（GameMode.Tick 驱动）：积压达标的矿生成泡泡，收集后/不达标的销毁 */
  private refreshCollectBubbles() {
    const inst = this.gameInstance
    const w = this.world
    if (!inst || !w) return
    for (const b of this.clashBuildings) {
      if (b.type.id !== 'goldmine' && b.type.id !== 'elixir') continue
      const stats = inst.production.buildingStats(b.type.id, inst.production.getBuildingLevel(b.type.id))
      const ratio = stats && stats.storage > 0 ? inst.production.getStored(b.type.id as 'goldmine' | 'elixir') / stats.storage : 0
      const has = this.collectBubbles.has(b)
      if (ratio >= FishBaseGameMode.COLLECT_BUBBLE_RATIO && !has) {
        this.spawnCollectBubble(b)
      } else if (ratio < FishBaseGameMode.COLLECT_BUBBLE_RATIO && has) {
        this.removeCollectBubble(b)
      }
    }
    // 已销毁建筑的残留泡泡（建筑删除/清场时序差）兜底清理
    for (const [b, bubble] of [...this.collectBubbles]) {
      if (b.bPendingDestroy) {
        this.collectBubbles.delete(b)
        bubble.destroy()
      }
    }
  }

  /** 生成收集泡泡（建筑头顶，点击一键收集；widget 池里金矿/水库共用金币图标） */
  private spawnCollectBubble(b: ClashBuildingBaseActor) {
    const w = this.world
    if (!w || this.collectBubbles.has(b)) return
    // world 模式引擎忽略 target：传 null（多实例同名校验也不可靠），位姿 spawn 后显式 setPosition
    const handle = w.ui.spawnAnchoredWidget('asset/blueprints/ui/building_collect.widget.json', null, {
      mode: 'world',
      faceCamera: true,
      pxPerMeter: 350,
      pixelDensity: 2,
    })
    if (!handle) {
      logger.error(`[BaseGM] 收集泡泡生成失败: ${b.type.name}`)
      return
    }
    const bubbleActor = handle.actor
    if (!bubbleActor) {
      logger.error(`[BaseGM] 收集泡泡生成后即失效（pendingDestroy）: ${b.type.name}`)
      return
    }
    const top = b.actorLocation
    bubbleActor.getComponent(UITransformComponent)?.setPosition(top.x, top.y + (b.type.height + 0.15) / 2 + 0.9, top.z)
    this.collectBubbles.set(b, bubbleActor)
    logger.info(`[BaseGM] 收集泡泡已生成: ${b.type.name} (${b.gridX},${b.gridZ})`)
  }

  /** 销毁收集泡泡 */
  private removeCollectBubble(b: ClashBuildingBaseActor) {
    const bubble = this.collectBubbles.get(b)
    if (!bubble) return
    this.collectBubbles.delete(b)
    bubble.destroy()
    logger.info(`[BaseGM] 收集泡泡已移除: ${b.type.name} (${b.gridX},${b.gridZ})`)
  }

  // ════════════════════════════════════════════
  //  建筑升级面板
  // ════════════════════════════════════════════

  /** 打开建筑升级面板（buildingId 经 BuildingUpgradeState 暂存传入面板脚本） */
  openBuildingUpgradePanel(buildingId: string) {
    const w = this.world
    if (!w || this.buildingUpgradePanel) return
    BuildingUpgradeState.pendingBuildingId = buildingId

    // 退出选中/放置模式
    this.deselectBuilding()
    this.cancelPlaceMode()

    // 互斥关闭其他面板（信息牌一并关闭：升级面板打开后信息牌无意义）
    this.closeBuildingInfoPanel()
    this.closeMapPanel()
    if (this.barracksPanel) this.closeBarracksPanel()
    if (this.laboratoryPanel) this.closeLaboratoryPanel()
    if (this.tasksPanel) this.closeTasksPanel()
    if (this.gemShopPanel) this.closeGemShop()
    
    // 生成建筑升级面板
    const panel = w.ui.spawnUIActor('asset/blueprints/ui/building_upgrade.widget.json')
    if (!panel) {
      logger.error('[BaseGM] 建筑升级面板生成失败')
      return
    }
    
    this.buildingUpgradePanel = panel
    logger.info(`[BaseGM] 打开建筑升级面板: ${buildingId}`)
  }

  /** 关闭建筑升级面板 */
  closeBuildingUpgradePanel() {
    if (!this.buildingUpgradePanel) return
    this.buildingUpgradePanel.destroy()
    this.buildingUpgradePanel = null
    logger.info('[BaseGM] 关闭建筑升级面板')
  }

  // ════════════════════════════════════════════
  //  宝石商店面板
  // ════════════════════════════════════════════

  /** 切换宝石商店面板（HUD按钮调用） */
  toggleGemShop() {
    if (this.gemShopPanel) this.closeGemShop()
    else this.openGemShop()
  }

  /** 打开宝石商店面板 */
  private openGemShop() {
    const w = this.world
    if (!w || this.gemShopPanel) return
    
    // 退出建筑模式
    this.exitBuildMode()
    this.closeBuildingInfoPanel()
    
    // 互斥关闭其他面板
    this.closeMapPanel()
    if (this.barracksPanel) this.closeBarracksPanel()
    if (this.laboratoryPanel) this.closeLaboratoryPanel()
    if (this.tasksPanel) this.closeTasksPanel()
    if (this.buildingUpgradePanel) this.closeBuildingUpgradePanel()
    
    // 生成宝石商店面板
    const panel = w.ui.spawnUIActor('asset/blueprints/ui/gem_shop.widget.json')
    if (!panel) {
      logger.error('[BaseGM] 宝石商店面板生成失败')
      return
    }
    
    this.gemShopPanel = panel
    this.onGemShopChange?.(true)
    logger.info('[BaseGM] 打开宝石商店面板')
  }

  /** 关闭宝石商店面板 */
  closeGemShop() {
    if (!this.gemShopPanel) return
    this.gemShopPanel.destroy()
    this.gemShopPanel = null
    this.onGemShopChange?.(false)
    logger.info('[BaseGM] 关闭宝石商店面板')
  }

  /** 清理部落冲突建造系统资源 */
  private clearClashBase() {
    // 解除右键平移回调引用（防悬挂）
    this.baseCamera.rig.onRightPanStart = null
    // 解除持久化回调引用（防悬挂）
    this.onLayoutBuilt = null
    this.onLayoutChange = null
    // 地图构建器 EndPlay：注销对象注册表；装饰 Actor 由 World.DestroyAllActors 统一销毁
    this.baseBuilder?.EndPlay()
    this.baseBuilder = null
    this.previewComp = null
    this.previewMesh = null
    this.previewHost = null
    // PlaceGrid Actor 由 World.DestroyAllActors 统一销毁（其 LineComponent 自动释放线条资源）
    this.placeGridActor = null
    // 兵营面板是 UI Actor，由 World 销毁时 UIManager.destroyAll 统一销毁，这里只清引用
    this.barracksPanel = null
    this.laboratoryPanel = null
    this.tasksPanel = null
    this.buildingUpgradePanel = null
    this.gemShopPanel = null
    this.buildMenuPanel = null
    this.mapPanel = null
    // 信息牌/收集泡泡（场景 UI Actor）：场景销毁前主动销毁（spawnAnchoredWidget 顶层生成，不在 destroyAll 遗漏链上）
    this.buildingInfoPanel?.destroy()
    this.buildingInfoPanel = null
    this.buildingInfoTarget = null
    for (const bubble of this.collectBubbles.values()) bubble.destroy()
    this.collectBubbles.clear()
    // 暂存状态复位
    BuildingInfoState.currentBuildingId = ''
    BuildingUpgradeState.pendingBuildingId = ''
    // 存档菜单同理只清引用；模态标记复位（场景已销毁）
    this.saveMenuPanel = null
    this.uiModalOpen = false
    this.buildMode = false
    this.clashBuildings = []
    this.gridOccupied.clear()
    this.obstacleOccupied.clear()
    this.selectedType = null
    this.selectedBuilding = null
    this.lastDragKey = null
  }
}
