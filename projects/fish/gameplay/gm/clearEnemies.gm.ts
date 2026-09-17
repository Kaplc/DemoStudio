/**
 * clearEnemies — fish GM 示例命令：清除当前战斗敌方单位
 *
 * 仅战斗关卡阶段（FishLevelGameMode 活跃）可用：
 * 调 debugClearEnemies 清除全部敌方建筑（不结算掠夺/胜负）。
 * 非关卡阶段提示不可用。
 */
import type { GMCommandDef } from '@/engine'

export default {
  name: 'clearEnemies',
  description: '清除当前战斗全部敌方建筑（仅战斗关卡阶段可用）',
  handler: (ctx) => {
    const inst = ctx.gameInstance as unknown as {
      world?: { gameMode?: { constructor?: { name?: string }; debugClearEnemies?: () => number } }
    }
    const mode = inst.world?.gameMode
    if (mode?.constructor?.name !== 'FishLevelGameMode' || !mode.debugClearEnemies) {
      ctx.output('当前不在战斗关卡阶段，clearEnemies 不可用')
      return
    }
    const cleared = mode.debugClearEnemies()
    ctx.output(`已清除 ${cleared} 个敌方建筑`)
  },
} as GMCommandDef
