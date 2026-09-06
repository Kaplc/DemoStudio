/**
 * speed — 设置时间流速（1-5）
 */
import type { GMCommandDef } from '@/engine'
import type { Hoi4GameMode } from '../base/Hoi4GameMode'

export default {
  name: 'speed',
  description: '设置时间流速（1-5）',
  params: [{ name: 'n', type: 'int', required: true, desc: '速度档位 1-5' }],
  handler: (ctx, n) => {
    const mode = (ctx.gameInstance as unknown as { gameMode?: Hoi4GameMode }).gameMode
    if (!mode?.bootedFlag) return ctx.output('游戏未就绪')
    mode.setSpeed(Math.min(5, Math.max(1, n as number)))
    mode.setPaused(false)
    ctx.output(`速度 ${mode.gameTime.speed}，已解除暂停`)
  },
} as GMCommandDef
