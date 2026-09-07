/**
 * window — 立即开启引力弹弓窗口（事件链路验证）
 */
import type { GMCommandDef } from '@/engine'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

export default {
  name: 'window',
  description: '立即开启引力窗口 window()（20s+加成）',
  params: [],
  handler: (ctx) => {
    const mode = (ctx.gameInstance as unknown as { gameMode?: WarmCurrentGameMode }).gameMode
    if (!mode) return ctx.output('游戏未就绪')
    mode.hazards.triggerWindow()
    ctx.output('引力窗口已开启')
  },
} as GMCommandDef
