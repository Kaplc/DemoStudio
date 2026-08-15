/**
 * winLevel — fish GM 示例命令：当前关卡直接胜利
 *
 * 仅战斗关卡阶段（FishLevelGameMode 活跃）可用：
 * 调 debugForceWin → finishBattle(true)（等价摧毁城镇大厅的结算路径：
 * 掠夺入账 + 结算面板）。非关卡阶段（基地/海域/菜单）提示不可用。
 */
import type { GMCommandDef } from '@/engine'

export default {
  name: 'winLevel',
  description: '当前关卡直接胜利（仅战斗关卡阶段可用）',
  handler: (ctx) => {
    const inst = ctx.gameInstance as unknown as {
      world?: { gameMode?: { constructor?: { name?: string }; debugForceWin?: () => boolean } }
    }
    const mode = inst.world?.gameMode
    if (mode?.constructor?.name !== 'FishLevelGameMode' || !mode.debugForceWin) {
      ctx.output('当前不在战斗关卡阶段，winLevel 不可用')
      return
    }
    const ok = mode.debugForceWin()
    ctx.output(ok ? '关卡已判胜（掠夺入账 + 结算面板）' : '战斗已结束，无法重复判胜')
  },
} as GMCommandDef
