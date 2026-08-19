/**
 * TroopHealthBarComponent — 兵头顶 3D 血条组件（攻打战斗，己方兵种）
 *
 * 仿 BuildingHealthBarComponent 模式（组件优先，不塞进兵 Actor / GameMode）：
 *  - BeginPlay：创建背景条 + 前景条两个 Mesh 挂到兵 Actor（初始不可见）
 *  - onDamaged(ratio)：受击回调 —— 显示血条 → 刷新前景缩放/低血量变色 → 重置 1.5s 隐藏计时
 *  - Tick(dt)：隐藏倒计时，归零时直接隐藏
 *
 * 与建筑血条的差异：尺寸更小（宽 0.8 / 高 0.12）、隐藏超时更短（1.5s）、
 * 挂在兵 Actor 上随兵移动（attachTo 本地坐标自动跟随，含飞行兵）。
 * 组件随兵销毁自动释放（MeshComponent 机制）。
 *
 * 挂载方式（TroopActors.assembleTroop 统一装配）：
 *   actor.addComponent(new TroopHealthBarComponent(actor, troop))
 */
import * as THREE from 'three'
import { ActorComponent, GenericActor, BoxMeshComponent, spawnActor, logger, type Actor } from '@/engine'
import { createMesh, createBoxGeometry, createMeshStandardMaterial } from '@/engine/gameflow/ThreeObjectUtils'
import type { TroopType } from '../types'

/** 血条隐藏超时（秒）：受击后 1.5 秒无再受击自动隐藏（比建筑 3s 更短，兵更小更频繁） */
const BAR_HIDE_DELAY = 1.5
/** 背景条颜色（深色底） */
const BAR_BG_COLOR = 0x222222
/** 前景条正常颜色（绿） */
const BAR_FG_COLOR = 0x4caf50
/** 前景条低血量颜色（红，<30%） */
const BAR_LOW_COLOR = 0xe53935
/** 低血量阈值（比例） */
const BAR_LOW_RATIO = 0.3
/** 背景条宽/高（世界单位） */
const BAR_BG_W = 0.8
const BAR_BG_H = 0.12
/** 前景条宽/高（比背景窄一圈） */
const BAR_FG_W = 0.72
const BAR_FG_H = 0.09
/** 血条高度 = 兵模型高度上方偏移量（兵头顶） */
const BAR_TOP_OFFSET = 0.35

export class TroopHealthBarComponent extends ActorComponent {
  /** 前景条 MeshComponent（血量比例 scale.x 刷新） */
  private fgComp: BoxMeshComponent | null = null
  /** 背景条 MeshComponent（固定宽度） */
  private bgComp: BoxMeshComponent | null = null
  /** 隐藏倒计时（秒；>0 时血条可见） */
  private hideTimer = 0
  /** 当前是否显示 */
  private shown = false
  /** 兵种配置（血条高度 = 兵模型高度） */
  private readonly troop: TroopType

  constructor(owner: Actor, troop: TroopType) {
    super(owner)
    this.name = 'TroopHealthBarComponent'
    this.troop = troop
  }

  override BeginPlay(): void {
    const owner = this.owner
    // 血条位于兵模型头顶（本地坐标，attachTo 兵 Actor 随兵移动；飞行兵悬空同样适用）
    const barY = this.troop.size[1] + BAR_TOP_OFFSET
    // 一个 Actor 只能挂一个 mesh（组合网格拆子 Actor 约定，同建筑血条）
    const bgActor = new GenericActor('TroopHealthBarBg')
    const bgGeo = createBoxGeometry(BAR_BG_W, BAR_BG_H, 0.05)
    const bgMat = createMeshStandardMaterial({ color: BAR_BG_COLOR })
    const bgMesh = createMesh(bgGeo, bgMat)
    const bgComp = new BoxMeshComponent(bgActor, bgMesh, 'TroopHealthBarBg')
    bgActor.addComponent(bgComp)
    bgComp.mesh.position.y = barY
    bgActor.attachTo(owner)
    spawnActor(bgActor)
    // 前景条（绿色，左端锚定背景左端：geometry 平移使本地原点 = 左端 → scale.x 缩水时右端收缩）
    const fgActor = new GenericActor('TroopHealthBarFg')
    const fgGeo = createBoxGeometry(BAR_FG_W, BAR_FG_H, 0.05)
    const fgMat = createMeshStandardMaterial({ color: BAR_FG_COLOR })
    const fgMesh = createMesh(fgGeo, fgMat)
    const fgComp = new BoxMeshComponent(fgActor, fgMesh, 'TroopHealthBarFg')
    fgActor.addComponent(fgComp)
    fgComp.mesh.geometry.translate(BAR_FG_W / 2, 0, 0)
    fgComp.mesh.position.set(-BAR_BG_W / 2, barY, 0)
    fgActor.attachTo(owner)
    spawnActor(fgActor)
    this.bgComp = bgComp
    this.fgComp = fgComp
    // 初始隐藏（放兵时血条不常驻）
    this.applyVisible(false)
  }

  /** 受击回调（TroopHealthComponent.takeDamage 调用）：显示 + 刷新 + 重置隐藏计时 */
  onDamaged(ratio: number): void {
    const fgComp = this.fgComp
    if (!fgComp) return
    const fg = fgComp.mesh
    const r = Math.max(0, Math.min(1, ratio))
    // 前景缩放：左端对齐缩水（geometry 已平移）
    fg.scale.x = Math.max(0.001, r)
    // 低血量变红提示
    ;(fg.material as THREE.MeshBasicMaterial).color.setHex(r < BAR_LOW_RATIO ? BAR_LOW_COLOR : BAR_FG_COLOR)
    // 重置隐藏计时（每次受击重新计时 1.5 秒）
    this.hideTimer = BAR_HIDE_DELAY
    if (!this.shown) {
      this.shown = true
      this.applyVisible(true)
      logger.info(`[Battle] 兵 ${this.troop.name} 血条显示`)
    }
  }

  /** 每帧倒计时（由兵 Actor 的 Tick 驱动）：归零时直接隐藏 */
  override Tick(dt: number): void {
    if (!this.shown) return
    this.hideTimer -= dt
    if (this.hideTimer <= 0) {
      this.shown = false
      this.applyVisible(false)
      logger.info(`[Battle] 兵 ${this.troop.name} 血条隐藏（1.5 秒无受击）`)
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
    if (this.bgComp) this.bgComp.mesh.visible = visible
    if (this.fgComp) this.fgComp.mesh.visible = visible
  }
}
