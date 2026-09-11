/**
 * node — 直接建成 N 个环段槽位（推幕/推胜利链路验证；正式局槽位由建设流交付）
 */
import type { GMCommandDef } from '@/engine'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'
import { B } from '../core/balance'

export default {
  name: 'node',
  description: '直接建成环段 node(count)（自动推幕；上限 ringSlots，正式局由建设流交付）',
  params: [{ name: 'count', type: 'int', required: false, desc: '数量（缺省 1）' }],
  handler: (ctx, count) => {
    const mode = (ctx.gameInstance as unknown as { gameMode?: WarmCurrentGameMode }).gameMode
    if (!mode) return ctx.output('游戏未就绪')
    const n = Number(count ?? 1)
    const s = mode.simState.state
    for (let i = 0; i < n && s.ringSlots < B.ringSlots; i++) s.ringSlots++
    ctx.output(`环段 → ${s.ringSlots}/${B.ringSlots}`)
  },
} as GMCommandDef
