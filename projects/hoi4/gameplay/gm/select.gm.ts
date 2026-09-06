/**
 * select — 切换玩家国家
 */
import type { GMCommandDef } from '@/engine'
import type { Hoi4GameMode } from '../base/Hoi4GameMode'
import type { Hoi4State } from '../core/types'

export default {
  name: 'select',
  description: '切换玩家国家 select(tag)',
  params: [{ name: 'tag', type: 'string', required: true, desc: '国家 tag' }],
  handler: (ctx, tag) => {
    const mode = (ctx.gameInstance as unknown as { gameMode?: Hoi4GameMode }).gameMode
    const state = mode?.coreState as Hoi4State | null
    if (!state) return ctx.output('游戏未就绪')
    const T = String(tag).toUpperCase()
    if (!state.countries[T]) return ctx.output('未知国家 tag')
    mode!.cmdSelectCountry(T)
    ctx.output(`玩家国家 → ${T}`)
  },
} as GMCommandDef
