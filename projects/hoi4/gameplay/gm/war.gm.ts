/**
 * war — 强制两国开战（跳过借口/战争目标，搭场景用）
 */
import type { GMCommandDef } from '@/engine'
import type { Hoi4GameMode } from '../base/Hoi4GameMode'
import type { Hoi4State } from '../core/types'

export default {
  name: 'war',
  description: '强制两国开战 war(a,b)',
  params: [
    { name: 'a', type: 'string', required: true, desc: '国家 tag' },
    { name: 'b', type: 'string', required: true, desc: '国家 tag' },
  ],
  handler: (ctx, a, b) => {
    const mode = (ctx.gameInstance as unknown as { gameMode?: Hoi4GameMode }).gameMode
    const state = mode?.coreState as Hoi4State | null
    if (!state) return ctx.output('游戏未就绪')
    const A = String(a).toUpperCase()
    const B = String(b).toUpperCase()
    if (!state.countries[A] || !state.countries[B]) return ctx.output('未知国家 tag')
    if (!state.countries[A].wars.includes(B)) { state.countries[A].wars.push(B); state.countries[B].wars.push(A) }
    ctx.output(`${A} 与 ${B} 已开战`)
  },
} as GMCommandDef
