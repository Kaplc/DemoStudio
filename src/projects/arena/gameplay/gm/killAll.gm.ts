/**
 * arena.killAll — 全灭当前房间敌人（清房开门调试）
 */
import type { GMCommandDef } from '@/engine'
import type { ArenaGameInstance } from '../ArenaGameInstance'

export default {
  name: 'arena.killAll',
  description: '全灭当前房间史莱姆（触发清房开门）',
  handler: (ctx) => {
    const inst = ctx.gameInstance as ArenaGameInstance
    const alive = inst.gameMode.aliveSlimes.length
    for (const s of inst.gameMode.aliveSlimes) {
      s.health.damage(99999, null)
    }
    ctx.output(`已击杀 ${alive} 只史莱姆`)
  },
} as GMCommandDef
