/**
 * tick — 快进 N 个游戏小时（每日边界触发日结算）
 */
import type { GMCommandDef } from '@/engine'
import type { Hoi4GameMode } from '../base/Hoi4GameMode'

export default {
  name: 'tick',
  description: '快进 N 个游戏小时（挂机等价，确定性）',
  params: [{ name: 'hours', type: 'int', required: true, desc: '小时数（24=一天）' }],
  handler: (ctx, hours) => {
    const mode = (ctx.gameInstance as unknown as { gameMode?: Hoi4GameMode }).gameMode
    if (!mode?.bootedFlag) return ctx.output('游戏未就绪')
    mode.gmStepHours(hours as number)
    ctx.output(`已推进 ${hours} 小时 → ${mode.dateText}`)
  },
} as GMCommandDef
