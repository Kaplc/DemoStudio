/**
 * ClashBuildingTypes — 部落冲突建筑类型定义
 *
 * 建筑 = 蓝图资产（asset/blueprints/buildings/*.blueprint.json，baseClass 引用具体 Actor 类，
 * 见 ClashBuildingActors.ts），本文件只保留放置元数据：类型表与网格占用 key 等。
 *
 * 战斗扩展字段（攻打其他部落玩法）：
 *  - hp：最大生命值（单一数据源，基地与敌方通用；基地建造场景不显示血条）
 *  - lootCoins / lootElixir：摧毁后掠夺入账的资源量（战斗结算时一次性发放）
 *  - defense：防御塔攻击参数（仅 cannon 有效）
 *  - blocksGround：地面兵是否被其阻挡（被挡则攻击阻挡物；飞行兵无视）
 */

/** 防御建筑攻击参数（防御塔 cannon 用） */
export interface ClashDefenseStats {
  /** 攻击射程（世界单位） */
  range: number
  /** 单发伤害 */
  damage: number
  /** 攻击间隔（秒） */
  cooldown: number
}

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
  /** 建筑蓝图资产路径（baseClass 引用具体 Actor 类） */
  blueprint: string
  /** 最大生命值（战斗用） */
  hp: number
  /** 摧毁后掠夺的金币量 */
  lootCoins: number
  /** 摧毁后掠夺的药水量 */
  lootElixir: number
  /** 防御攻击参数（仅防御塔设置） */
  defense?: ClashDefenseStats
  /** 地面兵是否被阻挡（城墙/建筑挡路；飞行兵无视） */
  blocksGround: boolean
  /** 点击基地内建筑是否打开专属面板（laboratory/obstacle；默认无面板走选中移动） */
  panel?: 'barracks' | 'laboratory' | 'obstacle'
  /** 拖动连放（按住左键拖过格子连续放置，如城墙圈地；默认单次点放） */
  continuous?: boolean
}

/** 内置建筑类型表：城镇大厅/兵营/金矿/水库/防御塔/城墙/实验室 */
export const CLASH_BUILDING_TYPES: ClashBuildingType[] = [
  { id: 'townhall', name: '城镇大厅', color: 0xffd700, size: 1.6, height: 1.6, footprint: 2, blueprint: 'asset/blueprints/buildings/townhall.blueprint.json', hp: 1000, lootCoins: 0, lootElixir: 0, blocksGround: true },
  { id: 'barracks', name: '兵营', color: 0xe53935, size: 1.3, height: 1.0, footprint: 2, blueprint: 'asset/blueprints/buildings/barracks.blueprint.json', hp: 400, lootCoins: 0, lootElixir: 0, blocksGround: true, panel: 'barracks' },
  { id: 'goldmine', name: '金矿', color: 0xfbc02d, size: 1.1, height: 0.9, footprint: 1, blueprint: 'asset/blueprints/buildings/goldmine.blueprint.json', hp: 200, lootCoins: 150, lootElixir: 0, blocksGround: true },
  { id: 'elixir', name: '水库', color: 0x8e24aa, size: 1.1, height: 0.9, footprint: 1, blueprint: 'asset/blueprints/buildings/elixir.blueprint.json', hp: 200, lootCoins: 0, lootElixir: 150, blocksGround: true },
  { id: 'cannon', name: '防御塔', color: 0x90a4ae, size: 1.0, height: 1.8, footprint: 1, blueprint: 'asset/blueprints/buildings/cannon.blueprint.json', hp: 350, lootCoins: 0, lootElixir: 0, defense: { range: 9, damage: 30, cooldown: 1.0 }, blocksGround: true },
  { id: 'wall', name: '城墙', color: 0x795548, size: 1.0, height: 0.6, footprint: 1, blueprint: 'asset/blueprints/buildings/wall.blueprint.json', hp: 250, lootCoins: 0, lootElixir: 0, blocksGround: true, continuous: true },
  { id: 'laboratory', name: '实验室', color: 0x26c6da, size: 1.4, height: 1.2, footprint: 2, blueprint: 'asset/blueprints/buildings/laboratory.blueprint.json', hp: 450, lootCoins: 0, lootElixir: 0, blocksGround: true, panel: 'laboratory' },
]

/** 按建筑类型 id 查类型行 */
export function findClashBuildingType(id: string): ClashBuildingType | undefined {
  return CLASH_BUILDING_TYPES.find((t) => t.id === id)
}
