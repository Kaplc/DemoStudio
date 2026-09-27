/**
 * MapHitTestComponent — 星图指针命中检测组件（GameMode 上的组件位；2026-09-20 自 WarmCurrentGameMode 下沉）
 *
 * 职责（原 WarmCurrentGameMode 各 *At 命中方法原样迁入）：
 *  - 纯查询无副作用：给定星图画布坐标 p，判定命中的建筑/轨道设施/节点/天体/航线/船；
 *  - 命中口径统一收口"真实 Actor 世界位置"（starActorWorldPos：行星系视角下隐藏天体
 *    Actor 已移远景隔离点，看不见 = 点不到）；
 *  - 视图相关判定（viewStageOffset/starActorPickable）经 owner 读视图状态，
 *    视图状态后续下沉 ViewDirectorComponent 后此处不改口径。
 */
import { BObjectComponent } from '@/engine'
import { B, MAP_H, MAP_W } from '../core/balance'
import { buildingDefOf, buildingPos, hiddenActorIsolated, orbitBuildingPos } from '../core/helpers'
import { BLUEPRINT_BODIES } from './OrbitBlueprintComponent'
import type { Endpoint, OrbitBuilding, SimBuilding, PlanetId } from '../core/types'
import type { SolarBodyId } from '../core/helpers'
import type { StarBodyId } from '../map/StarActor'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

/** 地面建筑命中半径（地图px；buildingAt 选中与 nodeAt 拖线端点共用，改口径两处同步） */
export const BUILDING_HIT_R = 26

export function dist(px: number, py: number, x: number, y: number): number {
  return Math.hypot(px - x, py - y)
}

export function segDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const len2 = abx * abx + aby * aby
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2)) : 0
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t))
}

export class MapHitTestComponent extends BObjectComponent<WarmCurrentGameMode> {
  constructor(owner: WarmCurrentGameMode) {
    super(owner)
    this.name = 'MapHitTestComponent'
  }

  /** 地面建筑命中（入轨建筑按实时位置判定，放置静态落点会随公转漂移） */
  buildingAt(p: { x: number; y: number }): SimBuilding | null {
    const s = this.owner.simState.state
    for (const b of s.buildings) {
      const bp = buildingPos(s, b)
      if (dist(p.x, p.y, bp.x, bp.y) <= BUILDING_HIT_R + B.map.hitTolerance) return b
    }
    return null
  }

  /** 近地轨道设施命中（绕锚行星均布公转，实时位置同口径；点中 = 打开轨道建设面板） */
  orbitBuildingAt(p: { x: number; y: number }): OrbitBuilding | null {
    const s = this.owner.simState.state
    for (const ob of s.orbitBuildings) {
      const op = orbitBuildingPos(s, ob)
      if (dist(p.x, p.y, op.x, op.y) <= 24 + B.map.hitTolerance) return ob
    }
    return null
  }

  /** 功能范围命中（radius>0 建筑的示意范围，半径与赤道环渲染同值=表值 radius 地图px）；
   *  多建筑范围重叠取离核心最近者 */
  buildingZoneAt(p: { x: number; y: number }): SimBuilding | null {
    const s = this.owner.simState.state
    let best: SimBuilding | null = null
    let bestD = Infinity
    for (const b of s.buildings) {
      const def = buildingDefOf(b.type)
      if (!def || def.radius <= 0) continue
      const bp = buildingPos(s, b)
      const d = dist(p.x, p.y, bp.x, bp.y)
      if (d <= def.radius && d < bestD) { best = b; bestD = d }
    }
    return best
  }

  /** 天体当前视图下是否可点（与渲染 visibleBodySet 同口径：行星系视角 = 聚焦行星 + 其卫星）。
   *  轨道蓝图台（2026-09-29）：太阳已移除——不可点（点地图中心不再误出"全景已屏蔽"提示） */
  starActorPickable(body: SolarBodyId): boolean {
    if (this.owner.routeEditMode && body === 'sun') return false
    if (this.owner.viewMode === 'solar') return true
    const focus = this.owner.planetFocusBody as PlanetId
    if (body === focus) return true
    const mc = B.map.moons[body as keyof typeof B.map.moons]
    return !!mc && mc.parent === focus
  }

  /** 太阳命中（点击聚焦取景，不参与航线端点/拖拽）。
   *  ⚠ 判定收口：行星系视角下太阳本体被渲染隐藏（sunMesh.visible=false），
   *  Actor 虽钉在舞台锚（世界原点）但 pickable=false，不可点。 */
  sunAt(p: { x: number; y: number }): boolean {
    if (!this.starActorPickable('sun')) return false
    const s0 = B.map.nodes.sun
    return dist(p.x, p.y, s0.x, s0.y) <= s0.r + B.map.hitTolerance
  }

  /** 天体蓝图 Actor 的世界位置 → 星图画布坐标（Actor 不存在 = 蓝图生成失败，按同口径
   *  隔离计算兜底：hiddenActorIsolated → 画布系减舞台位移，与 Actor 主分支同构——
   *  行星系视角下隐藏天体兜底坐标同样远离地图画布 → 命中半径恒不覆盖）。 */
  starActorWorldPos(body: keyof typeof B.map.nodes): { x: number; y: number } | null {
    const off = this.owner.viewStageOffset()
    const actor = this.owner.starActors.get(body as StarBodyId)
    if (!actor) {
      const iso = hiddenActorIsolated(this.owner.simState.state, body as SolarBodyId, this.owner.viewMode, this.owner.planetFocusBody as PlanetId)
      return { x: iso.x + MAP_W / 2 - off.x, y: iso.z + MAP_H / 2 - off.z }
    }
    const root = actor.root
    return { x: root.position.x + MAP_W / 2 - off.x, y: root.position.z + MAP_H / 2 - off.z }
  }

  /** 航线端点命中：资源星（须已解锁）→ 地球 → 可接航线建筑（中转站） */
  nodeAt(p: { x: number; y: number }): Endpoint | null {
    const s = this.owner.simState.state
    for (const star of Object.values(B.stars)) {
      // 轨道蓝图台（2026-09-29 其他星球移除）：补给线端点只留月球（地月系），
      // europa/mars 端点不命中（星球本体已退场，不可向空处拖线）
      if (this.owner.routeEditMode && !BLUEPRINT_BODIES.has(star.id)) continue
      if (!this.owner.transport.starUnlocked(star.id)) continue
      const pos = this.starActorWorldPos(star.id)
      if (!pos) continue
      if (dist(p.x, p.y, pos.x, pos.y) <= B.map.nodes[star.id].r + B.map.hitTolerance) {
        return { kind: 'star', star: star.id }
      }
    }
    const e = this.starActorWorldPos('earth')
    if (e && dist(p.x, p.y, e.x, e.y) <= B.map.nodes.earth.r + B.map.hitTolerance) return { kind: 'earth' }
    // 可接航线建筑（中转站）= 补给线端点：hover/落点判定走这里；命中半径与 buildingAt 同口径
    for (const b of s.buildings) {
      if (!buildingDefOf(b.type)?.linkable) continue
      const bp = buildingPos(s, b)
      if (dist(p.x, p.y, bp.x, bp.y) <= BUILDING_HIT_R + B.map.hitTolerance) {
        return { kind: 'building', buildingId: b.id }
      }
    }
    return null
  }

  /** 任意天体命中（双击聚焦 + 星球信息面板共用：行星 + 卫星，含未解锁资源星；
   *  太阳走聚焦取景不进面板）。2026-09-15 起双击聚焦也走本判定（原 planetAt 排除卫星
   *  的旧口径随"月球可双击聚焦"移除，判定统一收口此处）。
   *  ⚠ 判定收口到"真实 Actor 世界位置"（行星系视角下隐藏天体 Actor 已移远景，
   *  看不见 = 点不到；太阳系全景 Actor 全在公转位，渲染在哪就点哪）。 */
  bodyAt(p: { x: number; y: number }): SolarBodyId | null {
    for (const body of Object.keys(B.map.nodes) as Array<SolarBodyId>) {
      if (body === 'sun') continue
      // 轨道蓝图台（2026-09-29 其他星球移除）：地月系之外的天体不可点——
      // 信息面板/双击聚焦一并收口（不显示的天体点不到）
      if (this.owner.routeEditMode && !BLUEPRINT_BODIES.has(body)) continue
      if (!this.starActorPickable(body)) continue
      const pos = this.starActorWorldPos(body)
      if (!pos) continue
      if (dist(p.x, p.y, pos.x, pos.y) <= B.map.nodes[body].r + B.map.hitTolerance) return body
    }
    return null
  }
}
