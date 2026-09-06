/**
 * arena.spawnSlime — 追加生成史莱姆（波次调试）
 */
import type { GMCommandDef } from '@/engine'
import { SlimeActor } from '../SlimeActor'
import type { ArenaGameInstance } from '../ArenaGameInstance'

export default {
  name: 'arena.spawnSlime',
  description: '在玩家面前追加生成史莱姆',
  params: [{ name: 'count', type: 'int', required: false, desc: '数量（缺省 1）' }],
  handler: (ctx, count) => {
    const inst = ctx.gameInstance as ArenaGameInstance
    const player = inst.pawn
    const mode = inst.gameMode
    if (!player || !mode.world) {
      ctx.output('游戏未运行')
      return
    }
    const n = Math.max(1, Math.min(10, (count as number) ?? 1))
    const pos = player.root.position
    for (let i = 0; i < n; i++) {
      const slime = new SlimeActor(`Slime_gm${Date.now()}_${i}`)
      slime.setPosition(pos.x + 3 + i * 1.5, 0.9, pos.z - 2)
      mode.registerSlime(slime) // 入清点（目标/死亡回调/清房检测）
      mode.world.actorMgr.SpawnActor(slime)
    }
    ctx.output(`已生成 ${n} 只史莱姆`)
  },
} as GMCommandDef
