/**
 * addElixir — fish GM 示例命令：增加药水
 *
 * 走 FishGameInstance.resources（跨阶段共享钱包），基地 HUD 药水文本自动同步。
 */
import type { GMCommandDef } from '@/engine'

export default {
  name: 'addElixir',
  description: '增加药水（走资源组件，基地 HUD 同步）',
  params: [
    { name: 'amount', type: 'int', required: true, desc: '药水数量' },
  ],
  handler: (ctx, amount) => {
    const inst = ctx.gameInstance as unknown as {
      resources: { add: (r: string, n: number) => void; get: (r: string) => number }
    }
    inst.resources.add('elixir', amount as number)
    ctx.output(`药水 +${amount}（当前 ${inst.resources.get('elixir')}）`)
  },
} as GMCommandDef
