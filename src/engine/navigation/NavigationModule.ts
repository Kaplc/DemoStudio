/**
 * NavigationModule — 寻路模块入口（导航系统对外门面）
 *
 * 组合 NavGrid（阻挡栅格）+ AStarPathfinder（寻路），供项目侧使用：
 *   const nav = new NavigationModule()
 *   nav.rebuild(world.physics)       // 关卡初始化时重建阻挡格
 *   const path = nav.findPath(...)   // Vector3[] | null
 *
 * 网格从所属 World 的 PhysicsWorld 实例静态碰撞体自动栅格化（仅 static 建筑）。
 */
import * as THREE from 'three'
import { NavGrid } from './NavGrid'
import { AStarPathfinder } from './AStarPathfinder'
import type { PhysicsWorld } from '../physics/PhysicsWorld'

export class NavigationModule {
  readonly grid: NavGrid
  readonly pathfinder: AStarPathfinder

  constructor(cellSize = 1, halfExtent = 32) {
    this.grid = new NavGrid(cellSize, halfExtent)
    this.pathfinder = new AStarPathfinder(this.grid)
  }

  /** 从所属 World 的物理实例静态碰撞体重建阻挡格（返回阻挡格数量） */
  rebuild(physics: PhysicsWorld): number {
    return this.grid.rebuildFromStaticColliders(physics)
  }

  /**
   * 寻路：世界坐标 → 世界坐标路径点序列（Vector3，y=0）。
   * 无路径返回 null（调用方回退直线移动）。
   */
  findPath(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] | null {
    const path = this.pathfinder.findPath(from.x, from.z, to.x, to.z)
    if (!path) return null
    return path.map(([x, z]) => new THREE.Vector3(x, 0, z))
  }

  /** 点位是否被阻挡（直接查询格） */
  isBlockedAt(x: number, z: number): boolean {
    const [i, j] = this.grid.worldToCell(x, z)
    return this.grid.isBlocked(i, j)
  }

  /**
   * 为单个兵分配「建筑环绕位置」（CoC 风格 rounded-square）。
   * spanIdx 语义：rank*8 + sub（rank=圈编号 0..N，sub=8 方位内子编号）
   * 规则：
   *  - rank = floor(spanIdx / 8) → 第几圈（半径 rank + 1）
   *  - sub  = spanIdx % 8     → 圈内第几号
   *  - 偶数 rank 用 4 正方形方向（N/E/S/W），奇数 rank 用 4 对角方向（NE/SE/SW/NW）
   *    → 让外圈与内圈交错 45°，多兵均匀分布
   *  - 该格被阻挡 → 沿螺旋方向就近吸附到第一个可走格；找不到返回 null
   */
  pickBuildingSlot(buildingCenter: THREE.Vector3, spanIdx: number): THREE.Vector3 | null {
    const [ci, cj] = this.grid.worldToCell(buildingCenter.x, buildingCenter.z)
    const rank = Math.floor(spanIdx / 8)
    const sub = spanIdx % 8
    const r = rank + 1
    const cardinal: Array<[number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]]
    const diagonal: Array<[number, number]> = [[1, -1], [1, 1], [-1, 1], [-1, -1]]
    const group = (rank % 2 === 0) ? cardinal : diagonal
    const slotInGroup = sub % 4
    const extend = (sub >= 4) ? 1 : 0
    const [bdx, bdz] = group[slotInGroup]
    const i = ci + bdx * (r + extend)
    const j = cj + bdz * (r + extend)
    if (this.grid.isBlocked(i, j)) {
      const spiral = this.spiralOffsets(r + 2)
      for (const [ox, oz] of spiral) {
        const ii = ci + ox
        const jj = cj + oz
        if (!this.grid.isBlocked(ii, jj)) {
          const [x, z] = this.grid.cellToWorld(ii, jj)
          return new THREE.Vector3(x, 0, z)
        }
      }
      return null
    }
    const [x, z] = this.grid.cellToWorld(i, j)
    return new THREE.Vector3(x, 0, z)
  }

  /**
   * 枚举建筑 hitbox 周围所有候选站位格（rank 0..maxR，8 方位/圈）。
   * 给兵"自取最近可走格"用：兵自己按距离排序、再按同伴避让挑一个。
   * 返回 rank 内每个方位的第一个可走格（被阻挡的格自动用 spiral 吸附到下一个）。
   * 注：返回的是 rank 内 8 个方位的"代表点"，不是逐 cell 展开（参 pickBuildingSlot）。
   * 首次调用会在 `out` 中分配容量，之后稳定复用（0 GC）。
   */
  enumerateStandPoints(buildingCenter: THREE.Vector3, maxR: number, out: THREE.Vector3[]): number {
    let count = 0
    for (let rank = 0; rank <= maxR; rank++) {
      for (let sub = 0; sub < 8; sub++) {
        const spanIdx = rank * 8 + sub
        // 确保 out[idx] 存在（首次调用 lazy 分配）
        if (!out[count]) out[count] = new THREE.Vector3()
        const ok = this.pickBuildingSlotInto(buildingCenter, spanIdx, out[count])
        if (ok) {
          count++
        }
      }
    }
    return count
  }

  /**
   * 与 pickBuildingSlot 同语义，但写入调用方传入的 Vector3（被阻挡走 spiral 时也复用同一 out），
   * 不 new Vector3。返回 out 或 null（被围死无任何可走格）。
   */
  pickBuildingSlotInto(buildingCenter: THREE.Vector3, spanIdx: number, out: THREE.Vector3): THREE.Vector3 | null {
    const [ci, cj] = this.grid.worldToCell(buildingCenter.x, buildingCenter.z)
    const rank = Math.floor(spanIdx / 8)
    const sub = spanIdx % 8
    const r = rank + 1
    const cardinal: Array<[number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]]
    const diagonal: Array<[number, number]> = [[1, -1], [1, 1], [-1, 1], [-1, -1]]
    const group = (rank % 2 === 0) ? cardinal : diagonal
    const slotInGroup = sub % 4
    const extend = (sub >= 4) ? 1 : 0
    const [bdx, bdz] = group[slotInGroup]
    const i = ci + bdx * (r + extend)
    const j = cj + bdz * (r + extend)
    if (!this.grid.isBlocked(i, j)) {
      const [x, z] = this.grid.cellToWorld(i, j)
      out.set(x, 0, z)
      return out
    }
    // 被阻挡：spiral 吸附
    const spiral = this.spiralOffsets(r + 2)
    for (const [ox, oz] of spiral) {
      const ii = ci + ox
      const jj = cj + oz
      if (!this.grid.isBlocked(ii, jj)) {
        const [x, z] = this.grid.cellToWorld(ii, jj)
        out.set(x, 0, z)
        return out
      }
    }
    return null
  }

  /** 半径 N 内的格子偏移（按距离递增 → 外扩），用于找不到精确 slot 时就近吸附 */
  spiralOffsets(maxR: number): Array<[number, number]> {
    const out: Array<[number, number]> = []
    const seen = new Set<number>()
    const key = (i: number, j: number) => i * 1000 + j
    const dirs: Array<[number, number]> = [
      [0, -1], [1, 0], [0, 1], [-1, 0],
      [1, -1], [1, 1], [-1, 1], [-1, -1],
    ]
    for (let r = 1; r <= maxR; r++) {
      for (const [dx, dz] of dirs) {
        const k = key(dx * r, dz * r)
        if (seen.has(k)) continue
        seen.add(k)
        out.push([dx * r, dz * r])
      }
    }
    return out
  }
}

export { NavGrid } from './NavGrid'
export { AStarPathfinder } from './AStarPathfinder'
