/**
 * ring — 环段建筑装拆（环构筑链路验证）：ring install <slot> <id> / ring demolish <slot>
 */
import type { GMCommandDef } from '@/engine'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'
import { B, ringBuildingDefOf } from '../core/balance'

export default {
  name: 'ring',
  description: '环段建筑 ring(install|demolish, slot, buildingId)（install 需已建成空槽；demolish 走建设泵反向灌入）',
  params: [
    { name: 'action', type: 'string', required: true, desc: 'install / demolish / list' },
    { name: 'slot', type: 'int', required: false, desc: '槽位号（0 基）' },
    { name: 'buildingId', type: 'string', required: false, desc: `环建筑 id（${Object.keys(B.ringBuildings).join('/')}）` },
  ],
  handler: (ctx, action, slot, buildingId) => {
    const mode = (ctx.gameInstance as unknown as { gameMode?: WarmCurrentGameMode }).gameMode
    if (!mode) return ctx.output('游戏未就绪')
    const rb = mode.ringBuild
    const s = mode.simState.state
    if (action === 'list') {
      const rows = Object.entries(B.ringBuildings)
        .map(([id, def]) => `${id}(${def.name} ${def.cost})`)
        .join(' ')
      return ctx.output(`已建成 ${s.ringSlots}/${B.ringSlots} · 可用：${rows}`)
    }
    const idx = Number(slot ?? -1)
    if (action === 'install') {
      const ok = rb.installBuilding(idx, String(buildingId ?? ''))
      if (!ok) return ctx.output(`安装失败（槽 ${idx} ← ${buildingId}）`)
      return ctx.output(`已安装 ${buildingId} → 槽 ${idx}`)
    }
    if (action === 'demolish') {
      const id = s.ringBuildings[idx]
      if (!id) return ctx.output(`槽 ${idx} 无建筑`)
      const ok = rb.startDemolish(idx)
      if (!ok) return ctx.output('拆除发起失败')
      return ctx.output(`拆除中（费 ${rb.demolishFeeOf(idx)}，泵反向灌入；期间效果停摆）`)
    }
    ctx.output(`未知动作：${action}（install/demolish/list）`)
  },
} as GMCommandDef
