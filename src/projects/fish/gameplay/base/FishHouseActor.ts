/**
 * FishHouseActor — 基地海岛小屋 Actor
 *
 * 茅草屋顶的沙滩小屋风格，
 * 通过 ClickableComponent 提供点击/悬停检测，
 * 子类可重写 buildHouse() 自定义房子外观。
 */
import * as THREE from 'three'
import { Actor, ClickableComponent, logger } from '@/engine'

export class FishHouseActor extends Actor {
  /** 房子各部分的 Mesh 列表（用于统一清理） */
  protected houseMeshes: THREE.Mesh[] = []

  /** 不可见点击碰撞体 */
  protected clickZone: THREE.Mesh | null = null

  /** 悬停高亮线框 */
  protected glowWireframe: THREE.LineSegments | null = null

  /** 点击检测组件（自动由 PlayerController 基类调度） */
  protected clickable: ClickableComponent | null = null

  /** 点击事件回调 */
  onClaimCoins: (() => void) | null = null

  constructor(name = 'FishHouseActor') {
    super(name)
  }

  // ═══════════════════════════════════
  //  生命周期
  // ═══════════════════════════════════

  override BeginPlay(): void {
    super.BeginPlay()
    this.buildHouse()
    this.buildClickZone()
    this.buildGlow()
    this.initClickable()
  }

  override EndPlay(): void {
    this.destroyHouse()
    super.EndPlay()
  }

  // ═══════════════════════════════════
  //  海岛小屋构建（子类可重写）
  // ═══════════════════════════════════

  protected buildHouse(): void {
    // ─── 木制地板平台 ───
    const floorMat = new THREE.MeshBasicMaterial({ color: 0xa67c52 })
    const floor = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.15, 2.4), floorMat)
    floor.position.y = 0.3
    this.addHouseMesh(floor)

    // ─── 竹制墙壁（浅色） ───
    const wallMat = new THREE.MeshBasicMaterial({
      color: 0xc9b99a,
      transparent: true,
      opacity: 0.9,
    })
    const wall = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.4, 2.0), wallMat)
    wall.position.y = 1.0
    this.addHouseMesh(wall)

    // ─── 茅草屋顶（两层，暖色） ───
    const thatchMat = new THREE.MeshBasicMaterial({
      color: 0x8b6f47,
      transparent: true,
      opacity: 0.9,
    })
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.3, 2.6), thatchMat)
    roof.position.y = 1.75
    this.addHouseMesh(roof)

    const roofTopMat = new THREE.MeshBasicMaterial({
      color: 0x6d4c41,
    })
    const roofTop = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.2, 2.0), roofTopMat)
    roofTop.position.y = 2.0
    this.addHouseMesh(roofTop)

    // ─── 门（开口） ───
    const doorMat = new THREE.MeshBasicMaterial({ color: 0x5d4037 })
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.05), doorMat)
    door.position.set(0, 0.65, 1.01)
    this.addHouseMesh(door)

    // ─── 窗户 ───
    const winMat = new THREE.MeshBasicMaterial({
      color: 0x81d4fa,
      transparent: true,
      opacity: 0.7,
    })
    const winL = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.05), winMat)
    winL.position.set(-0.6, 1.1, 1.01)
    this.addHouseMesh(winL)

    const winR = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.05), winMat)
    winR.position.set(0.6, 1.1, 1.01)
    this.addHouseMesh(winR)

    // ─── 门廊支柱 ───
    const pillarMat = new THREE.MeshBasicMaterial({ color: 0x8d6e63 })
    const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.8, 0.08), pillarMat)
    p1.position.set(-1.1, 1.1, 1.1)
    this.addHouseMesh(p1)
    const p2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.8, 0.08), pillarMat)
    p2.position.set(1.1, 1.1, 1.1)
    this.addHouseMesh(p2)
    const p3 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.8, 0.08), pillarMat)
    p3.position.set(-1.1, 1.1, -1.1)
    this.addHouseMesh(p3)
    const p4 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.8, 0.08), pillarMat)
    p4.position.set(1.1, 1.1, -1.1)
    this.addHouseMesh(p4)

    // ─── 房梁（横跨屋顶） ───
    const beamMat = new THREE.MeshBasicMaterial({ color: 0x6d4c41 })
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, 0.06), beamMat)
    beam.position.y = 2.1
    this.addHouseMesh(beam)
  }

  /**
   * 构建不可见点击碰撞体。
   * 子类可重写以调整大小/位置。
   */
  protected buildClickZone(): void {
    const geo = new THREE.BoxGeometry(2.4, 2.0, 2.4)
    const mat = new THREE.MeshBasicMaterial({
      visible: false,
      depthWrite: false,
    })
    this.clickZone = new THREE.Mesh(geo, mat)
    this.clickZone.position.y = 1.2
    this.clickZone.userData.isHouse = true
    this.root.add(this.clickZone)
  }

  /**
   * 构建悬停高亮线框。
   * 子类可重写以调整大小/位置/颜色。
   */
  protected buildGlow(): void {
    const glowGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(2.8, 2.4, 2.8))
    const glowMat = new THREE.LineBasicMaterial({
      color: 0xffd700,
      transparent: true,
      opacity: 0.8,
    })
    this.glowWireframe = new THREE.LineSegments(glowGeo, glowMat)
    this.glowWireframe.position.y = 1.2
    this.glowWireframe.visible = false
    this.root.add(this.glowWireframe)
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

  // ═══════════════════════════════════
  //  工具方法
  // ═══════════════════════════════════

  /** 向房子添加一个 Mesh 部件（自动受生命周期管理） */
  protected addHouseMesh(mesh: THREE.Mesh): void {
    this.houseMeshes.push(mesh)
    this.root.add(mesh)
  }

  /** 清理所有房子资源 */
  private destroyHouse(): void {
    // ClickableComponent 由 Actor.EndPlay 的 component 遍历自动清理
    this.clickable = null

    // 清除高亮线框
    if (this.glowWireframe) {
      this.root.remove(this.glowWireframe)
      this.glowWireframe.geometry.dispose()
      ;(this.glowWireframe.material as THREE.LineBasicMaterial).dispose()
      this.glowWireframe = null
    }

    // 清除点击区域
    if (this.clickZone) {
      this.root.remove(this.clickZone)
      this.clickZone.geometry.dispose()
      ;(this.clickZone.material as THREE.MeshBasicMaterial).dispose()
      this.clickZone = null
    }

    // 清除房子 Mesh
    for (const mesh of this.houseMeshes) {
      this.root.remove(mesh)
      mesh.geometry.dispose()
      if (mesh.material) {
        const mat = mesh.material
        if (Array.isArray(mat)) {
          mat.forEach((m) => m.dispose())
        } else {
          mat.dispose()
        }
      }
    }
    this.houseMeshes = []

    logger.debug(`[${this.name}] 房子资源已清理`)
  }
}
