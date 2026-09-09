/**
 * status — 打印全局态势（储量/焚烧/堆心温度/幕/节点/船队/事件计时）
 */
import type { GMCommandDef } from '@/engine'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'
import { estimateNetFlow } from '../core/helpers'

export default {
  name: 'status',
  description: '打印《暖流计划》全局态势',
  params: [],
  handler: (ctx) => {
    const mode = (ctx.gameInstance as unknown as { gameMode?: WarmCurrentGameMode }).gameMode
    if (!mode) return ctx.output('游戏未就绪')
    const s = mode.simState.state
    const sim = mode.simState
    ctx.output([
      `t=${s.time.toFixed(0)}s 幕${s.act} 节点${s.nodes}/12 堆心温度${s.coreTemp.toFixed(0)}%`,
      `储量 ${s.earthH3.toFixed(0)} t · 需求 ${sim.demand.toFixed(1)}/s（焚烧 ${sim.burnRate.toFixed(1)} + 研究 ${sim.researchCost.toFixed(1)}）`,
      `净流估 ${estimateNetFlow(s, sim.demand).toFixed(1)}/s · 环 ${s.ring}（${s.earthH3 > 0 ? '升温中' : '降温中'}）`,
      `船 ${s.ships.length}（空闲${sim.idleShips} 冻毁${sim.frozenShips.length}）· 航线 ${s.routes.length} · 建筑 ${s.buildings.length}`,
      `窗口 ${s.gravity.phase} ${s.gravity.timer.toFixed(0)}s · 耀斑 ${s.flare.phase} next=${s.flare.nextIn === Infinity ? '∞' : s.flare.nextIn.toFixed(0)}s`,
      `研究点 可用${sim.unspentResearchPoints} · ${s.research.map((l) => `${l.id} ${(l.progress * 100).toFixed(0)}% ${l.points}点`).join(' | ')}`,
      `pendingCard=${s.pendingCard ? s.pendingCard.choices.join(',') : '无'} · module=${s.module.state} · outcome=${s.outcome}`,
    ].join('\n'))
  },
} as GMCommandDef
