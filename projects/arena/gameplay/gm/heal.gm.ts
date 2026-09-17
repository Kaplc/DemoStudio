/**
 * arena.heal — 治疗玩家
 */
import type { GMCommandDef } from '@/engine'
import type { ArenaGameInstance } from '../ArenaGameInstance'

export default {
  name: 'arena.heal',
  description: '治疗玩家（缺省回满）',
  params: [{ name: 'amount', type: 'float', required: false, desc: '治疗量（缺省=回满）' }],
  handler: (ctx, amount) => {
    const inst = ctx.gameInstance as ArenaGameInstance
    const player = inst.pawn
    if (!player) {
      ctx.output('玩家不存在（游戏未运行？）')
      return
    }
    const healed = player.health.heal(amount !== undefined ? (amount as number) : player.health.maxHp)
    ctx.output(`回复 ${healed} HP（当前 ${player.health.hp}/${player.health.maxHp}）`)
  },
} as GMCommandDef
