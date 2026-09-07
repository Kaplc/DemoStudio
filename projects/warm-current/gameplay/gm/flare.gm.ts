/**
 * flare — 立即触发太阳耀斑（事件链路验证）
 */
import type { GMCommandDef } from '@/engine'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

export default {
  name: 'flare',
  description: '立即触发太阳耀斑 flare()（15s）',
  params: [],
  handler: (ctx) => {
    const mode = (ctx.gameInstance as unknown as { gameMode?: WarmCurrentGameMode }).gameMode
    if (!mode) return ctx.output('游戏未就绪')
    mode.hazards.triggerFlare()
    ctx.output('耀斑已触发')
  },
} as GMCommandDef
