/**
 * unitModelType — 编制 → 兵模类型（纯函数，零渲染依赖，可 vitest）
 *
 * 与 core 的分层铁律一致：只吃 TemplateDef + BattalionDef 表，吐枚举。
 * 判定按营数量投票，优先级：装甲 > 火炮 > 摩托化 > 步兵（对齐 HOI4
 * "师模型取主导兵种"的观感——4 营坦克混 4 营摩托化显示坦克）。
 */
import type { BattalionDef, TemplateDef } from '../core/types'

export type UnitModelType = 'infantry' | 'motorized' | 'artillery' | 'light_armor' | 'medium_armor'

export function divisionModelType(template: TemplateDef, battalions: Record<string, BattalionDef>): UnitModelType {
  let armor = 0
  let medium = 0
  let motorized = 0
  let artillery = 0
  for (const [id, count] of Object.entries(template.battalions)) {
    const cat = battalions[id]?.category
    if (cat === 'armor') {
      armor += count
      if (id === 'medium_armor') medium += count
    } else if (id === 'motorized') {
      motorized += count
    } else if (cat === 'artillery') {
      artillery += count
    }
  }
  if (armor >= 2) return medium > 0 ? 'medium_armor' : 'light_armor'
  if (artillery >= 3) return 'artillery'
  if (motorized >= 3) return 'motorized'
  return 'infantry'
}
