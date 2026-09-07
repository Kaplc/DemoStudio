/**
 * win / sandbox — 直接胜利（模块已运回）与沙盒切换
 */
import type { GMCommandDef } from '@/engine'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'
import { B } from '../core/balance'

export default {
  name: 'win',
  description: '直接胜利 win()（模块运回，点亮 12 交点）',
  params: [],
  handler: (ctx) => {
    const mode = (ctx.gameInstance as unknown as { gameMode?: WarmCurrentGameMode }).gameMode
    if (!mode) return ctx.output('游戏未就绪')
    const s = mode.simState.state
    s.module.state = 'delivered'
    s.nodes = 12
    s.outcome = 'victory'
    mode.simState.events.push({ type: 'victory', x: B.map.nodes.earth.x, y: B.map.nodes.earth.y })
    ctx.output('全球环网建成（胜利结算面板应出现）')
  },
} as GMCommandDef
