/**
 * occupy — 直接把省控制权交给玩家国（跳过战斗）
 */
import type { GMCommandDef } from '@/engine'
import type { Hoi4GameMode } from '../base/Hoi4GameMode'
import type { Hoi4State } from '../core/types'

export default {
  name: 'occupy',
  description: '把省份控制权交给玩家国 occupy(prov)',
  params: [{ name: 'prov', type: 'int', required: true, desc: '省份 id' }],
  handler: (ctx, prov) => {
    const mode = (ctx.gameInstance as unknown as { gameMode?: Hoi4GameMode }).gameMode
    const state = mode?.coreState as Hoi4State | null
    if (!state?.playerTag) return ctx.output('游戏未就绪或未选国')
    const pid = prov as number
    if (!mode!.map.province(pid)) return ctx.output(`省 ${pid} 不存在`)
    state.provinceControl[pid] = state.playerTag
    mode!.refreshColorLUT()
    ctx.output(`省 ${pid} 已归 ${state.playerTag}`)
  },
} as GMCommandDef
