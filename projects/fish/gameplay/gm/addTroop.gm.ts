/**
 * addTroop — fish GM 示例命令：增加兵种数量
 *
 * 走 TrainingComponent.debugAddArmy（调试注入，绕过训练队列/容量/扣费），
 * 战斗放兵（BattleHud 卡片数量）与兵营 UI 军队摘要即时可见。
 */
import type { GMCommandDef } from '@/engine'

export default {
  name: 'addTroop',
  description: '增加兵种数量（绕过训练队列直接注入军队）',
  params: [
    { name: 'troopId', type: 'string', required: true, desc: '兵种 id（如 barbarian/giant/dragon）' },
    { name: 'count', type: 'int', required: true, desc: '数量' },
  ],
  handler: (ctx, troopId, count) => {
    const inst = ctx.gameInstance as unknown as {
      getTroop: (id: string) => { name?: string } | undefined
      training: {
        registerTroop: (id: string, t: unknown) => void
        debugAddArmy: (id: string, n: number) => boolean
        getArmyCount: (id: string) => number
      }
    }
    const troop = inst.getTroop(troopId as string)
    if (!troop) {
      ctx.output(`未知兵种: ${troopId}（barbarian/archer/goblin/giant/wallBreaker/balloon/wizard/healer/dragon/pekka）`)
      return
    }
    inst.training.registerTroop(troopId as string, troop)
    inst.training.debugAddArmy(troopId as string, count as number)
    ctx.output(`${troop.name} +${count}（当前 ${inst.training.getArmyCount(troopId as string)} 个）`)
  },
} as GMCommandDef
