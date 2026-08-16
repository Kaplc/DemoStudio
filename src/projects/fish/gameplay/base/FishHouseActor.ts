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
import { ClickableComponent, PrimitiveMeshComponent, LineComponent, type World, logger } from '@/engine'
import { BuildingActor } from './BuildingActor'

export class FishHouseActor extends BuildingActor {
  /** 不可见点击碰撞体 */
  protected clickZone: THREE.Mesh | null = null

  /** 悬停高亮线框 */
  protected glowWireframe: THREE.LineSegments | null = null

  /** 点击检测组件（自动由 PlayerController 基类调度） */
  protected clickable: ClickableComponent | null = null

  /** 点击事件回调 */
  onClaimCoins: (() => void) | null = null

  constructor(name = 'FishHouseActor') {
    // 建筑显示名与占地格子数（基类元数据）：海岛小屋占地约 2.4 世界单位 → 2×2 格
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
    const w = this.world as World
    this.clickZone = w.createInvisibleBox(2.4, 2.0, 2.4)
    this.clickZone.position.y = 1.2
    this.clickZone.userData.isHouse = true
    // MeshComponent 托管：挂 root + EndPlay 自动释放资源
    this.addComponent(new PrimitiveMeshComponent(this, this.clickZone, 'ClickZoneMesh'))
  }

  /**
   * 构建悬停高亮线框。
   * 子类可重写以调整大小/位置/颜色。
   */
  protected buildGlow(): void {
    const w = this.world as World
    this.glowWireframe = w.createEdgesBox(2.8, 2.4, 2.8, 0xffd700, true, 0.8)
    this.glowWireframe.position.y = 1.2
    this.glowWireframe.visible = false
    // LineComponent 托管：挂 root + EndPlay 自动释放资源
    this.addComponent(new LineComponent(this, this.glowWireframe, 'GlowLine'))
  }

  // ═══════════════════════════════════
  //  ClickableComponent 初始化
  // ═══════════════════════════════════

  /** 创建并配置 ClickableComponent，将点击/悬停挂接到回调 */
  protected initClickable(): void {
    this.clickable = new ClickableComponent(this)
    this.clickable.clickCooldown = 500
    if (this.clickZone) {
      this.clickable.setTargets([this.clickZone])
    }

    // 点击 → 触发领金币
    this.clickable.onClick = () => {
      logger.debug(`[${this.name}] 房子被点击`)
      this.onClaimCoins?.()
    }

    // 悬停 → 控制高亮边框显隐
    this.clickable.onHover = (hit) => {
      const hovering = hit !== null
      if (this.glowWireframe) {
        this.glowWireframe.visible = hovering
      }
    }

    this.addComponent(this.clickable)
  }

  /** 清理交互元素（clickZone/glowWireframe 由组件 EndPlay 自动释放；网格场景子对象由 World.DestroyAllActors 自动清理） */
  private destroyHouse(): void {
    // ClickableComponent 由 Actor.EndPlay 的 component 遍历自动清理
    this.clickable = null
    // clickZone / glowWireframe 由 MeshComponent / LineComponent 的 EndPlay 自动释放
    this.glowWireframe = null
    this.clickZone = null
  }
}
