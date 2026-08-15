/**
 * BuildingHealthBarComponent — 建筑头顶 3D 血条组件（攻打战斗）
 *
 * 组件全权自管血条生命周期（组件优先原则，不塞进 FishLevelGameMode）：
 *  - BeginPlay：创建背景条 + 前景条两个 Mesh 挂到建筑 Actor（初始不可见）
 *  - onDamaged(ratio)：受击回调 —— 显示血条 → 刷新前景缩放/低血量变色 → 重置 3s 隐藏计时
 *  - Tick(dt)：隐藏倒计时，归零时直接隐藏（无淡入淡出动画）
 *
 * 所有建筑（城墙/防御塔/金矿/水库/城镇大厅）规则统一：默认隐藏、受击显示、
 * 3 秒未再受击自动隐藏。组件随建筑销毁自动释放（MeshComponent 机制）。
 *
 * 挂载方式（FishLevelGameMode.collectBuildings）：
 *   building.addComponent(new BuildingHealthBarComponent(building))
 */
import * as THREE from 'three'
import { ActorComponent, MeshComponent, logger } from '@/engine'
import type { ClashBuildingBaseActor } from '../../base/ClashBuildingActors'

/** 血条隐藏超时（秒）：受击后 3 秒无再受击自动隐藏 */
const BAR_HIDE_DELAY = 3
/** 背景条颜色（深色底） */
const BAR_BG_COLOR = 0x222222
/** 前景条正常颜色（绿） */
const BAR_FG_COLOR = 0x4caf50
/** 前景条低血量颜色（红，<30%） */
const BAR_LOW_COLOR = 0xe53935
/** 低血量阈值（比例） */
const BAR_LOW_RATIO = 0.3

export class BuildingHealthBarComponent extends ActorComponent {
  /** 前景条（血量比例 scale.x 刷新） */
  private fg: THREE.Mesh | null = null
  /** 背景条（固定宽度） */
  private bg: THREE.Mesh | null = null
  /** 隐藏倒计时（秒；>0 时血条可见） */
  private hideTimer = 0
  /** 当前是否显示 */
  private shown = false

  constructor(owner: ClashBuildingBaseActor) {
    super(owner)
    this.name = 'BuildingHealthBarComponent'
  }

  override BeginPlay(): void {
    const w = this.owner.world
    if (!w) return
    const building = this.owner as ClashBuildingBaseActor
    const barY = building.type.height + 0.9
    // 背景条（深色底，宽度固定）
    const bg = w.createBoxMesh(1.4, 0.18, 0.05, BAR_BG_COLOR)
    bg.position.y = barY
    this.owner.addComponent(new MeshComponent(this.owner, bg, 'HealthBarBg'))
    // 前景条（绿色，左端对齐：geometry 平移 +0.65 → 缩放 x 时左端不动）
    const fg = w.createBoxMesh(1.3, 0.14, 0.06, BAR_FG_COLOR)
    fg.geometry.translate(0.65, 0, 0)
    fg.position.y = barY
    this.owner.addComponent(new MeshComponent(this.owner, fg, 'HealthBarFg'))
    this.bg = bg
    this.fg = fg
    // 初始隐藏（战斗开始血条不常驻）
    this.applyVisible(false)
  }

  /** 受击回调（FishLevelGameMode.damageBuilding 调用）：显示 + 刷新 + 重置隐藏计时 */
  onDamaged(ratio: number): void {
    const fg = this.fg
    if (!fg) return
    const r = Math.max(0, Math.min(1, ratio))
    // 前景缩放：左端对齐缩水（geometry 已平移）
    fg.scale.x = Math.max(0.001, r)
    // 低血量变红提示
    ;(fg.material as THREE.MeshBasicMaterial).color.setHex(r < BAR_LOW_RATIO ? BAR_LOW_COLOR : BAR_FG_COLOR)
    // 重置隐藏计时（每次受击重新计时 3 秒）
    this.hideTimer = BAR_HIDE_DELAY
    if (!this.shown) {
      this.shown = true
      this.applyVisible(true)
      logger.info(`[Battle] 建筑 ${(this.owner as ClashBuildingBaseActor).type.name} 血条显示`)
    }
  }

  /** 每帧倒计时（由建筑 Actor 的 Tick 驱动）：归零时直接隐藏 */
  override Tick(dt: number): void {
    if (!this.shown) return
    this.hideTimer -= dt
    if (this.hideTimer <= 0) {
      this.shown = false
      this.applyVisible(false)
      logger.info(`[Battle] 建筑 ${(this.owner as ClashBuildingBaseActor).type.name} 血条隐藏（3 秒无受击）`)
    }
  }

  /** 当前是否显示（Playwright 断言用） */
  isShown(): boolean {
    return this.shown
  }

  /** 剩余隐藏倒计时秒数（Playwright 断言用） */
  getHideTimer(): number {
    return this.hideTimer
  }

  /** 统一显隐（bg + fg） */
  private applyVisible(visible: boolean): void {
    if (this.bg) this.bg.visible = visible
    if (this.fg) this.fg.visible = visible
  }
}
