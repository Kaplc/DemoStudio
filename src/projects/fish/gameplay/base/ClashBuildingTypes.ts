/**
 * ClashBuildingTypes — 部落冲突建筑类型定义
 *
 * 建筑 = 蓝图资产（asset/blueprints/buildings/*.blueprint.json，结构 + ClashBuildingScript
 * 行为脚本），本文件只保留放置元数据：类型表与网格占用 key 等。
 */
export interface ClashBuildingType {
  /** 唯一 id（同时用于网格占用 key） */
  id: string
  /** 显示名 */
  name: string
  /** 主体立方体颜色（HUD 按钮/预览用） */
  color: number
  /** 主体底面尺寸（米） */
  size: number
  /** 主体高度（米） */
  height: number
  /** 放置占地格子数（N×N 格，网格吸附时以左下角为锚点） */
  footprint: number
  /** 建筑蓝图资产路径（结构 + ClashBuildingScript 行为脚本） */
  blueprint: string
}

/** 内置建筑类型表：城镇大厅/兵营/金矿/水库/防御塔/城墙 */
export const CLASH_BUILDING_TYPES: ClashBuildingType[] = [
  { id: 'townhall', name: '城镇大厅', color: 0xffd700, size: 1.6, height: 1.6, footprint: 2, blueprint: 'asset/blueprints/buildings/townhall.blueprint.json' },
  { id: 'barracks', name: '兵营', color: 0xe53935, size: 1.3, height: 1.0, footprint: 2, blueprint: 'asset/blueprints/buildings/barracks.blueprint.json' },
  { id: 'goldmine', name: '金矿', color: 0xfbc02d, size: 1.1, height: 0.9, footprint: 1, blueprint: 'asset/blueprints/buildings/goldmine.blueprint.json' },
  { id: 'elixir', name: '水库', color: 0x8e24aa, size: 1.1, height: 0.9, footprint: 1, blueprint: 'asset/blueprints/buildings/elixir.blueprint.json' },
  { id: 'cannon', name: '防御塔', color: 0x90a4ae, size: 1.0, height: 1.8, footprint: 1, blueprint: 'asset/blueprints/buildings/cannon.blueprint.json' },
  { id: 'wall', name: '城墙', color: 0x795548, size: 1.0, height: 0.6, footprint: 1, blueprint: 'asset/blueprints/buildings/wall.blueprint.json' },
]
