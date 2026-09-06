/**
 * move — 全部己方空闲师移向目标省（搭战斗场景用）
 */
import type { GMCommandDef } from '@/engine'
import type { Hoi4GameMode } from '../base/Hoi4GameMode'
import type { Hoi4State } from '../core/types'
import { orderMove } from '../core/Military'

export default {
  name: 'move',
  description: '全部己方空闲师移向目标省 move(prov)',
  params: [{ name: 'prov', type: 'int', required: true, desc: '目标省 id' }],
  handler: (ctx, prov) => {
    const mode = (ctx.gameInstance as unknown as { gameMode?: Hoi4GameMode }).gameMode
    const state = mode?.coreState as Hoi4State | null
    if (!state?.playerTag) return ctx.output('游戏未就绪或未选国')
    const tables = mode!.getTables()
    const target = prov as number
    if (!mode!.map.province(target)) return ctx.output(`省 ${target} 不存在`)
    let n = 0
    for (const d of Object.values(state.divisions)) {
      if (d.owner === state.playerTag && d.battle === 0) {
        if (orderMove(state, tables, mode!.map, d, target)) n++
      }
    }
    mode!.markers?.sync()
    ctx.output(`已下令 ${n} 个师 → 省 ${target}`)
  },
} as GMCommandDef
