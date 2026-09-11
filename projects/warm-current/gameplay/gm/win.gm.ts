/**
 * win / sandbox — 直接胜利（模块已运回）与沙盒切换
 */
import type { GMCommandDef } from '@/engine'
import { B } from '../core/balance'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'
import { starPosAt } from '../core/helpers'

export default {
  name: 'win',
  description: '直接胜利 win()（模块运回，点亮全部环段）',
  params: [],
  handler: (ctx) => {
    const mode = (ctx.gameInstance as unknown as { gameMode?: WarmCurrentGameMode }).gameMode
    if (!mode) return ctx.output('游戏未就绪')
    const s = mode.simState.state
    s.module.state = 'delivered'
    s.ringSlots = B.ringSlots
    s.outcome = 'victory'
    mode.simState.events.push({ type: 'victory', ...starPosAt(s, 'earth') })
    ctx.output('全球环网建成（胜利结算面板应出现）')
  },
} as GMCommandDef
