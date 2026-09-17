/**
 * FishHouseActor — 基地海岛小屋 Actor
 *
 * 网格外观由 Blueprint 的 scene 字段引用 BeachHouseParts 场景资产生成，
 * 此类仅负责交互行为：点击检测、悬停高亮。
 *
 * clickZone / glow 等交互元素仍在此处程序化生成（不变）。
 * 继承 BuildingActor 基类：携带建筑显示名（buildingName）与放置占地格子数（footprint）。
 */
import * as THREE from 'three'
import { ClickableComponent, BoxMeshComponent, LineComponent, logger } from '@/engine'
import { createMeshBasicMaterial, createEdgesBox } from '@/engine/gameflow/ThreeObjectUtils'
import { BuildingActor } from './BuildingActor'

export class FishHouseActor extends BuildingActor {
  /** 不可见点击碰撞体组件 */
  protected clickZoneComp: BoxMeshComponent | null = null

  /** 悬停高亮线框组件 */
  protected glowComp: LineComponent | null = null

  /** 点击检测组件（自动由 PlayerController 基类调度） */
  protected clickable: ClickableComponent | null = null

  /** 点击事件回调 */
  onClaimCoins: (() => void) | null = null

  constructor(name = 'FishHouseActor') {
    super(name, '海岛小屋', 2)
  }

  // ═══════════════════════════════════
  //  生命周期
  // ═══════════════════════════════════

  override BeginPlay(): void {
    super.BeginPlay()
    this.buildClickZone()
    this.buildGlow()
    this.initClickable()
  }

  override EndPlay(): void {
    this.destroyHouse()
    super.EndPlay()
  }

  /**
   * 构建不可见点击碰撞体。
   * 子类可重写以调整大小/位置。
   */
  protected buildClickZone(): void {
    if (!this.world) return // 未 spawn 时不构建（编辑器预览路径）
    // BoxMeshComponent 内部默认创建 BoxGeometry（走 utils → GC 追踪），外部只需设尺寸 + 材质球
    this.clickZoneComp = this.addComponent(BoxMeshComponent, 'ClickZoneMesh')
    this.clickZoneComp.size = [2.4, 2.0, 2.4] // 触发 rebuild（保持 Inspector editable 同步）
    // 不可见材质球：colorWrite:false 不写颜色（视觉不可见），depthWrite:false 不写深度。
    // ⚠️ 不可用 visible=false 隐藏 mesh——ClickableComponent.hitTest 沿父链过滤
    // visible=false 的目标（隐藏物体不响应射线），隐藏后点击碰撞体将永远打不中。
    this.clickZoneComp.setMaterial(createMeshBasicMaterial({ colorWrite: false, depthWrite: false }))
    this.clickZoneComp.mesh.position.y = 1.2
    this.clickZoneComp.mesh.userData.isHouse = true
  }

  /**
   * 构建悬停高亮线框。
   * 子类可重写以调整大小/位置/颜色。
   */
  protected buildGlow(): void {
    if (!this.world) return
    // 阶段 1：构造 EdgesGeometry + 半透明 LineBasicMaterial（走 utils → GC 追踪）
    const obj = createEdgesBox(2.8, 2.4, 2.8, 0xffd700, true, 0.8)
    // 阶段 2：addComponent + 位置/可见性
    this.glowComp = this.addComponent(LineComponent, obj, 'GlowLine') as LineComponent
    this.glowComp.lines.position.y = 1.2
    this.glowComp.setVisible(false) // 默认隐藏（hover 显示）
  }

  // ═══════════════════════════════════
  //  ClickableComponent 初始化
  // ═══════════════════════════════════

  /** 创建并配置 ClickableComponent，将点击/悬停挂接到回调 */
  protected initClickable(): void {
    this.clickable = new ClickableComponent(this)
    this.clickable.clickCooldown = 500
    if (this.clickZoneComp) {
      this.clickable.setTargets([this.clickZoneComp.mesh])
    }

    // 点击 → 触发领金币
    this.clickable.onClick = () => {
      logger.debug(`[${this.name}] 房子被点击`)
      this.onClaimCoins?.()
    }

    // 悬停 → 控制高亮边框显隐
    this.clickable.onHover = (hit) => {
      if (this.glowComp) {
        this.glowComp.lines.visible = hit !== null
      }
    }

    this.addComponent(this.clickable)
  }

  /** 清理交互元素（组件 EndPlay 自动释放；网格场景子对象由 World.DestroyAllActors 自动清理） */
  private destroyHouse(): void {
    this.clickable = null
    this.glowComp = null
    this.clickZoneComp = null
  }
}
