/**
 * stock — 星球堆场调试（设置/查看资源星堆场水位）
 *
 * 2026-09-13 供应链重构配套 GM：
 *   stock()                    → 查看三星堆场（库存/上限/矿建产量）
 *   stock(star, amount)        → 设置该星堆场库存（star = moon|europa|mars，cap 截断）
 */
import type { GMCommandDef } from '@/engine'
import { B } from '../core/balance'
import { starMiningRate, starStockOf } from '../core/helpers'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

export default {
  name: 'stock',
  description: '星球堆场调试 stock([star, amount])——无参查看三星堆场；带参设置库存（cap 截断）',
  params: [
    { name: 'star', type: 'string', required: false, desc: '资源星 id（moon|europa|mars）' },
    { name: 'amount', type: 'float', required: false, desc: '设置库存（吨）' },
  ],
  handler: (ctx, star?, amount?) => {
    const mode = (ctx.gameInstance as unknown as { gameMode?: WarmCurrentGameMode }).gameMode
    if (!mode) return ctx.output('游戏未就绪')
    const s = mode.simState.state
    const starId = String(star ?? '')
    if (starId !== '') {
      const cap = (B.starStockCap as Record<string, number | undefined>)[starId]
      if (cap === undefined) return ctx.output(`未知资源星：${starId}（可选 moon|europa|mars）`)
      if (amount === undefined || amount === null) return ctx.output('缺少 amount')
      s.starStock[starId] = Math.max(0, Math.min(cap, Number(amount)))
      return ctx.output(`${B.stars[starId as keyof typeof B.stars]?.name ?? starId} 堆场 → ${s.starStock[starId].toFixed(0)} t（上限 ${cap}）`)
    }
    const lines = (['moon', 'europa', 'mars'] as const).map((id) => {
      const def = B.stars[id]
      const unlock = mode.transport.starUnlocked(id) ? '' : `（第${def.unlockAct}幕锁定）`
      return `${def.name}${unlock}：${starStockOf(s, id).toFixed(0)}/${B.starStockCap[id]} t · 产量 ${starMiningRate(s, id).toFixed(1)}/s`
    })
    ctx.output(lines.join('\n'))
  },
} as GMCommandDef
