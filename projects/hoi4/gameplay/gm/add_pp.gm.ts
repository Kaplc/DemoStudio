/**
 * add_pp — 政治点；give_equipment — 装备入库
 */
import type { GMCommandDef } from '@/engine'
import type { Hoi4GameMode } from '../base/Hoi4GameMode'
import type { Hoi4State } from '../core/types'

function playerState(mode: Hoi4GameMode | undefined | null): Hoi4State | null {
  const state = mode?.coreState as Hoi4State | null
  return state?.playerTag ? state : null
}

export const addPp: GMCommandDef = {
  name: 'add_pp',
  description: '给玩家国加政治点',
  params: [{ name: 'amount', type: 'int', required: true, desc: '政治点数量' }],
  handler: (ctx, amount) => {
    const mode = (ctx.gameInstance as unknown as { gameMode?: Hoi4GameMode }).gameMode
    const state = playerState(mode)
    if (!state) return ctx.output('游戏未就绪或未选国')
    const c = state.countries[state.playerTag!]
    c.pp += amount as number
    ctx.output(`政治点 +${amount} → ${Math.floor(c.pp)}`)
  },
} as GMCommandDef

export default addPp
