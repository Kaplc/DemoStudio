/**
 * status — 打印玩家国概况（调试对拍）
 */
import type { GMCommandDef } from '@/engine'
import type { Hoi4GameMode } from '../base/Hoi4GameMode'
import type { Hoi4State } from '../core/types'

export default {
  name: 'status',
  description: '打印整局概况（日期/玩家国/师数/战斗数）',
  params: [],
  handler: (ctx) => {
    const mode = (ctx.gameInstance as unknown as { gameMode?: Hoi4GameMode }).gameMode
    const state = mode?.coreState as Hoi4State | null
    if (!state) return ctx.output('游戏未就绪')
    const divs = Object.keys(state.divisions).length
    const battles = Object.keys(state.battles).length
    const tag = state.playerTag ?? '（未选国）'
    const c = state.playerTag ? state.countries[state.playerTag] : null
    ctx.output(
      `${mode!.dateText} · 玩家=${tag}` +
      (c ? ` · pp=${Math.floor(c.pp)} 人力=${(c.manpower / 1000).toFixed(0)}k 民厂=${c.civFactories} 军厂=${c.milFactories} 师=${c.deployPool.length}待部署` : '') +
      ` · 全图师=${divs} 战斗=${battles} · 结果=${state.result ?? '进行中'}`,
    )
  },
} as GMCommandDef
