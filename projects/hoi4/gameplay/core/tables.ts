/**
 * tables — 配置表类型化访问（core 纯逻辑）
 *
 * 引擎侧（Hoi4ConfigLoader）从 ConfigRegistry 取原始 JSON 组装成 Hoi4Tables 传入 core；
 * 测试侧直接 import JSON 组装——core 自身不 import @/engine。
 */
import type {
  BattalionDef, BuildingDef, CombatParams, CountryDef, EquipmentDef, EventDef, FocusDef,
  LawDef, MapDef, SupportDef, TechDef, TemplateDef, TerrainDef, AiWeights,
} from './types'
import { MapData } from './MapData'

export interface Hoi4Tables {
  countries: Record<string, CountryDef>
  terrains: Record<string, TerrainDef>
  buildings: Record<string, BuildingDef>
  laws: { economy: LawDef[]; conscription: LawDef[]; trade: LawDef[] }
  equipments: Record<string, EquipmentDef>
  battalions: Record<string, BattalionDef>
  supports: Record<string, SupportDef>
  templates: Record<string, TemplateDef>
  techs: Record<string, TechDef>
  focuses: Record<string, FocusDef>
  events: Record<string, EventDef>
  combat: CombatParams
  aiWeights: AiWeights
}

export function makeTables(raw: {
  countries: Record<string, CountryDef>
  terrains: Record<string, TerrainDef>
  buildings: Record<string, BuildingDef>
  laws: { economy: LawDef[]; conscription: LawDef[]; trade: LawDef[] }
  equipments: Record<string, EquipmentDef>
  battalions: Record<string, BattalionDef>
  supports: Record<string, SupportDef>
  templates: Record<string, TemplateDef>
  techs: Record<string, TechDef>
  focuses: Record<string, FocusDef>
  events: Record<string, EventDef>
  combat: CombatParams
  aiWeights: AiWeights
}): Hoi4Tables {
  // 剥掉 _comment 等元键
  const strip = <T>(o: Record<string, T>): Record<string, T> => {
    const out: Record<string, T> = {}
    for (const [k, v] of Object.entries(o)) if (!k.startsWith('_')) out[k] = v
    return out
  }
  return {
    countries: strip(raw.countries),
    terrains: strip(raw.terrains),
    buildings: strip(raw.buildings),
    laws: raw.laws,
    equipments: strip(raw.equipments),
    battalions: strip(raw.battalions),
    supports: strip(raw.supports),
    templates: strip(raw.templates),
    techs: strip(raw.techs),
    focuses: strip(raw.focuses),
    events: strip(raw.events),
    combat: raw.combat,
    aiWeights: raw.aiWeights,
  }
}

/** 营分类科技加成取值（category 空字符串 = 全营加成） */
export function catMod(mods: Record<string, number>, category: string | undefined): number {
  return (category ? mods[category] ?? 0 : 0) + (mods[''] ?? 0)
}

/** 法律查找 */
export function findLaw(list: LawDef[], id: string): LawDef | null {
  return list.find((l) => l.id === id) ?? null
}

/** 地图定义 → 运行时 MapData（延迟 import 避免 core 互相循环；实际同模块无环） */
export function makeMapData(def: MapDef): MapData {
  return new MapData(def)
}
