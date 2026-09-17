/**
 * arena.god — 玩家无敌开关（M1 GM 套件）
 */
import type { GMCommandDef } from '@/engine'
import type { ArenaGameInstance } from '../ArenaGameInstance'

let godMode = false

export default {
  name: 'arena.god',
  description: '切换玩家无敌（再执行一次解除）',
  handler: (ctx) => {
    const inst = ctx.gameInstance as ArenaGameInstance
    const player = inst.pawn
    if (!player) {
      ctx.output('玩家不存在（游戏未运行？）')
      return
    }
    godMode = !godMode
    if (godMode) {
      player.health.maxHp = Math.max(player.health.maxHp, 1)
      // 无敌实现：持续授予长无敌帧（damage 拒绝）
      player.health.invulnDuration = 1e9
      player.health.grantInvulnerability(1e9)
      player.health.resetHp()
    } else {
      player.health.invulnDuration = 0.5
    }
    ctx.output(`无敌模式: ${godMode ? 'ON' : 'OFF'}`)
  },
} as GMCommandDef
