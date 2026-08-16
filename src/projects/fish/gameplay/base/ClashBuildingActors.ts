/**
 * ClashBuildingActors — 部落冲突建筑 Actor 类（每个建筑一个类）
 *
 * 架构：
 *  - ClashBuildingBaseActor：抽象基类，通用构建逻辑（底座/主体网格、点击选中、金色高亮线框）
 *  - 6 个具体类（Townhall/Barracks/Goldmine/Elixir/Cannon/Wall）：只传类型 id，
 *    参数（名称/占地/颜色/尺寸）从 CLASH_BUILDING_TYPES 读取（单一数据源）
 *
 * 蓝图（asset/blueprints/buildings/*.blueprint.json）baseClass 引用具体类，
 * 生成的是类实例；结构（网格）默认由类在 BeginPlay 构建，蓝图不再声明 children。
 *
 * 去重约定：蓝图声明的组件（components/children）优先——类在 BeginPlay 创建前检查，
 * 已有 MeshComponent/子节点则不建网格、已有 LineComponent 不建高亮、已有
 * ClickableComponent 则复用只绑回调，保证「资产组件 + 代码组件」不重复。
 */
import * as THREE from 'three'
import { GenericActor, MeshComponent, PrimitiveMeshComponent, ClickableComponent, LineComponent, logger } from '@/engine'
import { BuildingActor } from './BuildingActor'
import { CLASH_BUILDING_TYPES, type ClashBuildingType } from './ClashBuildingTypes'
import type { FishBaseGameMode } from './FishBaseGameMode'

/** 建筑 Actor 抽象基类：网格构建 + 点击选中 + 金色高亮线框（通用逻辑） */
export abstract class ClashBuildingBaseActor extends BuildingActor {
  /** 建筑类型（构造时从类型表按 id 读取，单一数据源） */
  readonly type: ClashBuildingType
  /** 网格坐标（世界坐标 = 网格坐标，网格中心 0,0；以占地左下角为锚点） */
  gridX = 0
  gridZ = 0

  /** 选中高亮线框 */
  private glow: THREE.LineSegments | null = null
  /** 是否被选中 */
  private _selected = false

  constructor(name: string, typeId: string) {
    const type = CLASH_BUILDING_TYPES.find((t) => t.id === typeId)
    if (!type) throw new Error(`[ClashBuilding] 未知建筑类型 id: ${typeId}`)
    super(name, type.name, type.footprint)
    this.type = type
  }

  override BeginPlay(): void {
    super.BeginPlay()
    const w = this.world
    if (!w) return

    // ─── 去重约定：蓝图声明的组件（components/children）优先，类只补缺的 ───
    // 蓝图已建网格（MeshComponent/子节点）→ 类不再建底座/主体，避免重复 mesh
    // （MeshComponent 是抽象基类，运行时查派生实例用 instanceof 基类）
    const hasMeshes = this.getAllComponents().some((c) => c instanceof MeshComponent) || this.root.children.length > 0

    // ─── 底座（深色薄板，部落冲突建筑阴影盘风格）───
    // 一个 Actor 只能挂一个 mesh：底座挂自身，主体拆成子 Actor（组合网格约定）
    if (!hasMeshes) {
      const base = w.createBoxMesh(this.type.size + 0.5, 0.15, this.type.size + 0.5, 0x4e342e)
      base.position.y = 0.075
      this.addComponent(PrimitiveMeshComponent, base, 'BaseMesh')

      // ─── 主体（彩色立方体）→ 子 Actor（BodyMeshActor 挂 1 个 MeshComponent）───
      const bodyActor = new GenericActor('BodyMeshActor')
      const body = w.createBoxMesh(this.type.size, this.type.height, this.type.size, this.type.color)
      body.position.y = 0.15 + this.type.height / 2
      bodyActor.addComponent(PrimitiveMeshComponent, body, 'BodyMesh')
      bodyActor.attachTo(this)
      // BeginPlay 由父链传播（Actor.BeginPlay 递归 children）
    }

    // ─── 选中高亮线框（蓝图已声明 LineComponent 则不重复创建）───
    if (!this.getComponent(LineComponent)) {
      this.glow = w.createEdgesBox(this.type.size + 0.25, this.type.height + 0.25, this.type.size + 0.25, 0xffd700, true, 0.9)
      this.glow.position.y = 0.15 + this.type.height / 2
      this.glow.visible = false
      this.addComponent(LineComponent, this.glow, 'GlowLine')
    }

    // ─── 点击：蓝图已声明 ClickableComponent 则复用，只绑回调 ───
    let clickable = this.getComponent(ClickableComponent)
    if (!clickable) {
      clickable = new ClickableComponent(this)
      clickable.clickCooldown = 200
      this.addComponent(clickable)
    }
    clickable.onClick = () => {
      logger.info(`[Clash] 建筑 "${this.type.name}" 被点击 (${this.gridX},${this.gridZ})`)
      const mode = this.world?.gameMode as FishBaseGameMode | null
      mode?.onBuildingClick(this)
    }
  }

  /** 设置选中状态（GameMode 调用：显示/隐藏金色线框） */
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

// ════════════════════════════════════════════
//  具体建筑类（每个建筑一个类，参数从类型表读取）
// ════════════════════════════════════════════

/** 城镇大厅（占地 2×2） */
export class TownhallActor extends ClashBuildingBaseActor {
  constructor() {
    super('Townhall', 'townhall')
  }
}

/** 兵营（占地 2×2） */
export class BarracksActor extends ClashBuildingBaseActor {
  constructor() {
    super('Barracks', 'barracks')
  }
}

/** 金矿（占地 1×1） */
export class GoldmineActor extends ClashBuildingBaseActor {
  constructor() {
    super('Goldmine', 'goldmine')
  }
}

/** 水库（占地 1×1） */
export class ElixirActor extends ClashBuildingBaseActor {
  constructor() {
    super('Elixir', 'elixir')
  }
}

/** 防御塔（占地 1×1） */
export class CannonActor extends ClashBuildingBaseActor {
  constructor() {
    super('Cannon', 'cannon')
  }
}

/** 城墙（占地 1×1） */
export class WallActor extends ClashBuildingBaseActor {
  constructor() {
    super('Wall', 'wall')
  }
}

// 便捷引用：类型 id → 类（供注册表批量注册）
export const CLASH_BUILDING_ACTOR_CLASSES: Readonly<Record<string, new () => ClashBuildingBaseActor>> = {
  townhall: TownhallActor,
  barracks: BarracksActor,
  goldmine: GoldmineActor,
  elixir: ElixirActor,
  cannon: CannonActor,
  wall: WallActor,
}
