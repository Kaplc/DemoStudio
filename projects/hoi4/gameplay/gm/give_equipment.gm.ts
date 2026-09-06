/**
 * give_equipment — 玩家国装备入库
 */
import type { GMCommandDef } from '@/engine'
import type { Hoi4GameMode } from '../base/Hoi4GameMode'
import type { Hoi4State } from '../core/types'

export default {
  name: 'give_equipment',
  description: '给玩家国入库装备 give_equipment(id, n)',
  params: [
    { name: 'id', type: 'string', required: true, desc: '装备 id（如 infantry_equipment）' },
    { name: 'n', type: 'int', required: true, desc: '数量' },
  ],
  handler: (ctx, id, n) => {
    const mode = (ctx.gameInstance as unknown as { gameMode?: Hoi4GameMode }).gameMode
    const state = mode?.coreState as Hoi4State | null
    if (!state?.playerTag) return ctx.output('游戏未就绪或未选国')
    const c = state.countries[state.playerTag]
    c.equipmentStock[String(id)] = (c.equipmentStock[String(id)] ?? 0) + (n as number)
    ctx.output(`${id} +${n} → ${Math.floor(c.equipmentStock[String(id)])}`)
  },
} as GMCommandDef
