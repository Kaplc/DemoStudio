/**
 * addCoins — fish GM 示例命令：增加金币
 *
 * 走 FishGameInstance.resources（跨阶段共享钱包），基地 HUD 金币文本自动同步
 * （ResourcesComponent.onChange → BaseHudScript）。
 */
import type { GMCommandDef } from '@/engine'

export default {
  name: 'addCoins',
  description: '增加金币（走资源组件，基地 HUD 同步）',
  params: [
    { name: 'amount', type: 'int', required: true, desc: '金币数量' },
  ],
  handler: (ctx, amount) => {
    const inst = ctx.gameInstance as unknown as {
      resources: { add: (r: string, n: number) => void; get: (r: string) => number }
    }
    inst.resources.add('coins', amount as number)
    ctx.output(`金币 +${amount}（当前 ${inst.resources.get('coins')}）`)
  },
} as GMCommandDef
