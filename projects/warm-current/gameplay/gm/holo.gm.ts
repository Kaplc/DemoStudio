/**
 * holo — 全息地球链路验证（进入/工具/节点落位/地表建筑/状态探针）
 *
 * holo(state|enter|exit|tool|node|surf|screenpos, ...)
 *  - state：hologramSel / 工具 / 待落位数 / 已落位节点 / 地表建筑数
 *  - enter / exit：开合全息地球（相机语义与面板入口同链路）
 *  - tool <ring|building> [typeId]：切换放置工具（null 取消）
 *  - node <lat> <lon>：直接落位一个待落位环节点（绕屏幕拾取，判定走同一校验链）
 *  - surf <typeId> <lat> <lon>：地表建筑落位（surfacePlacementIssue 校验）
 *  - screenpos <slot>：环节点标记屏幕坐标（真实点击测试用）
 */
import type { GMCommandDef } from '@/engine'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'
import { B } from '../core/balance'
import { pendingRingNodeCount, placedRingNodes } from '../core/helpers'

export default {
  name: 'holo',
  description: '全息地球 holo(state|enter|exit|tool,kind,typeId|node,lat,lon|surf,typeId,lat,lon|screenpos,slot)',
  params: [
    { name: 'action', type: 'string', required: true, desc: 'state / enter / exit / tool / node / surf / screenpos' },
    { name: 'a', type: 'string', required: false, desc: '按 action：kind / lat / typeId / slot' },
    { name: 'b', type: 'string', required: false, desc: '按 action：typeId / lon' },
    { name: 'c', type: 'string', required: false, desc: 'surf 的 lon' },
  ],
  handler: (ctx, action, a, b, c) => {
    const mode = (ctx.gameInstance as unknown as { gameMode?: WarmCurrentGameMode }).gameMode
    if (!mode) return ctx.output('游戏未就绪')
    const s = mode.simState.state
    if (action === 'state') {
      const nodes = placedRingNodes(s)
      const surf = s.buildings.filter((x) => x.surface)
      return ctx.output(
        `holo=${mode.hologramSel ?? 'off'} tool=${mode.holoPlaceTool ? (mode.holoPlaceTool.kind === 'ring' ? 'ring' : mode.holoPlaceTool.typeId) : 'none'} `
        + `slots=${s.ringSlots} pending=${pendingRingNodeCount(s)} placed=${nodes.length} `
        + `nodes=[${nodes.map((n) => `${n.slot}:${n.lat.toFixed(1)},${n.lon.toFixed(1)},r${n.rDeg}`).join(' ')}] `
        + `surface=[${surf.map((x) => `${x.type}@${x.surface!.lat.toFixed(1)},${x.surface!.lon.toFixed(1)}`).join(' ')}] `
        + `ghost=${mode.holoGhost ? `${mode.holoGhost.valid ? 'ok' : 'deny'}:${mode.holoGhost.label}` : 'none'} `
        + `meltR=${B.holoEarth.meltRadiusDeg}`,
      )
    }
    if (action === 'enter') {
      if (mode.hologramSel === 'earth') return ctx.output('已在全息地球')
      mode.openHologram('earth')
      const sel: unknown = mode.hologramSel
      return ctx.output(sel === 'earth' ? '全息地球已开启' : '开启失败（看 hint，需地球系视角）')
    }
    if (action === 'exit') {
      mode.closeHologram()
      return ctx.output('全息已关闭')
    }
    if (action === 'tool') {
      const kind = String(a ?? '')
      if (kind === 'ring') {
        mode.setHoloTool('ring')
      } else if (kind === 'building') {
        mode.setHoloTool('building', String(b ?? ''))
      } else {
        mode.setHoloTool(null)
      }
      return ctx.output(`工具=${mode.holoPlaceTool ? (mode.holoPlaceTool.kind === 'ring' ? 'ring' : mode.holoPlaceTool.typeId) : 'none'}`)
    }
    if (action === 'node') {
      const lat = Number(a)
      const lon = Number(b)
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return ctx.output('用法：holo node <lat> <lon>')
      const issue = mode.placeRingNodeAt(lat, lon)
      return ctx.output(issue ? `落位拒绝：${issue}` : `节点落位 @${lat},${lon}（余待落位 ${pendingRingNodeCount(s)}）`)
    }
    if (action === 'surf') {
      const ok = mode.buildings.tryPlaceSurface(String(a ?? ''), Number(b), Number(c))
      return ctx.output(ok ? `地表建筑 ${a} 已落位` : `落位失败（看 hint）`)
    }
    if (action === 'screenpos') {
      const p = mode.holoNodeScreenPos(Number(a ?? -1))
      return ctx.output(p ? `slot${a} 屏幕 (${Math.round(p.x)}, ${Math.round(p.y)})` : `slot${a} 不可见`)
    }
    ctx.output(`未知动作：${action}`)
  },
} as GMCommandDef
