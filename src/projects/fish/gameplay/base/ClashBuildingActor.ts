/**
 * ClashBuildingActor — 部落冲突风格建筑 Actor（铺鱼达人基地玩法）
 *
 * 建筑 = 彩色立方体（无需细节），底座 + 主体 + 选中高亮线框。
 * 点击检测由 ClickableComponent 提供（PhySys 射线分发），
 * 点击回调转发给 GameMode 的建造系统（选中/删除）。
 */
import * as THREE from 'three'
import { GenericActor, MeshComponent, ClickableComponent, LineComponent, logger } from '@/engine'

/** 部落冲突建筑类型定义（不同颜色/尺寸立方体） */
export interface ClashBuildingType {
  /** 唯一 id（同时用于网格占用 key） */
  id: string
  /** 显示名 */
  name: string
  /** 主体立方体颜色 */
  color: number
  /** 主体底面尺寸（米） */
  size: number
  /** 主体高度（米） */
  height: number
}

/** 内置建筑类型表：城镇大厅/兵营/金矿/水库/防御塔/城墙 */
export const CLASH_BUILDING_TYPES: ClashBuildingType[] = [
  { id: 'townhall', name: '城镇大厅', color: 0xffd700, size: 1.6, height: 1.6 },
  { id: 'barracks', name: '兵营', color: 0xe53935, size: 1.3, height: 1.0 },
  { id: 'goldmine', name: '金矿', color: 0xfbc02d, size: 1.1, height: 0.9 },
  { id: 'elixir', name: '水库', color: 0x8e24aa, size: 1.1, height: 0.9 },
  { id: 'cannon', name: '防御塔', color: 0x90a4ae, size: 1.0, height: 1.8 },
  { id: 'wall', name: '城墙', color: 0x795548, size: 1.0, height: 0.6 },
]

export class ClashBuildingActor extends GenericActor {
  /** 建筑类型 */
  readonly type: ClashBuildingType
  /** 网格坐标（世界坐标 = 网格坐标，网格中心 0,0） */
  gridX: number
  gridZ: number

  /** 选中高亮线框 */
  private glow: THREE.LineSegments | null = null
  /** 是否被选中 */
  private _selected = false
  /** 点击回调（GameMode 设置：选中/取消） */
  onSelect: ((b: ClashBuildingActor) => void) | null = null

  constructor(name: string, type: ClashBuildingType, gridX: number, gridZ: number) {
    super(name)
    this.type = type
    this.gridX = gridX
    this.gridZ = gridZ
  }

  override BeginPlay(): void {
    super.BeginPlay()
    const w = this.world
    if (!w) return

    // ─── 底座（深色薄板，部落冲突建筑阴影盘风格）───
    const base = w.createBoxMesh(this.type.size + 0.5, 0.15, this.type.size + 0.5, 0x4e342e)
    base.position.y = 0.075
    this.addComponent(new MeshComponent(this, base, 'BaseMesh'))

    // ─── 主体（彩色立方体）───
    const body = w.createBoxMesh(this.type.size, this.type.height, this.type.size, this.type.color)
    body.position.y = 0.15 + this.type.height / 2
    this.addComponent(new MeshComponent(this, body, 'BodyMesh'))

    // ─── 选中高亮线框（LineComponent 托管：挂 root + EndPlay 自动释放资源）───
    this.glow = w.createEdgesBox(this.type.size + 0.25, this.type.height + 0.25, this.type.size + 0.25, 0xffd700, true, 0.9)
    this.glow.position.y = 0.15 + this.type.height / 2
    this.glow.visible = false
    this.addComponent(new LineComponent(this, this.glow, 'GlowLine'))

    // ─── 点击：选中/取消选中 ───
    const clickable = new ClickableComponent(this)
    clickable.clickCooldown = 200
    clickable.onClick = () => {
      logger.info(`[Clash] 建筑 ${this.name} 被点击 (${this.gridX},${this.gridZ})`)
      this.onSelect?.(this)
    }
    this.addComponent(clickable)
  }

  /** 设置选中状态（显示/隐藏金色线框） */
  setSelected(selected: boolean): void {
    this._selected = selected
    if (this.glow) this.glow.visible = selected
  }

  get selected(): boolean {
    return this._selected
  }

  override EndPlay(): void {
    // glow 由 LineComponent.EndPlay 自动释放 geometry/material
    this.glow = null
    super.EndPlay()
  }
}
