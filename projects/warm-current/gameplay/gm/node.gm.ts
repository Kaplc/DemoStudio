/**
 * node — 直接解锁 N 个研究节点（跳三选一，推幕/推胜利链路验证）
 */
import type { GMCommandDef } from '@/engine'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'
import { B } from '../core/balance'

export default {
  name: 'node',
  description: '解锁研究节点 node(count)（自动推幕；上限 11，正式局交点由建设流点亮）',
  params: [{ name: 'count', type: 'int', required: false, desc: '数量（缺省 1）' }],
  handler: (ctx, count) => {
    const mode = (ctx.gameInstance as unknown as { gameMode?: WarmCurrentGameMode }).gameMode
    if (!mode) return ctx.output('游戏未就绪')
    const n = Number(count ?? 1)
    const s = mode.simState.state
    for (let i = 0; i < n && s.nodes < B.researchNodeCap; i++) s.nodes++
    ctx.output(`节点 → ${s.nodes}/12`)
  },
} as GMCommandDef
