/**
 * divs — 打印全部师的状态（省/路径/组织度/战斗）
 */
import type { GMCommandDef } from '@/engine'
import type { Hoi4GameMode } from '../base/Hoi4GameMode'
import type { Hoi4State } from '../core/types'

export default {
  name: 'divs',
  description: '打印全部师状态',
  params: [],
  handler: (ctx) => {
    const mode = (ctx.gameInstance as unknown as { gameMode?: Hoi4GameMode }).gameMode
    const state = mode?.coreState as Hoi4State | null
    if (!state) return ctx.output('游戏未就绪')
    const lines = Object.values(state.divisions).map((d) =>
      `#${d.id} ${d.owner} ${d.name} @省${d.province} 路径${d.path.length}段 进度${d.moveProgress.toFixed(0)}h org=${d.org.toFixed(0)} 战斗=${d.battle}${d.path.length ? ` →下一省${d.path[0]}` : ''}`,
    )
    ctx.output(lines.length ? lines.join('\n') : '无师')
  },
} as GMCommandDef
