/**
 * FishLevelGameMode — 关卡战斗 GameMode（攻打其他部落）
 *
 * 关卡场景 = 战斗场景：场景资产（fish_level1~3.scene.json）内置敌方基地
 * （type: ref 引用建筑蓝图，baseClass = ClashBuildingActors 各建筑类）。
 * 本 GameMode 接管战斗玩法：
 *
 *  1. BeginPlay 收集场景中的敌方建筑 → 建 hp 表 + 挂血条组件
 *     （BuildingHealthBarComponent：默认隐藏、受击显示、3s 超时隐藏）
 *  2. 战斗 HUD（battle_hud.widget.json，HUDClass）显示兵种卡片栏 + 已部署统计，
 *     BattleHudScript 绑定卡片点击 → selectTroop（放置模式）→ 点击战场放置
 *  3. 兵（每兵种一个 Actor 类 + 组件组合 AI）自动战斗：直线移动 / 被挡攻击阻挡物 / 远程站桩 /
 *     preferred 索敌 / 飞行兵越墙
 *  4. 防御塔：射程内自动攻击最近兵，弹丸（BattleProjectileActor）命中扣血
 *  5. 胜负：摧毁城镇大厅 = 胜；军队全灭 = 败（无时限）；战斗结束一次性掠夺入账
 *     （金矿 → 金币，水库 → 药水），弹出结算面板（battle_result.widget.json）
 *
 * 相机：复用 BaseCameraActor（透视 + 滚轮缩放 + 右键平移，关闭屏幕边缘平移），
 * 由 FishGameInstance.setupLevelPhase SpawnActor 托管并注册。
 */
import * as THREE from 'three'
import { GameMode, PhySys, logger, GameInstance, CapsuleMeshComponent, type Actor, spawnActor } from '@/engine'
import { BaseCameraActor } from '../base/BaseCameraActor'
import { CLASH_BUILDING_TYPES, type ClashBuildingType } from '../base/ClashBuildingTypes'
import { ClashBuildingBaseActor } from '../base/ClashBuildingActors'
import { PLACE_HALF } from '../base/ClashBaseBuilder'
import { FishLevelPlayerController } from './FishLevelPlayerController'
import { FishLevelPawn } from './FishLevelPawn'
import { PoolableTroopActor, type TroopActor } from '../battle/troops/TroopActors'
import { BuildingHealthBarComponent } from '../common/comp/BuildingHealthBarComponent'
import { TroopHealthBarComponent } from '../common/comp/TroopHealthBarComponent'
import { LootFlyFx } from '../common/fx/LootFlyFx'
import { GameEvents } from '../common/GameEvents'
import { BATTLE_TROOP_ATTACK } from '../battle/troops/TroopAttackComponent'
import type { TroopAttackEvent } from '../battle/troops/TroopAttackComponent'
import type { FishGameInstance } from '../FishGameInstance'
import type { TroopType, TroopPreferred } from '../common/types'
import { NavigationModule } from '@/engine/navigation/NavigationModule'
import { FishObjectPools } from '../game/FishObjectPools'

/** 地面平面（y=0），用于屏幕坐标 → 世界坐标求交（放兵点换算） */
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

/** 弹丸速度（世界单位/秒）：防御塔炮弹 / 远程箭矢 / 近战挥砍 */
const TOWER_PROJ_SPEED = 15
const RANGED_PROJ_SPEED = 20
const MELEE_PROJ_SPEED = 25

export class FishLevelGameMode extends GameMode {
  /** 战斗摄像机 Actor（与基地同款：透视 + 滚轮 + 右键平移，云台组件内聚） */
  readonly baseCamera: BaseCameraActor

  /** 寻路模块（A* 导航） */
  readonly navigation: NavigationModule

  /** 战斗弹丸对象池 */
  readonly pools: FishObjectPools

  /** 战斗 HUD 蓝图：兵种卡片栏 + 已部署统计 */
  override HUDClass = 'asset/blueprints/ui/battle_hud.widget.json'

  // ═══════════════════════════════════════
  //  战斗运行时状态
  // ═══════════════════════════════════════

  /** 敌方建筑列表（场景 ref 生成；摧毁后移出） */
  buildings: ClashBuildingBaseActor[] = []
  /** 建筑当前血量表：建筑 → hp（初始 = 类型表 hp） */
  private buildingHp = new Map<ClashBuildingBaseActor, number>()
  /** 建筑血条组件：建筑 → BuildingHealthBarComponent（受击显示 / 3s 超时隐藏自管） */
  private barCompMap = new Map<ClashBuildingBaseActor, BuildingHealthBarComponent>()
  /** 防御塔攻击冷却计时器：建筑 → 剩余秒数 */
  private cannonCooldown = new Map<ClashBuildingBaseActor, number>()
  /** 场上己方兵列表（死亡后移出） */
  private troops: TroopActor[] = []
  /** 兵的目标覆盖（被阻挡攻击阻挡物）：兵 → 目标建筑 */
  private troopTargetOverride = new Map<TroopActor, ClashBuildingBaseActor>()
  /** 当前放置模式选中的兵种（null = 未进入放置模式） */
  private selectedTroopId: string | null = null
  /** 战斗是否已结束（胜负已判：兵 AI / 防御塔停火） */
  battleEnded = false
  /** 掠夺是否已入账（同一次战斗只结算一次） */
  private lootSettled = false
  /** 已部署兵总数（HUD 统计） */
  private deployedCount = 0
  /** 掠夺金币累计（浮点，按伤害比例实时累计；展示取整） */
  private lootCoins = 0
  /** 掠夺药水累计（浮点，按伤害比例实时累计；展示取整） */
  private lootElixir = 0
  /** 每建筑已掠夺金币（浮点，摧毁时补发剩余用，保证总量恒等于类型表 loot） */
  private lootedCoinsByBuilding = new Map<ClashBuildingBaseActor, number>()
  /** 每建筑已掠夺药水（浮点，摧毁时补发剩余用） */
  private lootedElixirByBuilding = new Map<ClashBuildingBaseActor, number>()
  /** HUD 数字刷新回调（BattleHudScript 注册；飞行物到达时触发） */
  onLootDisplayChange: (() => void) | null = null
  /** 战斗结果（null = 未结束；true 胜 / false 败） */
  private winResult: boolean | null = null

  constructor() {
    super()
    // 透视相机俯瞰战场（FishGameInstance.setupLevelPhase 会再设位置 12,16,18）
    this.baseCamera = new BaseCameraActor()
    // 关闭屏幕边缘自动平移（部落冲突风格：滚轮缩放 + 右键平移）
    this.baseCamera.rig.setEdgePanEnabled(false)
    // 寻路模块
    this.navigation = new NavigationModule()
    // 战斗弹丸对象池
    this.pools = new FishObjectPools()
  }

  override InitGame() {
    super.InitGame()
    this.gameState.setPhase('waiting')
  }

  override StartPlay() {
    this.gameState.setPhase('playing')
  }

  override BeginPlay() {
    super.BeginPlay()
    // 战斗弹丸对象池注入 World
    this.pools.init(this.world!)
    // 收集场景中的敌方建筑（场景 ref 节点已 BeginPlay，网格已建好）
    this.collectBuildings()
    // 从静态碰撞体构建寻路网格（A* 导航依赖此网格）
    const blockedCount = this.navigation.grid.rebuildFromStaticColliders()
    logger.info(`[BattleGM] 战斗开始：敌方建筑 ${this.buildings.length} 个（城镇大厅 ${this.getTownhall() ? '在' : '无'}），寻路网格已构建（阻挡格 ${blockedCount} 个）`)

    // 订阅兵攻击事件 → 发射弹丸
    this._unsubTroopAttack = this.gameInstance?.events.on<TroopAttackEvent>(BATTLE_TROOP_ATTACK, (ev) => {
      this.fireTroopAttack(ev.troop, ev.target, ev.damage)
    }) ?? null
  }

  private _unsubTroopAttack: (() => void) | null = null

  override EndPlay() {
    this._unsubTroopAttack?.()
    // 解除相机右键平移回调引用（防悬挂）
    this.baseCamera.rig.onRightPanStart = null
    // 释放战斗弹丸对象池
    this.pools.releaseAll()
    // 拥有者自清理：销毁本 GameMode 构造的 baseCamera。
    // 相机已托管（setupLevelPhase SpawnActor）时走 World 销毁队列；未托管时
    // （如 ai.switchScene 裸切换不执行 extraSetup）由这里本地 EndPlay 回收，
    // 否则相机无 world 归属，reclaimForWorld 无法回收 → 永久泄漏。
    this.baseCamera?.destroy()
    // 建筑/兵/弹丸均为场景 Actor，由 World.DestroyAllActors 统一销毁，这里只清引用
    this.buildings = []
    this.buildingHp.clear()
    this.barCompMap.clear()
    this.cannonCooldown.clear()
    this.troops = []
    this.troopTargetOverride.clear()
    this.selectedTroopId = null
    this.lootedCoinsByBuilding.clear()
    this.lootedElixirByBuilding.clear()
    this.onLootDisplayChange = null
    this.battleEnded = false
    this.lootSettled = false
    super.EndPlay()
  }

  /** 战斗每帧逻辑：防御塔索敌开火（兵的 AI 在其 Actor.Tick 内） */
  override Tick(dt: number) {
    super.Tick(dt)
    if (this.battleEnded) return
    // ─── 防御塔：冷却 → 射程内最近兵 → 开火 ───
    for (const b of this.buildings) {
      const defense = b.type.defense
      if (!defense) continue
      const remain = (this.cannonCooldown.get(b) ?? 0) - dt
      this.cannonCooldown.set(b, Math.max(0, remain))
      if (remain > 0) continue
      const target = this.findNearestTroopInRange(b, defense.range)
      if (!target) continue
      // 开火：弹丸从塔顶飞向目标兵（命中扣血）
      this.cannonCooldown.set(b, defense.cooldown)
      const from = new THREE.Vector3(b.root.position.x, b.type.height + 0.5, b.root.position.z)
      const to = new THREE.Vector3(target.root.position.x, target.root.position.y + 0.5, target.root.position.z)
      this.pools.acquireProjectile({ gm: this, from, to, speed: TOWER_PROJ_SPEED, damage: defense.damage, color: 0x90a4ae, target })
      logger.info(`[BattleGM] 防御塔 @ (${b.root.position.x.toFixed(1)},${b.root.position.z.toFixed(1)}) 开火 → ${target.troop.name}`)
    }
    // ─── 失败判定：部署过兵且场上兵全灭、军队耗尽 → 败 ───
    if (this.deployedCount > 0 && this.troops.length === 0 && this.isArmyEmpty()) {
      this.finishBattle(false)
    }
  }

  override spawnPlayerInternal() {
    const controller = new FishLevelPlayerController()
    controller.gameMode = this
    const pawn = new FishLevelPawn()
    // 滚轮缩放 + 右键平移：把 controller 的输入组件绑定到战斗摄像机云台
    this.baseCamera.rig.bindInput(controller.inputComponent)
    // 相机平移边界与战场范围一致（±24）
    this.baseCamera.rig.panLimit = PLACE_HALF
    // Esc → 取消放置模式（不弹暂停菜单，战斗不中途暂停）
    controller.inputComponent.BindAction('battle-cancel', 'Escape', 'pressed', () => this.cancelPlaceMode())
    logger.info('[BattleGM] SpawnPlayer: controller 已创建（滚轮缩放/右键平移/长按连续放兵由 Controller 接管/Esc 取消放置）')
    return { controller, pawn }
  }

  // ═══════════════════════════════════════
  //  建筑收集 / 血条
  // ═══════════════════════════════════════

  /** 收集场景中的敌方建筑（ClashBuildingBaseActor 实例），建 hp 表并挂血条 */
  private collectBuildings(): void {
    const w = this.world
    if (!w) {
      logger.error('[BattleGM] 收集建筑失败：world 为空')
      return
    }
    for (const actor of w.actorMgr.GetAllActors()) {
      if (actor instanceof ClashBuildingBaseActor) {
        this.buildings.push(actor)
        this.buildingHp.set(actor, actor.type.hp)
        this.attachHealthBar(actor)
        if (actor.type.defense) this.cannonCooldown.set(actor, 0)
        logger.info(`[BattleGM] 敌方建筑: ${actor.type.name} @ (${actor.root.position.x.toFixed(1)},${actor.root.position.z.toFixed(1)}) hp=${actor.type.hp}`)
      }
    }
  }

  /**
   * 给建筑挂头顶 3D 血条（世界空间，跟随建筑）：
   * BuildingHealthBarComponent 全权自管（默认隐藏、受击显示、3s 超时隐藏），
   * 组件随建筑销毁自动释放（MeshComponent 机制）。
   */
  private attachHealthBar(b: ClashBuildingBaseActor): void {
    const comp = new BuildingHealthBarComponent(b)
    b.addComponent(comp)
    this.barCompMap.set(b, comp)
    // 开启 tick：驱动血条超时隐藏倒计时
    b.enableTick()
  }

  /** 建筑中心（世界坐标，x/z；兵索敌/碰撞用） */
  /** 给定目标输出建筑中心坐标（避免每帧 new Vector3） */
  buildingCenterInto(b: ClashBuildingBaseActor, out: THREE.Vector3): void {
    out.set(b.root.position.x, 0, b.root.position.z)
  }

  buildingCenter(b: ClashBuildingBaseActor): THREE.Vector3 {
    return new THREE.Vector3(b.root.position.x, 0, b.root.position.z)
  }

  /** 城镇大厅（胜利目标建筑；已摧毁返回 null） */
  private getTownhall(): ClashBuildingBaseActor | null {
    return this.buildings.find((b) => b.type.id === 'townhall') ?? null
  }

  // ═══════════════════════════════════════
  //  伤害 / 摧毁 / 掠夺
  // ═══════════════════════════════════════

  /** 建筑受伤（兵攻击弹丸命中结算统一入口）：扣血 → 按伤害比例实时掠夺 → 血条刷新 → 摧毁判定 */
  damageBuilding(b: ClashBuildingBaseActor, amount: number): void {
    if (!this.buildingHp.has(b) || this.battleEnded) return
    const before = this.buildingHp.get(b)!
    const hp = Math.max(0, before - amount)
    const dealt = before - hp // 实际扣血量（最后一击不超当前血）
    this.buildingHp.set(b, hp)
    // 血条组件：受击显示 + 刷新比例/颜色 + 重置 3s 隐藏计时
    this.barCompMap.get(b)?.onDamaged(hp / b.type.hp)
    // ─── 按伤害比例实时掠夺（浮点累计：金矿→金币、水库→圣水） ───
    const ratio = b.type.hp > 0 ? dealt / b.type.hp : 0
    const coinDelta = b.type.lootCoins * ratio
    const elixirDelta = b.type.lootElixir * ratio
    if (coinDelta > 0 || elixirDelta > 0) {
      this.lootCoins += coinDelta
      this.lootElixir += elixirDelta
      this.lootedCoinsByBuilding.set(b, (this.lootedCoinsByBuilding.get(b) ?? 0) + coinDelta)
      this.lootedElixirByBuilding.set(b, (this.lootedElixirByBuilding.get(b) ?? 0) + elixirDelta)
      // 每次伤害触发战利品飞行（金矿→金色圆点、水库→紫色圆点）
      this.triggerLootFly(b, coinDelta, elixirDelta)
    }
    logger.info(`[BattleGM] 建筑 ${b.type.name} 受击 -${Math.round(dealt)}（hp=${Math.round(hp)}/${b.type.hp}，掠夺 +${Math.round(coinDelta)}金 +${Math.round(elixirDelta)}水）`)
    if (hp <= 0) this.onBuildingDestroyed(b)
  }

  /**
   * 触发战利品飞行动画（建筑 → 顶部战利品栏）：
   * LootFlyFx 全权自管（投影/弧线/频控/销毁），到达时回调 onLootDisplayChange 刷新 HUD 数字。
   */
  private triggerLootFly(b: ClashBuildingBaseActor, coinDelta: number, elixirDelta: number): void {
    if (this.battleEnded) return
    const w = this.world
    if (!w) return
    const from = { x: b.root.position.x, y: b.type.height + 0.5, z: b.root.position.z }
    const onArrive = () => this.onLootDisplayChange?.()
    if (coinDelta > 0) LootFlyFx.show(w, from, 'coins', { onArrive })
    if (elixirDelta > 0) LootFlyFx.show(w, from, 'elixir', { onArrive })
  }

  /** 建筑摧毁：补发剩余掠夺 → 从列表移除 + 销毁 Actor + 胜利判定 */
  private onBuildingDestroyed(b: ClashBuildingBaseActor): void {
    // ─── 补发剩余掠夺（伤害比例已实时累计，摧毁时把余量补上，保证总量 = 类型表 loot） ───
    const remainCoins = Math.max(0, b.type.lootCoins - (this.lootedCoinsByBuilding.get(b) ?? 0))
    const remainElixir = Math.max(0, b.type.lootElixir - (this.lootedElixirByBuilding.get(b) ?? 0))
    if (remainCoins > 0 || remainElixir > 0) {
      this.lootCoins += remainCoins
      this.lootElixir += remainElixir
      this.triggerLootFly(b, remainCoins, remainElixir)
    }
    this.lootedCoinsByBuilding.delete(b)
    this.lootedElixirByBuilding.delete(b)
    this.buildings = this.buildings.filter((x) => x !== b)
    this.buildingHp.delete(b)
    this.barCompMap.delete(b)
    this.cannonCooldown.delete(b)
    // 清除以本建筑为目标的所有兵的目标覆盖
    for (const [troop, t] of this.troopTargetOverride) {
      if (t === b) this.troopTargetOverride.delete(troop)
    }
    b.destroy()
    logger.info(`[BattleGM] 建筑 ${b.type.name} 被摧毁（掠夺 +${Math.round(remainCoins)}金币 +${Math.round(remainElixir)}药水，剩余建筑 ${this.buildings.length}）`)
    // ─── 胜利判定：城镇大厅被摧毁 ───
    if (b.type.id === 'townhall') {
      this.finishBattle(true)
    }
  }

  // ═══════════════════════════════════════
  //  兵索敌（TroopTargetComponent.Tick 调用）
  // ═══════════════════════════════════════

  /**
   * 为兵选择当前目标：
   *  1. 目标覆盖（被阻挡攻击阻挡物）优先，且阻挡物存活
   *  2. 按 preferred 偏好过滤候选（resources → 金矿/水库，defenses → 防御塔，
   *     walls → 城墙，any → 全部）
   *  3. 候选中选最近建筑
   */
  getBestTargetFor(troop: TroopActor): ClashBuildingBaseActor | null {
    const override = this.troopTargetOverride.get(troop)
    if (override && !override.bPendingDestroy) return override
    if (override) this.troopTargetOverride.delete(troop)
    const candidates = this.buildings.filter((b) => this.matchPreferred(b.type.id, troop.troop.preferred))
    const list = candidates.length > 0 ? candidates : this.buildings
    if (list.length === 0) return null
    const pos = troop.root.position
    let best = list[0]
    let bestDist = Infinity
    for (const b of list) {
      const c = this.buildingCenter(b)
      const d = (c.x - pos.x) ** 2 + (c.z - pos.z) ** 2
      if (d < bestDist) {
        bestDist = d
        best = b
      }
    }
    return best
  }

  /** 建筑类型 id 是否命中兵种偏好 */
  private matchPreferred(buildingId: string, preferred: TroopPreferred): boolean {
    switch (preferred) {
      case 'resources': return buildingId === 'goldmine' || buildingId === 'elixir'
      case 'defenses': return buildingId === 'cannon'
      case 'walls': return buildingId === 'wall'
      case 'any':
      default: return true
    }
  }

  /** 设置兵的目标覆盖（被阻挡攻击阻挡物） */
  setTroopTargetOverride(troop: TroopActor, building: ClashBuildingBaseActor): void {
    this.troopTargetOverride.set(troop, building)
  }

  /** 地面兵移动后位置是否撞上阻挡建筑（AABB 相交，返回阻挡物；飞行兵不经此检测） */
  findBlockerAt(x: number, z: number, troopHalf: number): ClashBuildingBaseActor | null {
    for (const b of this.buildings) {
      if (!b.type.blocksGround) continue
      const half = b.type.size / 2
      const c = this.buildingCenter(b)
      if (Math.abs(x - c.x) < half + troopHalf && Math.abs(z - c.z) < half + troopHalf) return b
    }
    return null
  }

  /**
   * 兵攻击建筑（TroopAttackComponent 攻击节奏触发）：
   * 发射弹丸（近战 = 快速挥砍弹丸，远程 = 箭矢），命中后经 damageBuilding 扣血。
   */
  fireTroopAttack(troop: TroopActor, building: ClashBuildingBaseActor, damage: number): void {
    const w = this.world
    if (!w || this.battleEnded) return
    const isMelee = troop.troop.range <= 1
    const speed = isMelee ? MELEE_PROJ_SPEED : RANGED_PROJ_SPEED
    const from = new THREE.Vector3(troop.root.position.x, troop.root.position.y + 0.6, troop.root.position.z)
    const to = new THREE.Vector3(building.root.position.x, building.type.height / 2 + 0.3, building.root.position.z)
    this.pools.acquireProjectile({ gm: this, from, to, speed, damage, color: troop.troop.color, target: building })
    logger.info(`[BattleGM] ${troop.troop.name} 攻击 ${building.type.name}（伤害 ${Math.round(damage)}，${isMelee ? '近战挥砍' : '远程射击'}）`)
  }

  // ═══════════════════════════════════════
  //  防御塔索敌
  // ═══════════════════════════════════════

  /** 防御塔射程内最近存活兵（超射程不追击） */
  private findNearestTroopInRange(tower: ClashBuildingBaseActor, range: number): TroopActor | null {
    const c = this.buildingCenter(tower)
    let best: TroopActor | null = null
    let bestDist = range * range
    for (const t of this.troops) {
      if (t.health.isDead) continue
      const p = t.root.position
      const d = (p.x - c.x) ** 2 + (p.z - c.z) ** 2
      if (d <= bestDist) {
        bestDist = d
        best = t
      }
    }
    return best
  }

  // ═══════════════════════════════════════
  //  放兵交互（HUD 卡片选择 + 点击战场放置）
  // ═══════════════════════════════════════

  /** 兵种卡片点击：进入放置模式（再次点击同兵种取消） */
  selectTroop(troopId: string): void {
    if (this.battleEnded) return
    if (this.selectedTroopId === troopId) {
      this.cancelPlaceMode()
      return
    }
    this.selectedTroopId = troopId
    logger.info(`[BattleGM] 进入放置模式: ${troopId}`)
  }

  /** 取消放置模式（Esc / 再次点卡片） */
  cancelPlaceMode(): void {
    if (!this.selectedTroopId) return
    logger.info('[BattleGM] 取消放置模式')
    this.selectedTroopId = null
    // 长按连续放兵由 Controller 定时器驱动，其每次触发会检查 placeTroopId，
    // 此处置空后 Controller 自动停止（无需反向通知）
  }

  /** 当前放置模式兵种 id（HUD 卡片高亮判断） */
  get placeTroopId(): string | null {
    return this.selectedTroopId
  }

  /** 已部署兵总数（HUD 统计） */
  getDeployedCount(): number {
    return this.deployedCount
  }

  /** 场上存活兵数 */
  getAliveTroopCount(): number {
    return this.troops.length
  }

  /** 军队是否全部耗尽（训练组件：兵种数量全部为 0） */
  isArmyEmpty(): boolean {
    const inst = this.gameInstance
    return inst ? inst.training.isArmyEmpty() : true
  }

  /** 战斗 GameInstance（资源/训练组件跨阶段共享） */
  get gameInstance(): FishGameInstance | null {
    return GameInstance.current as FishGameInstance | null
  }

  /**
   * 鼠标按下（FishLevelPlayerController 转发，空地点击未被 Clickable 消费时到达）：
   * 放置模式下 → 立即放一个兵（长按连续放兵由 Controller 定时器驱动）。
   */
  onScreenDown(sx: number, sy: number): void {
    if (!this.selectedTroopId || this.battleEnded) return
    this.deployAtScreen(sx, sy)
  }

  /**
   * 按屏幕坐标放一个兵（Controller 首次按下/长按重复共用）：
   * 换算地面交点 → 校验 → 部署；silent=true（长按重复路径）时失败不刷 warn。
   */
  deployAtScreen(sx: number, sy: number, silent = false): boolean {
    if (!this.selectedTroopId || this.battleEnded) return false
    const ground = this.screenToGround(sx, sy)
    if (!ground) {
      if (!silent) logger.warn('[BattleGM] 部署失败：屏幕坐标未命中地面')
      return false
    }
    return this.spawnTroopActor(this.selectedTroopId, ground.x, ground.z, silent)
  }

  /** 屏幕坐标 → 地面交点（y=0 平面，放兵点换算） */
  private screenToGround(sx: number, sy: number): THREE.Vector3 | null {
    const raycaster = PhySys.screenToRay(sx, sy)
    if (!raycaster) return null
    const hit = new THREE.Vector3()
    raycaster.ray.intersectPlane(_groundPlane, hit)
    return hit
  }

  /** 建筑点击（ClashBuildingBaseActor 点击回调硬编码调用本方法；战斗无建造交互 → 空实现） */
  onBuildingClick(b: ClashBuildingBaseActor): void {
    // 战斗模式不响应建筑选中/移动（保留方法防止点击回调崩溃）
    logger.info(`[BattleGM] 敌方建筑 ${b.type.name} 被点击（无交互）`)
  }

  /**
   * 部署兵（onScreenDown / deployAtScreen / debugDeploy 统一入口）：
   * 校验（兵种/范围/重叠）→ 蓝图模型预检（严格模式：失败 = 放兵失败，
   * 军队不消耗、无兵生成）→ 扣军队 → 生成兵 Actor 并挂模型。
   * 部署成功**不退出放置模式**（CoC 风格：可连续放兵，直到 Esc / 再次点卡片取消）。
   * @param silent 长按重复路径静默（失败不刷 warn，避免按住非法位置日志刷屏）
   * @returns 是否部署成功
   */
  private spawnTroopActor(troopId: string, x: number, z: number, silent = false): boolean {
    if (this.battleEnded) return false
    const inst = this.gameInstance
    if (!inst) return false
    // 战场范围限制（±24）
    if (Math.abs(x) > PLACE_HALF || Math.abs(z) > PLACE_HALF) {
      if (!silent) logger.warn(`[BattleGM] 部署失败：超出战场范围 (${x.toFixed(1)},${z.toFixed(1)})`)
      return false
    }
    const troop = inst.getTroop(troopId)
    if (!troop) {
      if (!silent) logger.error(`[BattleGM] 部署失败：兵种 "${troopId}" 不存在（兵种表未加载或行缺失）`)
      return false
    }
    // 禁叠建筑（AABB 相交检查）
    if (this.findBlockerAt(x, z, troop.size[0] / 2)) {
      if (!silent) logger.warn(`[BattleGM] 部署失败：位置 (${x.toFixed(1)},${z.toFixed(1)}) 与建筑重叠`)
      return false
    }
    // 训练军队中扣除（先扣，acquire 失败则退回）
    if (!inst.training.deployTroop(troopId)) {
      if (!silent) logger.warn(`[BattleGM] 部署失败：军队无 "${troopId}"`)
      return false
    }
    // 从池 acquire 兵（mesh/collider 由池对象在 activate 时直接从蓝图 CDO 克隆，无需外部创建）
    let actor: PoolableTroopActor
    try {
      actor = this.pools.acquireTroop({ troopId, gm: this, troop, x, z })
    } catch (e) {
      if (!silent) logger.error(`[BattleGM] 部署失败：兵种池异常 "${troopId}" - ${e}`)
      return false
    }
    this.troops.push(actor as TroopActor)
    this.deployedCount++
    logger.info(`[BattleGM] 部署兵: ${troop.name} @ (${x.toFixed(1)},${z.toFixed(1)})（场上 ${this.troops.length} 个，累计 ${this.deployedCount}）`)
    return true
  }

  /**
   * 调试桥放兵（__fishBattle.deploy）：与 onScreenDown 同规则，
   * 但不走屏幕坐标换算，直接用世界坐标（Playwright 验证用）。
   */
  debugDeploy(troopId: string, x: number, z: number): boolean {
    return this.spawnTroopActor(troopId, x, z)
  }

  /** 血条组件显隐快照（__fishBattle.getHealthBars，Playwright 断言用） */
  getHealthBarStates(): Array<{ type: string; shown: boolean; hideTimer: number }> {
    return [...this.barCompMap.entries()].map(([b, comp]) => ({
      type: b.type.id,
      shown: comp.isShown(),
      hideTimer: Math.round(comp.getHideTimer() * 100) / 100,
    }))
  }

  /** 兵模型摘要（__fishBattle.getTroopModels，Playwright 断言胶囊体用） */
  getTroopModelSummary(): Array<{ name: string; geo: string; visible: boolean }> {
    return this.troops.map((t) => {
      const model = t.getChildren()[0]
      const mesh = model?.getComponent(CapsuleMeshComponent)
      const meshObj = mesh?.mesh
      return {
        name: t.troop.name,
        geo: meshObj ? meshObj.geometry.type : model ? model.constructor.name : 'none',
        visible: meshObj ? meshObj.visible : false,
      }
    })
  }

  /** 战斗状态快照（__fishBattle.getBattle，Playwright 断言用） */
  getBattleSnapshot(): Record<string, unknown> {    return {
      battleEnded: this.battleEnded,
      win: this.winResult,
      lootCoins: Math.round(this.lootCoins),
      lootElixir: Math.round(this.lootElixir),
      deployed: this.deployedCount,
      aliveTroops: this.troops.length,
      buildings: this.buildings.map((b) => ({
        type: b.type.id,
        hp: Math.round(this.buildingHp.get(b) ?? 0),
        maxHp: b.type.hp,
        x: Math.round(b.root.position.x * 10) / 10,
        z: Math.round(b.root.position.z * 10) / 10,
      })),
    }
  }

  // ═══════════════════════════════════════
  //  兵死亡 / 胜负判定 / 结算
  // ═══════════════════════════════════════

  /** 兵死亡回调（TroopHealthComponent.takeDamage → 本方法）：移出列表 + 失败判定 */
  onTroopDied(troop: TroopActor): void {
    this.troops = this.troops.filter((t) => t !== troop)
    this.troopTargetOverride.delete(troop)
    logger.info(`[BattleGM] 兵 ${troop.troop.name} 阵亡（场上剩余 ${this.troops.length} 个）`)
    // 失败判定：部署过兵且场上兵全灭、军队耗尽 → 败
    if (!this.battleEnded && this.deployedCount > 0 && this.troops.length === 0 && this.isArmyEmpty()) {
      this.finishBattle(false)
    }
  }

  /**
   * 战斗结束（胜利 = 摧毁城镇大厅；失败 = 军队全灭）：
   * 掠夺一次性入账（同一次战斗只结算一次）→ 弹出结算面板。
   */
  private finishBattle(win: boolean): void {
    if (this.battleEnded || this.lootSettled) return
    this.battleEnded = true
    this.winResult = win
    // ─── 掠夺入账：金矿金币 + 水库药水一次性发放 ───
    const inst = this.gameInstance
    if (!this.lootSettled) {
      this.lootSettled = true
      if (inst) {
        const coins = Math.round(this.lootCoins)
        const elixir = Math.round(this.lootElixir)
        if (coins > 0) inst.resources.add('coins', coins)
        if (elixir > 0) inst.resources.add('elixir', elixir)
      }
      logger.info(`[BattleGM] 战斗${win ? '胜利' : '失败'}：掠夺入账 +${Math.round(this.lootCoins)}金币 +${Math.round(this.lootElixir)}药水`)
    }
    this.gameState.setPhase('gameover')
    // ─── 结算面板 ───
    const w = this.world
    if (!w) return
    const panel = w.ui.spawnUIActor('asset/blueprints/ui/battle_result.widget.json')
    if (!panel) {
      logger.error('[BattleGM] 结算面板生成失败')
      return
    }
    logger.info(`[BattleGM] 结算面板已弹出（${win ? '胜利' : '失败'}）`)
  }

  /** 战斗结果快照（结算面板脚本读取） */
  getBattleResult(): { win: boolean | null; lootCoins: number; lootElixir: number } {
    return { win: this.winResult, lootCoins: Math.round(this.lootCoins), lootElixir: Math.round(this.lootElixir) }
  }

  /** 当前掠夺展示值（整数，HUD 顶部战利品栏 / 调试桥用） */
  getLootDisplay(): { coins: number; elixir: number } {
    return { coins: Math.round(this.lootCoins), elixir: Math.round(this.lootElixir) }
  }

  /** 兵血条状态快照（__fishBattle.getTroopHealthBars，Playwright 断言用） */
  getTroopHealthBarStates(): Array<{ name: string; hp: number; maxHp: number; shown: boolean; hideTimer: number }> {
    return this.troops.map((t) => {
      const bar = t.getComponent(TroopHealthBarComponent)
      return {
        name: t.troop.name,
        hp: Math.round(t.health.hp),
        maxHp: t.troop.hp,
        shown: bar?.isShown() ?? false,
        hideTimer: bar ? Math.round(bar.getHideTimer() * 100) / 100 : 0,
      }
    })
  }

  /** GM 调试命令（winLevel）：当前战斗直接判胜（等价摧毁城镇大厅的结算路径） */
  debugForceWin(): boolean {
    if (this.battleEnded) return false
    this.finishBattle(true)
    return true
  }

  /** GM 调试命令（clearEnemies）：清除当前战斗全部敌方建筑（掠夺不结算） */
  debugClearEnemies(): number {
    let cleared = 0
    // 快照遍历（onBuildingDestroyed 会修改 this.buildings，边遍历边删需拷贝）
    for (const b of [...this.buildings]) {
      cleared++
      this.buildings = this.buildings.filter((x) => x !== b)
      this.buildingHp.delete(b)
      this.barCompMap.delete(b)
      this.cannonCooldown.delete(b)
      b.destroy()
    }
    logger.info(`[BattleGM] GM 清敌: 已清除 ${cleared} 个敌方建筑`)
    return cleared
  }

  /** 兵种表（HUD 卡片数据） */
  getTroopTableData(): TroopType[] {
    const inst = this.gameInstance
    const table = inst?.getTroopTable()
    if (!table) return []
    return table.getRowNames().map((id) => table.getRow(id)!).filter(Boolean)
  }
}
