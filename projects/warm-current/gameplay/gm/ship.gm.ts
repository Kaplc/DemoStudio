/**
 * ship — 送空闲船（造船链路验证）
 */
import type { GMCommandDef } from '@/engine'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'
import { makeShip } from '../core/helpers'

export default {
  name: 'ship',
  description: '送空闲船 ship(count)',
  params: [{ name: 'count', type: 'int', required: false, desc: '数量（缺省 1）' }],
  handler: (ctx, count) => {
    const mode = (ctx.gameInstance as unknown as { gameMode?: WarmCurrentGameMode }).gameMode
    if (!mode) return ctx.output('游戏未就绪')
    const n = Number(count ?? 1)
    const s = mode.simState.state
    for (let i = 0; i < n; i++) s.ships.push(makeShip(s.ships.length + 1))
    ctx.output(`船只 → ${s.ships.length}`)
  },
} as GMCommandDef
