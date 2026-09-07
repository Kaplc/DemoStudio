/**
 * StationsComponent — 补给站系统组件（模块 11，物流派定案）
 *
 * 正向航线中点建站点（需基建线解锁）、反向航线送建材（装货即扣等值 H3），
 * 建材达标自动建成、点击升级（建材计价）、拆除返还 50% 投入。
 */
import { BObjectComponent } from '@/engine'
import { B } from '../core/balance'
import { starPosAt, stationAnchorPos } from '../core/helpers'
import type { SimStation, StarId } from '../core/types'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

export class StationsComponent extends BObjectComponent<WarmCurrentGameMode> {
  constructor(owner: WarmCurrentGameMode) {
    super(owner)
    this.name = 'StationsComponent'
  }

  private get sc() { return this.owner.simState }

  /** 在正向航线中点建补给站站点（需基建线解锁） */
  tryBuildStation(routeId: number): boolean {
    const s = this.sc.state
    if (s.flare.phase === 'active') { this.sc.hint('通讯中断，无法建造'); return false }
    if (!s.mods.stationUnlocked) { this.sc.hint('需要基建线「补给站解锁」节点'); return false }
    const route = s.routes.find((r) => r.id === routeId)
    if (!route || route.direction !== 'forward') { this.sc.hint('补给站只能建在正向航线上'); return false }
    if (s.stations.some((st) => st.routeId === routeId)) { this.sc.hint('该航线已有补给站'); return false }
    const starEp = route.from.kind === 'star' ? route.from.star : null
    if (!starEp) return false
    const star: StarId = starEp
    const a = starPosAt(s, star), b = starPosAt(s, 'earth')
    const station: SimStation = {
      id: maxStationId(s) + 1,
      routeId,
      star,
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      level: 0,
      stock: 0,
      need: B.station.buildMaterials,
      invested: 0,
    }
    s.stations.push(station)
    return true
  }

  /** 升级（点击；建材达标可升） */
  tryUpgradeStation(stationId: number): boolean {
    const s = this.sc.state
    if (s.flare.phase === 'active') { this.sc.hint('通讯中断，无法升级'); return false }
    const st = s.stations.find((x) => x.id === stationId)
    if (!st || st.level === 0 || st.level >= 3) return false
    const need = B.station.upgradeMaterials[st.level + 1]
    if (st.stock < need) { this.sc.hint(`建材不足（需 ${need}，现有 ${Math.floor(st.stock)}）`); return false }
    st.stock -= need
    st.level = (st.level + 1) as SimStation['level']
    st.need = st.level >= 3 ? 0 : B.station.upgradeMaterials[st.level + 1]
    const p = stationAnchorPos(s, st)
    this.sc.emit({ type: 'station_upgraded', value: st.level, x: p.x, y: p.y })
    return true
  }

  /** 拆除返还 50% 投入 H3；反向航线随站拆除 */
  tryDemolishStation(stationId: number): boolean {
    const s = this.sc.state
    if (s.flare.phase === 'active') { this.sc.hint('通讯中断，无法拆除'); return false }
    const idx = s.stations.findIndex((x) => x.id === stationId)
    if (idx < 0) return false
    const st = s.stations[idx]
    const refund = st.invested * B.materialH3PerUnit * B.station.demolishRefund
    s.earthH3 += refund
    // 召回/删除通往该站的反向航线
    for (const route of [...s.routes]) {
      if (route.to.kind === 'station' && route.to.stationId === stationId) this.owner.transport.tryDeleteRoute(route.id)
    }
    s.stations.splice(idx, 1)
    this.sc.emit({ type: 'station_demolished', value: refund })
    return true
  }

  /** 反向航线卸货（Transport 调用）：入账 + 达标自动建成（need 切到下一级升级需求） */
  onDelivery(st: SimStation, materials: number): void {
    const s = this.sc.state
    st.stock += materials
    st.invested += materials
    const p = stationAnchorPos(s, st)
    this.sc.emit({ type: 'unload', value: Math.round(materials), x: p.x, y: p.y })
    if (st.level === 0 && st.stock >= st.need) {
      st.level = 1
      st.need = B.station.upgradeMaterials[2]
      s.stats.stationsBuilt++
      this.sc.emit({ type: 'station_built', value: 1, x: st.x, y: st.y })
    }
  }
}

function maxStationId(s: { stations: SimStation[] }): number {
  return s.stations.reduce((m, x) => Math.max(m, x.id), 0)
}
