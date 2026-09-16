/**
 * station — 空间站调试桥（放置/配舱段）：station place <anchor> / station mod <obId> <moduleId> / station list
 * place 走 tryPlace 正式链路（扣款+工期+均布相位）；mod 直调 toggleStationModule（装/卸同口径）。
 */
import type { GMCommandDef } from '@/engine'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'
import { B } from '../core/balance'
import type { PlanetBodyId } from '../core/types'

const ANCHORS = ['mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'europa', 'saturn', 'uranus', 'neptune']

export default {
  name: 'station',
  description: '空间站 station(place|mod|list, anchor/obId, moduleId)（place 走正式建造链路；mod 装/卸舱段）',
  params: [
    { name: 'action', type: 'string', required: true, desc: 'place / mod / list' },
    { name: 'anchorOrObId', type: 'string', required: false, desc: 'place：锚点天体 id；mod：空间站建筑 id' },
    { name: 'moduleId', type: 'string', required: false, desc: `舱段模块 id（${Object.keys(B.stationModules).join('/')}）` },
  ],
  handler: (ctx, action, anchorOrObId, moduleId) => {
    const mode = (ctx.gameInstance as unknown as { gameMode?: WarmCurrentGameMode }).gameMode
    if (!mode) return ctx.output('游戏未就绪')
    const s = mode.simState.state
    const ob = mode.orbitBuild
    const pool = Object.entries(B.stationModules).map(([id, def]) => `${id}(${def.name} ${def.cost})`).join(' ')
    if (action === 'list') {
      const stations = s.orbitBuildings.filter((x) => x.type === 'station')
      if (stations.length === 0) return ctx.output(`无空间站 · 舱段池：${pool}`)
      const rows = stations
        .map((st) => `#${st.id}@${st.anchor}${st.built ? '' : '(建造中)'}：${(st.modules ?? []).join(',') || '空'}`)
        .join('  ')
      return ctx.output(`${rows} · 舱段池：${pool}`)
    }
    if (action === 'place') {
      const anchor = String(anchorOrObId ?? '') as PlanetBodyId
      if (!ANCHORS.includes(anchor)) return ctx.output(`未知锚点：${anchor}（可用：${ANCHORS.join('/')}）`)
      if (!ob.tryPlace('station', anchor)) return ctx.output('落位失败（见 hint）')
      const made = s.orbitBuildings.filter((x) => x.type === 'station')
      const made0 = made[made.length - 1]!
      return ctx.output(`空间站#${made0.id} 落位 @${anchor}（工期 ${B.orbitBuildings.station!.buildTime}s；建成后 station mod ${made0.id} <moduleId> 配舱段）`)
    }
    if (action === 'mod') {
      const id = Number(anchorOrObId ?? NaN)
      if (!Number.isFinite(id)) return ctx.output('obId 非法（station list 查看空间站）')
      const ok = ob.toggleStationModule(id, String(moduleId ?? ''))
      return ctx.output(ok ? `空间站#${id} 舱段 ${moduleId} 已切换` : `舱段操作失败（见 hint）`)
    }
    ctx.output(`未知动作：${action}（place/mod/list）`)
  },
} as GMCommandDef
