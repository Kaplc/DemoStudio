/**
 * h3 — 加地球储量（负数扣减）
 */
import type { GMCommandDef } from '@/engine'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

export default {
  name: 'h3',
  description: '加/扣地球 H3 储量 h3(amount)',
  params: [{ name: 'amount', type: 'float', required: true, desc: '吨（负数扣）' }],
  handler: (ctx, amount) => {
    const mode = (ctx.gameInstance as unknown as { gameMode?: WarmCurrentGameMode }).gameMode
    if (!mode) return ctx.output('游戏未就绪')
    mode.simState.state.earthH3 = Math.max(0, mode.simState.state.earthH3 + Number(amount))
    ctx.output(`储量 → ${mode.simState.state.earthH3.toFixed(0)} t`)
  },
} as GMCommandDef
