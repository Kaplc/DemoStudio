/**
 * spawn_div — 直接在玩家国首都生成一个满编师（搭场景用）
 */
import type { GMCommandDef } from '@/engine'
import type { Hoi4GameMode } from '../base/Hoi4GameMode'
import type { Hoi4State } from '../core/types'
import { deployDivision } from '../core/Military'

export default {
  name: 'spawn_div',
  description: '在首都直接生成师 spawn_div(template)',
  params: [
    { name: 'template', type: 'string', required: false, desc: '模板 id（缺省 inf_1）' },
    { name: 'prov', type: 'int', required: false, desc: '落省 id（缺省首都）' },
  ],
  handler: (ctx, template, prov) => {
    const mode = (ctx.gameInstance as unknown as { gameMode?: Hoi4GameMode }).gameMode
    const state = mode?.coreState as Hoi4State | null
    if (!state?.playerTag) return ctx.output('游戏未就绪或未选国')
    const tables = mode!.getTables()
    const tplId = String(template ?? 'inf_1')
    if (!tables.templates[tplId]) return ctx.output(`未知模板 ${tplId}`)
    const target = (prov as number) || mode!.map.def.capitals[state.playerTag]
    if (!target) return ctx.output('该国无首都')
    // 走部署池 + 立即落省（复用训练完成的同一条路径）
    state.countries[state.playerTag].deployPool.push(tplId)
    const div = deployDivision(state, tables, mode!.map, state.playerTag, target)
    mode!.markers?.sync()
    ctx.output(div ? `已生成 ${div.name} @ 省 ${target}` : '生成失败（落省不合法）')
  },
} as GMCommandDef
