/**
 * BuildingActor — 建筑物基类（基地/建造类玩法的通用建筑）
 *
 * 提供所有建筑共有的元数据：
 *  - buildingName：建筑显示名（区别于 Actor 实例名 name）
 *  - footprint：放置占地格子数（N×N 格，网格吸附时以左下角为锚点）
 *
 * 渲染/点击/选中等表现由各子类实现（如 ClashBuildingActor 用彩色立方体）。
 */
import { GenericActor } from '@/engine'

export class BuildingActor extends GenericActor {
  /** 建筑显示名（如"城镇大厅"，与实例名 name 分离） */
  readonly buildingName: string
  /** 放置占地格子数（N×N 格，整数；1 = 单格建筑） */
  readonly footprint: number

  constructor(name: string, buildingName: string, footprint: number) {
    super(name)
    this.buildingName = buildingName
    this.footprint = footprint
  }
}
