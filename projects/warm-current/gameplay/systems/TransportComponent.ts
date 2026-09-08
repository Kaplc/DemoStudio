/**
 * TransportComponent — 航线与飞船系统组件（模块 02）
 *
 * 拖线建航线（正向运 H3 / 反向运建材）、派船/召回/删线、造船/重建、
 * 飞船循环运输状态机（loading → flying → unloading → …）、火星模块任务。
 */
import { BObjectComponent } from '@/engine'
import { B } from '../core/balance'
import {
  endpointKey, endpointPos, findRoute, makeShip, starOfEndpoint, starPosAt, windowAffected,
  legSeconds, roundFuel, starLoad, cargoCap, buildingByEndpoint, buildingDefOf, supplyDistCoeff,
  TUTORIAL_TARGETS,
} from '../core/helpers'
import type { Endpoint, SimRoute, SimShip, StarId } from '../core/types'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

export class TransportComponent extends BObjectComponent<WarmCurrentGameMode> {
  constructor(owner: WarmCurrentGameMode) {
    super(owner)
    this.name = 'TransportComponent'
  }

  private get sc() { return this.owner.simState }

  starUnlocked(star: StarId): boolean {
    return this.sc.state.act >= B.stars[star].unlockAct
  }

  /**
   * 建立/延长航线。合法组合：地球↔资源星（正向）、地球↔中转站（反向补给线）。
   * 已存在同端点航线 = 再派 1 艘（平行线捷径）。
   * 航线可空船创建：无空闲船时航线保留，造船后从航线面板补派。
   */
  tryCreateRoute(a: Endpoint, b: Endpoint): boolean {
    const s = this.sc.state
    if (s.outcome !== 'playing' && !s.sandbox) return false
    if (s.flare.phase === 'active') { this.sc.hint('太阳耀斑 · 通讯中断，无法修改航线'); return false }

    // 首次引导：只认 月球↔地球（端点取 core 单一数据源 TUTORIAL_TARGETS，
    // 渲染层教学环 / GameMode.dragValidity 消费同一常量，改引导只需改一处）
    if (s.tutorial) {
      const [tutStar, tutPlanet] = TUTORIAL_TARGETS
      const ok = (endpointKey(a) === tutPlanet && endpointKey(b) === `star:${tutStar}`) ||
        (endpointKey(b) === tutPlanet && endpointKey(a) === `star:${tutStar}`)
      if (!ok) { this.sc.hint(`再试一次，从${B.stars[tutStar].name}拖一条线到地球`); return false }
    }

    if (endpointKey(a) === endpointKey(b)) { this.sc.hint('航线两端不能是同一节点'); return false }

    const kinds = [a.kind, b.kind]
    let forward: { star: StarId } | null = null
    let reverseToBuilding: number | null = null
    if (kinds.includes('earth') && kinds.includes('star')) {
      const starEp = a.kind === 'star' ? a : b
      const star = (starEp as { kind: 'star'; star: StarId }).star
      if (!this.starUnlocked(star)) {
        this.sc.hint(`${B.stars[star].name}将在第${B.stars[star].unlockAct}幕解锁`)
        return false
      }
      forward = { star }
    } else if (kinds.includes('earth') && kinds.includes('building')) {
      const bEp = (a.kind === 'building' ? a : b) as { kind: 'building'; buildingId: number }
      const bd = buildingByEndpoint(s, bEp)
      if (!bd) { this.sc.hint('建筑不存在'); return false }
      const def = buildingDefOf(bd.type)
      if (!def?.linkable) { this.sc.hint(`${def?.name ?? '该建筑'}不能接入航线`); return false }
      reverseToBuilding = bd.id
    } else {
      this.sc.hint('航线必须是「星—地」或「地—中转站」组合')
      return false
    }

    // 已存在 → 派 1 艘
    const existing = findRoute(s, a, b)
    if (existing) return this.tryAddShip(existing.id)

    if (!forward && reverseToBuilding === null) { this.sc.hint('航线不合法'); return false }

    const route: SimRoute = forward
      ? { id: this.nextRouteId(), from: { kind: 'star', star: forward.star }, to: { kind: 'earth' }, direction: 'forward', shipIds: [] }
      : { id: this.nextRouteId(), from: { kind: 'earth' }, to: { kind: 'building', buildingId: reverseToBuilding! }, direction: 'reverse', shipIds: [] }
    s.routes.push(route)
    if (!this.assignIdleShip(route)) {
      this.sc.hint('空船建线：航线已建立（无空闲船），造船后从航线面板补派')
      const pos = endpointPos(s, route.from)
      this.sc.emit({ type: 'route_built', x: pos.x, y: pos.y })
      s.tutorial = false
      return true
    }
    const pos = endpointPos(s, route.from)
    this.sc.emit({ type: 'route_built', x: pos.x, y: pos.y })
    s.tutorial = false
    return true
  }

  private _routeId = 0
  private nextRouteId(): number {
    // id 连续性：由状态重置时归位（helpers.resetIds 在 createInitialState 内调用）
    if (this._routeId === 0) this._routeId = maxRouteId(this.sc.state) + 1
    return this._routeId++
  }

  /** 从空闲池派 1 艘到航线 */
  tryAddShip(routeId: number): boolean {
    const s = this.sc.state
    if (s.flare.phase === 'active') { this.sc.hint('通讯中断，无法派船'); return false }
    const route = s.routes.find((r) => r.id === routeId)
    if (!route) return false
    if (route.direction === 'reverse' && !buildingByEndpoint(s, route.to)) {
      this.sc.hint('建筑已不存在')
      return false
    }
    if (!this.assignIdleShip(route)) { this.sc.hint('没有空闲飞船'); return false }
    return true
  }

  /** 从空闲池派 1 艘到航线（内部无通讯中断检查） */
  assignIdleShip(route: SimRoute): boolean {
    const ship = this.sc.state.ships.find((x) => x.state === 'idle')
    if (!ship) return false
    ship.state = 'loading'
    ship.routeId = route.id
    ship.leg = 'outbound'
    ship.progress = 0
    ship.timer = B.loadSeconds
    ship.cargo = 0
    ship.materials = 0
    ship.recalling = false
    ship.mission = false
    route.shipIds.push(ship.id)
    return true
  }

  /** 召回 1 艘：优先召回还在装货的，否则标记在途船卸完货后退役 */
  tryRemoveShip(routeId: number): boolean {
    const s = this.sc.state
    if (s.flare.phase === 'active') { this.sc.hint('通讯中断，无法召回'); return false }
    const route = s.routes.find((r) => r.id === routeId)
    if (!route || route.shipIds.length === 0) return false
    const ships = route.shipIds.map((id) => this.sc.shipById(id)!).filter(Boolean)
    const loading = ships.find((x) => x.state === 'loading')
    if (loading) {
      this.detachShip(loading, route)
      return true
    }
    const target = ships.find((x) => !x.recalling)
    if (!target) return false
    target.recalling = true
    return true
  }

  detachShip(ship: SimShip, route: SimRoute): void {
    route.shipIds = route.shipIds.filter((id) => id !== ship.id)
    ship.state = 'idle'
    ship.routeId = null
    ship.progress = 0
    ship.cargo = 0
    ship.materials = 0
    ship.recalling = false
    ship.mission = false
  }

  private detachShipToIdle(ship: SimShip): void {
    const route = this.sc.state.routes.find((r) => r.id === ship.routeId)
    if (route) this.detachShip(ship, route)
    else {
      // 航线已删（召回退役路径）：就地退役并清干净航线/货载残留
      ship.state = 'idle'
      ship.routeId = null
      ship.progress = 0
      ship.cargo = 0
      ship.materials = 0
      ship.recalling = false
      ship.mission = false
    }
  }

  /** 删除航线：在途船就近返航卸货（不丢货） */
  tryDeleteRoute(routeId: number): boolean {
    const s = this.sc.state
    if (s.flare.phase === 'active') { this.sc.hint('通讯中断，无法删除航线'); return false }
    const idx = s.routes.findIndex((r) => r.id === routeId)
    if (idx < 0) return false
    const route = s.routes[idx]
    for (const id of [...route.shipIds]) {
      const ship = this.sc.shipById(id)
      if (!ship) continue
      if (ship.state === 'loading') this.detachShip(ship, route)
      else ship.recalling = true
    }
    s.routes.splice(idx, 1)
    this.sc.emit({ type: 'route_deleted' })
    return true
  }

  /** 主动造船（150 H3 + 15s） */
  tryBuildShip(): boolean {
    const s = this.sc.state
    if (s.earthH3 < B.shipBuildCost) { this.sc.hint(`H3 不足（造船需 ${B.shipBuildCost}）`); return false }
    s.earthH3 -= B.shipBuildCost
    s.ledger.shipBuild += B.shipBuildCost
    s.buildQueue.push(B.shipBuildTime)
    return true
  }

  /** 冻毁船重建 */
  tryRebuildShip(shipId: number): boolean {
    const s = this.sc.state
    const ship = s.ships.find((x) => x.id === shipId && x.state === 'frozen')
    if (!ship) return false
    if (s.earthH3 < B.shipRebuildCost) { this.sc.hint(`H3 不足（重建需 ${B.shipRebuildCost}）`); return false }
    s.earthH3 -= B.shipRebuildCost
    s.ledger.shipRebuild += B.shipRebuildCost
    ship.state = 'idle'
    ship.routeId = null
    s.stats.rebuiltCount++
    this.sc.emit({ type: 'ship_rebuilt' })
    return true
  }

  /** 火星环扩展模块运输（胜利前置，单趟往返） */
  startMarsMission(): boolean {
    const s = this.sc.state
    if (s.act < 3 || s.module.state !== 'available') return false
    const ship = s.ships.find((x) => x.state === 'idle')
    if (!ship) { this.sc.hint('需要一艘空闲飞船执行模块运输'); return false }
    ship.state = 'flying'
    ship.mission = true
    ship.leg = 'outbound'
    ship.progress = 0
    ship.legTime = B.moduleLegSeconds
    ship.speedMult = s.mods.speedMult
    ship.routeId = null
    s.module.state = 'mission'
    s.module.shipId = ship.id
    return true
  }

  // ─── 逐帧状态机（SimulationComponent 编排调用） ───

  tickBuildQueue(dt: number): void {
    const s = this.sc.state
    if (s.buildQueue.length === 0) return
    s.buildQueue[0] -= dt
    if (s.buildQueue[0] <= 0) {
      s.buildQueue.shift()
      s.ships.push(makeShip(s.ships.length + 1))
      this.sc.emit({ type: 'ship_built' })
    }
  }

  tickShips(dt: number): void {
    const s = this.sc.state
    const flareActive = s.flare.phase === 'active'
    for (const ship of s.ships) {
      if (ship.resumeDelay > 0) {
        ship.resumeDelay -= dt
        continue
      }
      switch (ship.state) {
        case 'loading': {
          ship.timer -= dt
          if (ship.timer > 0) break
          if (ship.recalling && !ship.mission) { this.detachShipToIdle(ship); break }
          if (ship.mission) {
            // 模块在火星上船 → 返航
            ship.state = 'flying'; ship.leg = 'return'; ship.progress = 0
          } else {
            this.departShip(ship)
          }
          break
        }
        case 'flying': {
          if (flareActive) break // 失联停滞
          ship.progress += dt / Math.max(0.1, ship.legTime)
          if (ship.progress >= 1) {
            ship.progress = 0
            if (ship.leg === 'outbound') {
              if (ship.mission) {
                ship.state = 'loading'; ship.timer = B.moduleLoadSeconds
              } else {
                ship.state = 'unloading'; ship.timer = B.unloadSeconds
              }
            } else {
              if (ship.mission) {
                ship.state = 'unloading'; ship.timer = B.moduleUnloadSeconds
              } else {
                ship.state = 'loading'; ship.timer = B.loadSeconds
                if (ship.recalling) this.detachShipToIdle(ship)
              }
            }
          }
          break
        }
        case 'unloading': {
          ship.timer -= dt
          if (ship.timer <= 0) this.completeUnload(ship)
          break
        }
        default:
          break
      }
    }
  }

  /** 装货完成出发（锁定本次往返油耗/航速）；反向无需求/H3 不足时保持等待 */
  private departShip(ship: SimShip): void {
    const s = this.sc.state
    const route = s.routes.find((r) => r.id === ship.routeId)
    if (!route) { this.detachShipToIdle(ship); return }
    const speed = s.mods.speedMult
    if (route.direction === 'forward') {
      const star = starOfEndpoint(s, route.from) as StarId
      const windowed = s.gravity.phase === 'active' && windowAffected(s, route)
      ship.speedMult = speed * (windowed ? B.gravity.speedMult : 1)
      ship.legTime = legSeconds(B.stars[star].dist, ship.speedMult)
      ship.cargo = starLoad(s.mods, star)
      ship.roundFuel = roundFuel(s.mods, B.stars[star].dist, windowed ? B.gravity.fuelMult : 1)
      ship.materials = 0
    } else {
      const b = buildingByEndpoint(s, route.to)
      if (!b) { this.detachShipToIdle(ship); return }
      const dist = supplyDistCoeff(s, route.to)
      const windowed = s.gravity.phase === 'active' && windowAffected(s, route)
      const fuel = roundFuel(s.mods, dist, windowed ? B.gravity.fuelMult : 1)
      const want = Math.min(cargoCap(s.mods), this.owner.buildings.bufferLeft(b))
      const affordable = Math.floor(Math.max(0, s.earthH3 - fuel) / B.materialH3PerUnit)
      const load = Math.min(want, affordable)
      if (load <= 0) return // 等待：缓存已满或 H3 不足油耗
      ship.speedMult = speed * (windowed ? B.gravity.speedMult : 1)
      ship.legTime = legSeconds(dist, ship.speedMult)
      ship.roundFuel = fuel
      ship.materials = load
      ship.cargo = 0
      // 建材从地球 H3 家底折算扣除（航行与建材均与生存争夺燃料）
      s.earthH3 -= fuel + load * B.materialH3PerUnit
      s.ledger.reverseFuel += fuel
      s.ledger.materials += load * B.materialH3PerUnit
      if (s.earthH3 < 0) s.earthH3 = 0
    }
    ship.state = 'flying'
    ship.leg = 'outbound'
    ship.progress = 0
  }

  /** 卸货完成（仅在卸货点触发：正向=地球 / 反向=站点 / 任务返航=地球） */
  private completeUnload(ship: SimShip): void {
    const s = this.sc.state
    if (ship.mission) {
      ship.mission = false
      ship.state = 'idle'
      s.module.state = 'delivered'
      s.module.shipId = null
      s.nodes = B.totalNodes
      if (s.outcome === 'playing') {
        s.outcome = 'victory'
        const p = starPosAt(s, 'earth')
        this.sc.emit({ type: 'victory', x: p.x, y: p.y })
      }
      return
    }
    const route = s.routes.find((r) => r.id === ship.routeId)
    if (!route) { this.detachShipToIdle(ship); return }
    if (route.direction === 'forward') {
      const net = Math.max(0, ship.cargo - ship.roundFuel)
      s.earthH3 += net
      s.ledger.unload += net
      s.stats.delivered += net
      const p = starPosAt(s, 'earth')
      this.sc.emit({ type: 'unload', value: Math.round(net), x: p.x, y: p.y })
    } else {
      const b = buildingByEndpoint(s, route.to)
      if (b) {
        this.owner.buildings.onDelivery(b, ship.materials)
      }
    }
    ship.leg = 'return'
    ship.state = 'flying'
    ship.progress = 0
    ship.cargo = 0
    ship.materials = 0
  }
}

function maxRouteId(state: { routes: SimRoute[] }): number {
  return state.routes.reduce((m, r) => Math.max(m, r.id), 0)
}
