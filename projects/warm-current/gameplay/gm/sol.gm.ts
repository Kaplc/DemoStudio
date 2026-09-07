/**
 * sol — 太阳系取景（GM）：sol [sun|earth|moon|europa|mars]
 * 天体清单单源于 core/balance 的 SOLAR_FOCUS_BODIES（与 focusSolarSystem 共用）。
 */
import type { GMCommandDef } from '@/engine'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'
import { SOLAR_FOCUS_BODIES } from '../core/balance'
import type { SolarFocusBody } from '../core/balance'

export default {
  name: 'sol',
  description: `太阳系取景 sol(body)：聚焦 ${SOLAR_FOCUS_BODIES.join('/')}（缺省 sun）`,
  params: [
    { name: 'body', type: 'string', required: false, desc: `天体名 ${SOLAR_FOCUS_BODIES.join('/')}` },
  ],
  handler: (ctx, body) => {
    const mode = (ctx.gameInstance as unknown as { gameMode?: WarmCurrentGameMode }).gameMode
    if (!mode) return ctx.output('游戏未就绪')
    const name = (body ?? 'sun') as SolarFocusBody
    if (!SOLAR_FOCUS_BODIES.includes(name)) {
      return ctx.output(`未知天体 "${body ?? ''}"（可选：${SOLAR_FOCUS_BODIES.join('/')}）`)
    }
    mode.focusSolarSystem(name)
    ctx.output(`镜头聚焦 → ${name}`)
  },
} as GMCommandDef
