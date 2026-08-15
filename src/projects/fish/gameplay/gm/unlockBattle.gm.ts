/**
 * unlockBattle — fish GM 命令：战斗全解锁（每个兵种注入大量军队）
 *
 * 仅战斗关卡阶段（FishLevelGameMode 活跃）可用：经 gameInstance.world.gameMode
 * 获取当前战斗 mode 校验阶段（与 winLevel 同款方式），随后遍历兵种表给每个兵种
 * 注入 GRANT_COUNT 个军队（TrainingComponent.debugAddArmy，绕过训练队列/容量/扣费），
 * 战斗 HUD 卡片数量即时刷新——无需在兵营训练即可全兵种放兵（放兵照常消耗军队）。
 *
 * 注：关卡解锁无需处理——fish.levels 表无锁定机制，地图面板（MapPanel）全量生成
 * 关卡卡片，所有关卡本就可进入。
 */
import type { GMCommandDef } from '@/engine'

/** 每个兵种注入的军队数量 */
const GRANT_COUNT = 999

export default {
  name: 'unlockBattle',
  description: '战斗全解锁：每个兵种注入大量军队（仅战斗关卡阶段可用）',
  handler: (ctx) => {
    const inst = ctx.gameInstance as unknown as {
      world?: { gameMode?: { constructor?: { name?: string } } }
      getTroopTable?: () => {
        getRowNames?: () => string[]
        getRow?: (id: string) => { name?: string } | undefined
      } | undefined
      training?: {
        registerTroop: (id: string, troop: unknown) => void
        debugAddArmy: (id: string, count: number) => boolean
      }
    }

    // 经 gameInstance 获取当前战斗 mode（world.gameMode，与 winLevel 同款）
    const mode = inst.world?.gameMode
    if (mode?.constructor?.name !== 'FishLevelGameMode') {
      ctx.output('当前不在战斗关卡阶段，unlockBattle 不可用（先进图关卡）')
      return
    }

    // 遍历兵种表：每个兵种注入 GRANT_COUNT 个军队（走正常放兵流程消耗）
    const table = inst.getTroopTable?.()
    const ids = table?.getRowNames?.() ?? []
    let added = 0
    for (const id of ids) {
      const troop = table?.getRow?.(id)
      if (!troop || !inst.training) continue
      inst.training.registerTroop(id, troop)
      inst.training.debugAddArmy(id, GRANT_COUNT)
      added++
    }

    ctx.output(`战斗全解锁：${added} 个兵种各 +${GRANT_COUNT} 军队（${ids.join('、')}）`)
    ctx.output('战斗 HUD 卡片数量已刷新，可直接选兵放兵（放兵照常消耗军队）')
  },
} as GMCommandDef
