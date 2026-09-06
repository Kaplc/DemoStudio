/**
 * MapData — 省份图数据 + A* 寻路（core 纯逻辑）
 *
 * map.json 载入后一次性建索引（plan R2：邻接查询在战斗/寻路高频，禁线性扫描）。
 * 寻路约束：只走陆地省；敌对省可走（用于进攻路线），不可控省不可通行 = 海洋。
 */
import type { MapDef, ProvinceDef, StateDef } from './types'

export class MapData {
  readonly def: MapDef
  readonly provinces: Map<number, ProvinceDef>
  readonly states: Map<number, StateDef>
  readonly adjacency: Map<number, number[]>

  constructor(def: MapDef) {
    this.def = def
    this.provinces = new Map()
    for (const [k, p] of Object.entries(def.provinces)) {
      this.provinces.set(Number(k), p)
    }
    this.states = new Map()
    for (const s of def.states) this.states.set(s.id, s)
    // 邻接表深拷贝（防止共享引用被运行时意外篡改）
    this.adjacency = new Map()
    for (const [k, p] of this.provinces) {
      this.adjacency.set(k, [...p.neighbors])
    }
  }

  get provinceCount(): number {
    return this.provinces.size
  }

  province(id: number): ProvinceDef | null {
    return this.provinces.get(id) ?? null
  }

  state(id: number): StateDef | null {
    return this.states.get(id) ?? null
  }

  isLand(id: number): boolean {
    const p = this.province(id)
    return !!p && !p.sea
  }

  /** 省中心像素 → 世界坐标（地图平面中心为原点，x 右 / z 下） */
  provinceWorldPos(id: number): { x: number; z: number } | null {
    const p = this.province(id)
    if (!p) return null
    const u = this.def.pxPerUnit
    return {
      x: p.x / u - this.def.worldWidth / 2,
      z: p.y / u - this.def.worldHeight / 2,
    }
  }

  /** 某国的全部陆地省（按当前核心归属 states.owner） */
  provincesOfTag(tag: string): number[] {
    const out: number[] = []
    for (const s of this.states.values()) {
      if (s.owner === tag) out.push(...s.provinces)
    }
    return out
  }

  /** 某国的全部州 id */
  statesOfTag(tag: string): StateDef[] {
    return [...this.states.values()].filter((s) => s.owner === tag)
  }

  /** 省的州 */
  stateOfProvince(id: number): StateDef | null {
    const p = this.province(id)
    return p ? this.state(p.state) : null
  }

  /**
   * A* 最短路（陆地省图；海洋不可通行）。
   * passable 额外通行判定（如只走己方/盟友省）；heuristic = 欧氏像素距离。
   * @returns 省路径（含起点终点）；不可达返回 null
   */
  findPath(from: number, to: number, passable?: (pid: number) => boolean): number[] | null {
    if (!this.isLand(from) || !this.isLand(to)) return null
    if (from === to) return [from]
    const open: number[] = [from]
    const gScore = new Map<number, number>([[from, 0]])
    const fScore = new Map<number, number>([[from, this.hDist(from, to)]])
    const cameFrom = new Map<number, number>()
    while (open.length > 0) {
      // 取 f 最小（线性扫：省图规模 ~400，无需二叉堆）
      let bi = 0
      for (let i = 1; i < open.length; i++) {
        if ((fScore.get(open[i]) ?? Infinity) < (fScore.get(open[bi]) ?? Infinity)) bi = i
      }
      const cur = open.splice(bi, 1)[0]
      if (cur === to) return this.reconstruct(cameFrom, cur)
      for (const nb of this.adjacency.get(cur) ?? []) {
        if (!this.isLand(nb)) continue
        if (passable && !passable(nb)) continue
        const step = this.moveHours(nb)
        const tentative = (gScore.get(cur) ?? Infinity) + step
        if (tentative < (gScore.get(nb) ?? Infinity)) {
          cameFrom.set(nb, cur)
          gScore.set(nb, tentative)
          fScore.set(nb, tentative + this.hDist(nb, to))
          if (!open.includes(nb)) open.push(nb)
        }
      }
    }
    return null
  }

  private reconstruct(cameFrom: Map<number, number>, cur: number): number[] {
    const path = [cur]
    while (cameFrom.has(cur)) {
      cur = cameFrom.get(cur)!
      path.unshift(cur)
    }
    return path
  }

  private hDist(a: number, b: number): number {
    const pa = this.province(a)
    const pb = this.province(b)
    if (!pa || !pb) return Infinity
    return Math.hypot(pa.x - pb.x, pa.y - pb.y) / 24
  }

  /** 行军代价（小时）：基础 × 地形系数 */
  moveHours(pid: number): number {
    const p = this.province(pid)
    return p ? p.terrain === 'ocean' ? Infinity : 10 * (1 + (p.terrain === 'mountain' ? 1 : p.terrain === 'hills' || p.terrain === 'marsh' ? 0.5 : 0)) : Infinity
  }
}
