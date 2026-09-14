/**
 * TransportComponent — 航线与飞船系统组件（模块 02）
 *
 * 拖线建航线（正向运 H3 / 反向运建材）、派船/召回/删线、造船/重建、
 * 飞船循环运输状态机（loading → flying → unloading → …）、火星模块任务。
 * 造船队列逐船一卡（SimShipBuild {remain, total, dockId}）：每艘在造船独立倒计时条目，
 * 承接船坞 id 随行记录（造船队列全游戏唯一——单生产线 FIFO，船坞面板展示全局队列）。
 */
import { BObjectComponent, logger } from '@/engine'
import { B } from '../core/balance'
import {
  endpointKey, endpointPos, findRoute, makeShip, starOfEndpoint, starPosAt, windowAffected,
  legSeconds, roundFuel, starLoad, cargoCap, buildingByEndpoint, buildingDefOf, supplyDistCoeff,
  TUTORIAL_TARGETS, shipMults, hullAllowsModule, hullHasSlotFor, shipBuildPrice, shipHullDefOf, shipModuleDefOf, buildingHookMult,
  relayLegDistCoeff, buildingPos,
} from '../core/helpers'
import { depositDefOf } from './MiningComponent'
import { isShipyardType, orbitBuildingDefOf } from './OrbitBuildComponent'
import type { Endpoint, SimRoute, SimShip, SimState, StarId } from '../core/types'
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
   * 建立/延长航线（2026-09-13 中转链扩展）。合法组合：
   *  - 星↔地（forward）：正向运 H3（星端从堆场装货）
   *  - 星↔中转站（relay_in）：正向 H3 入站缓存（中转链第一段）
   *  - 中转站→地（relay_out，拖向 = 从站拖到地）：站内 H3 回运地球（中转链第二段）
   *  - 地→中转站（reverse，拖向 = 从地拖到站）：反向补给线送建材
   * 已存在同端点同流向航线 = 再派 1 艘（平行线捷径；地球↔中转站允许建材线与 H3 线共存）。
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
    let direction: SimRoute['direction'] | null = null
    if (kinds.includes('earth') && kinds.includes('star')) {
      const starEp = a.kind === 'star' ? a : b
      const star = (starEp as { kind: 'star'; star: StarId }).star
      if (!this.starUnlocked(star)) {
        this.sc.hint(`${B.stars[star].name}将在第${B.stars[star].unlockAct}幕解锁`)
        return false
      }
      direction = 'forward'
    } else if (kinds.includes('star') && kinds.includes('building')) {
      const starEp = a.kind === 'star' ? a : b
      const star = (starEp as { kind: 'star'; star: StarId }).star
      if (!this.starUnlocked(star)) {
        this.sc.hint(`${B.stars[star].name}将在第${B.stars[star].unlockAct}幕解锁`)
        return false
      }
      const bEp = (a.kind === 'building' ? a : b) as { kind: 'building'; buildingId: number }
      const bd = buildingByEndpoint(s, bEp)
      if (!bd) { this.sc.hint('建筑不存在'); return false }
      const def = buildingDefOf(bd.type)
      if (!def?.linkable) { this.sc.hint(`${def?.name ?? '该建筑'}不能接入航线`); return false }
      direction = 'relay_in'
    } else if (kinds.includes('earth') && kinds.includes('building')) {
      const bEp = (a.kind === 'building' ? a : b) as { kind: 'building'; buildingId: number }
      const bd = buildingByEndpoint(s, bEp)
      if (!bd) { this.sc.hint('建筑不存在'); return false }
      const def = buildingDefOf(bd.type)
      if (!def?.linkable) { this.sc.hint(`${def?.name ?? '该建筑'}不能接入航线`); return false }
      // 拖向即意图：从站拖到地 = 站内 H3 回运（中转链第二段）；从地拖到站 = 建材补给线（原有）
      direction = a.kind === 'building' ? 'relay_out' : 'reverse'
    } else {
      this.sc.hint('航线必须是「星—地」「星—中转站」或「地—中转站」组合')
      return false
    }

    // 已存在同端点同流向 → 派 1 艘（地球↔中转站：建材线 / H3 线按拖向分别查找，可共存）
    const existing = findRoute(s, a, b, [direction])
    if (existing) return this.tryAddShip(existing.id)

    // 归一化端点方向（from → to 与流向语义一致）
    let from: Endpoint
    let to: Endpoint
    if (direction === 'forward') {
      const starEp = a.kind === 'star' ? a : b
      from = { kind: 'star', star: (starEp as { kind: 'star'; star: StarId }).star }
      to = { kind: 'earth' }
    } else if (direction === 'relay_in') {
      const starEp = a.kind === 'star' ? a : b
      const bEp = (a.kind === 'building' ? a : b) as { kind: 'building'; buildingId: number }
      from = { kind: 'star', star: (starEp as { kind: 'star'; star: StarId }).star }
      to = { kind: 'building', buildingId: bEp.buildingId }
    } else if (direction === 'relay_out') {
      const bEp = (a.kind === 'building' ? a : b) as { kind: 'building'; buildingId: number }
      from = { kind: 'building', buildingId: bEp.buildingId }
      to = { kind: 'earth' }
    } else {
      const bEp = (a.kind === 'building' ? a : b) as { kind: 'building'; buildingId: number }
      from = { kind: 'earth' }
      to = { kind: 'building', buildingId: bEp.buildingId }
    }

    const route: SimRoute = { id: this.nextRouteId(), from, to, direction, shipIds: [], stats: { trips: 0, loaded: 0, frozen: 0 } }
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
    ship.timer = B.loadSeconds * shipMults(ship).workMult
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
    ship.order = undefined
    ship.shelter = null
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
      ship.order = undefined
      ship.shelter = null
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

  /** 主动造船（船型 + 模块整单价 × 船坞折扣；受聚能环等级飞船上限约束：
   *  在册 + 建造排队总数 < ship_cap 表当前等级 cap + 泊位加算，超限 hint 拒绝；
   *  模块不占上限，花钱即可。2026-09-13 槽位制：每件模块过 allowed 兼容 ∧ slotType 槽位余量
   *  （hullHasSlotFor 单一口径），单船同模块只装一件。建成后不可改装，冻毁重建保留原配置）。
   *  造船入口收口：面板路径必传 orbitBuildingId（建成船坞），乘区取传入船坞自己的表值；
   *  缺省（GM/调试桥）无船坞原价原时长 */
  tryBuildShip(hullId: string, modules: string[], orbitBuildingId?: number): boolean {
    const s = this.sc.state
    const cap = this.sc.shipCap
    if (s.ships.length + s.buildQueue.length >= cap) {
      this.sc.hint(`飞船已达当前聚能环上限 ${cap} 艘（提升聚能环等级解锁更多船位）`)
      return false
    }
    const hull = shipHullDefOf(hullId)
    if (!hull) { this.sc.hint('未知船型'); return false }
    // 模块校验：表内存在 + allowed 兼容 + 槽位余量 + 去重（单船同模块只装一件）
    const mods: string[] = []
    for (const id of modules) {
      if (!shipModuleDefOf(id)) { this.sc.hint(`未知模块：${id}`); return false }
      if (!hullAllowsModule(hullId, id)) { this.sc.hint(`${hull.name}不能装载「${shipModuleDefOf(id)!.name}」`); return false }
      if (mods.includes(id)) continue
      if (!hullHasSlotFor(hullId, mods, id)) {
        this.sc.hint(`${hull.name}的「${shipModuleDefOf(id)!.name}」槽位已满`)
        return false
      }
      mods.push(id)
    }
    // 船坞乘区：面板路径传建成船坞 id；查不到/未建成/无造船能力 = 拒绝（面板只能对着建成船坞造船）
    let costMult = 1
    let speedMult = 1
    if (orbitBuildingId !== undefined) {
      const ob = s.orbitBuildings.find((x) => x.id === orbitBuildingId)
      const def = ob ? orbitBuildingDefOf(ob.type) : null
      if (!ob || !ob.built || !def || !isShipyardType(ob.type)) return false
      costMult = def.shipBuildCostMult
      speedMult = def.shipBuildSpeedMult
    }
    const cost = Math.round(shipBuildPrice(hullId, mods) * costMult)
    if (s.earthH3 < cost) { this.sc.hint(`H3 不足（造船需 ${cost}）`); return false }
    s.earthH3 -= cost
    s.ledger.shipBuild += cost
    // 逐船入队（每艘一卡；total 锁定本艘总时长，dockId 记录承接船坞，hull/modules 随卡下线注入）
    const remainS = B.shipBuildTime / speedMult
    s.buildQueue.push({ remain: remainS, total: remainS, dockId: orbitBuildingId ?? 0, hull: hullId, modules: mods })
    logger.info(
      `[Transport] 造船入队：${hull.name}${mods.length ? ` + ${mods.length} 模块` : ''} · 队列 ${s.buildQueue.length} 艘 · ` +
      `本艘 ${remainS.toFixed(1)}s · 折后 ${cost} H3（船坞 ${orbitBuildingId ?? '无'}）`,
    )
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
    s.buildQueue[0].remain -= dt
    if (s.buildQueue[0].remain <= 0) {
      const card = s.buildQueue.shift()!
      // 下线即定型：队列卡的船型/模块注入新船（建成后不可改装）
      s.ships.push(makeShip(s.ships.length + 1, card.hull, card.modules))
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
          } else if (ship.order === 'hold') {
            // 原地待命（耀斑预警决策）：取消本次出发，停在港口挂起（预警结束清决策后照常出发）
            ship.timer = 0
          } else {
            this.departShip(ship)
          }
          break
        }
        case 'flying': {
          // 失联停滞（规避程序船例外：自动靠站已改道罩内，照常推进——保全不白拿）
          if (flareActive && !shipMults(ship).autoEvade) break
          ship.progress += dt / Math.max(0.1, ship.legTime)
          if (ship.shelter) {
            // 靠站改道：抵达罩内安全点后原地等待耀斑结算（跑在爆发前 = 保全的赌性所在）
            if (ship.progress >= 1) ship.progress = 1
            break
          }
          if (ship.progress >= 1) {
            ship.progress = 0
            if (ship.leg === 'outbound') {
              if (ship.mission) {
                ship.state = 'loading'; ship.timer = B.moduleLoadSeconds
              } else {
                ship.state = 'unloading'; ship.timer = B.unloadSeconds * shipMults(ship).workMult
              }
            } else {
              if (ship.mission) {
                ship.state = 'unloading'; ship.timer = B.moduleUnloadSeconds
              } else {
                ship.state = 'loading'; ship.timer = B.loadSeconds * shipMults(ship).workMult
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

  /** 装货完成出发（锁定本次往返油耗/航速；正向从星球堆场取货、出站线从站缓存取货，
   *  无货等待重试；反向无需求/H3 不足时保持等待）。
   *  船级乘区：航速 = 全局 × 船型 × 模块（离子引擎）；满载 = 全局 × 环建筑 × 船型 × 货舱；
   *  油耗同乘船级（副油箱）；反向建材上限再乘强化吊臂 hookMult。 */
  private departShip(ship: SimShip): void {
    const s = this.sc.state
    const route = s.routes.find((r) => r.id === ship.routeId)
    if (!route) { this.detachShipToIdle(ship); return }
    const ring = this.sc.ringMods
    const hull = shipMults(ship)
    const speed = s.mods.speedMult * hull.speedMult
    const windowed = s.gravity.phase === 'active' && windowAffected(s, route)
    if (route.direction === 'forward' || route.direction === 'relay_in') {
      // 正向（入地/入站）：货源 = 星球堆场（2026-09-13 堆场耦合——产量层与运力层咬合点）
      const star = starOfEndpoint(s, route.from) as StarId
      const load = starLoad(s.mods, star, ship, ring)
      const stock = s.starStock[star] ?? 0
      const take = Math.min(load, stock)
      if (take <= 0) {
        this.hintStarDry(s, star)
        ship.timer = 1 // 1s 后重试（等矿建补货；不出发不扣时）
        return
      }
      if (take < load) this.hintStarLow(s, star)
      const dist = route.direction === 'forward'
        ? B.stars[star].dist
        : relayLegDistCoeff(s, star, route.to.kind === 'building' ? route.to.buildingId : 0)
      ship.speedMult = speed * (windowed ? B.gravity.speedMult : 1)
      ship.legTime = legSeconds(dist, ship.speedMult)
      ship.cargo = take
      ship.roundFuel = roundFuel(s.mods, dist, windowed ? B.gravity.fuelMult : 1, ship, ring)
      ship.materials = 0
      s.starStock[star] = stock - take
      this.dryHinted.delete(star) // 恢复出货：清沿提示键
    } else if (route.direction === 'relay_out') {
      // 出站回运：货源 = 中转站 H3 缓存（第一段转运的货在此变现）。
      // 上限只按 stock 截断（入站 relay_in 已按缓存截断过；低温中转罐只在卸货口生效，
      // 取货不随挂靠船浮动——避免普通船在罐船填过的站上被 800−stock 额外截断）
      const b = buildingByEndpoint(s, route.from)
      if (!b) { this.detachShipToIdle(ship); return }
      const stock = b.stockH3 ?? 0
      const take = Math.min(cargoCap(s.mods, ship, ring), stock)
      if (take <= 0) {
        if (!this.relayDryHinted) {
          this.relayDryHinted = true
          this.sc.hint(`${buildingDefOf(b.type)?.name ?? '中转站'}无 H3 可运（先建星→站航线转运）`)
        }
        ship.timer = 1
        return
      }
      this.relayDryHinted = false
      const dist = supplyDistCoeff(s, route.from)
      const fuel = roundFuel(s.mods, dist, windowed ? B.gravity.fuelMult : 1, ship, ring)
      ship.speedMult = speed * (windowed ? B.gravity.speedMult : 1)
      ship.legTime = legSeconds(dist, ship.speedMult)
      ship.roundFuel = fuel
      ship.cargo = take
      ship.materials = 0
      b.stockH3 = stock - take
    } else {
      // 反向建材补给线（原有）
      const b = buildingByEndpoint(s, route.to)
      if (!b) { this.detachShipToIdle(ship); return }
      const dist = supplyDistCoeff(s, route.to)
      const fuel = roundFuel(s.mods, dist, windowed ? B.gravity.fuelMult : 1, ship, ring)
      const capWithHook = cargoCap(s.mods, ship, ring) * buildingHookMult(b)
      const want = Math.min(capWithHook, this.owner.buildings.bufferLeft(b))
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

  /** 堆场无货沿提示（星 → 已提示；恢复有货后清键，避免逐帧刷屏） */
  private dryHinted = new Set<string>()
  private hintStarDry(s: SimState, star: StarId): void {
    if (this.dryHinted.has(star)) return
    this.dryHinted.add(star)
    const stock = s.starStock[star] ?? 0
    if (stock <= 0) {
      const hasMines = s.mines.some((m) => depositDefOf(m.depositId)?.planet === star)
      this.sc.hint(hasMines
        ? `${B.stars[star].name}堆场已空 · 等待矿建产出（可在全息勘探扩产）`
        : `${B.stars[star].name}堆场已空 · 尚无矿建产出（全息勘探建采矿机/冶炼厂补货）`)
    }
  }
  private hintStarLow(s: SimState, star: StarId): void {
    if (this.dryHinted.has(star)) return
    this.dryHinted.add(star)
    this.sc.hint(`${B.stars[star].name}堆场存量不足 · 本趟部分装载（运力超过产量）`)
  }

  /** 出站无货提示沿 */
  private relayDryHinted = false

  /** 卸货完成（仅在卸货点触发：正向/出站=地球 / relay_in=中转站 / 反向=站点 / 任务返航=地球） */
  private completeUnload(ship: SimShip): void {
    const s = this.sc.state
    if (ship.mission) {
      ship.mission = false
      ship.state = 'idle'
      s.module.state = 'delivered'
      s.module.shipId = null
      // 2026-09-08 交点单流化：模块交付只判胜利，不再点亮剩余交点（交点唯一来源 = 建设流）
      if (s.outcome === 'playing') {
        s.outcome = 'victory'
        const p = starPosAt(s, 'earth')
        this.sc.emit({ type: 'victory', x: p.x, y: p.y })
      }
      return
    }
    const route = s.routes.find((r) => r.id === ship.routeId)
    if (!route) { this.detachShipToIdle(ship); return }
    if (route.direction === 'forward' || route.direction === 'relay_out') {
      const net = Math.max(0, ship.cargo - ship.roundFuel)
      s.earthH3 += net
      s.ledger.unload += net
      s.stats.delivered += net
      if (route.stats) { route.stats.trips++; route.stats.loaded += ship.cargo }
      const p = starPosAt(s, 'earth')
      this.sc.emit({ type: 'unload', value: Math.round(net), x: p.x, y: p.y })
    } else if (route.direction === 'relay_in') {
      // 入站转运：卸入中转站 H3 缓存（cap 截断；油费船已付，转运损耗 = 无，价值在两段距离差）
      const b = buildingByEndpoint(s, route.to)
      if (b) {
        // 低温中转罐：挂靠船卸货时缓存上限按船级乘区放大（bufferCapMult）
        const cap = this.owner.buildings.bufferCapOf(b, ship)
        const room = Math.max(0, cap - (b.stockH3 ?? 0))
        const drop = Math.min(ship.cargo, room)
        b.stockH3 = (b.stockH3 ?? 0) + drop
        if (route.stats) { route.stats.trips++; route.stats.loaded += ship.cargo }
        const p = buildingPos(s, b)
        this.sc.emit({ type: 'unload', value: Math.round(drop), x: p.x, y: p.y })
        if (drop < ship.cargo) {
          // 站满：剩余随船带回堆场（不罚没），短暂延迟后重试
          const star = starOfEndpoint(s, route.from) as StarId | null
          if (star) s.starStock[star] = (s.starStock[star] ?? 0) + (ship.cargo - drop)
          this.sc.hint('中转站缓存已满 · 剩余货随船退回堆场（扩缓存或加密出站班次）')
        }
      }
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
