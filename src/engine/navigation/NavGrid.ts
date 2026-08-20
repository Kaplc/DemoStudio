/**
 * NavGrid — 寻路网格（阻挡格自动栅格化）
 *
 * 从静态碰撞体（BoxColliderComponent 且 bodyType=static）的 AABB 自动栅格化生成：
 *  - cell size 默认 1（与建筑网格吸附对齐：建筑中心在整数格）
 *  - 仅静态建筑为障碍（动态兵不参与）
 *  - rebuild 时一次性生成（关卡初始化/基地布局变化时调用）
 *
 * 坐标约定：格子 (i,j) 对应世界中心 (i*cell, j*cell)（俯视 xz 平面）。
 */
import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { PhysicsWorld } from '../physics/PhysicsWorld'

export class NavGrid {
  /** 格边长（世界单位） */
  readonly cellSize: number
  /** 网格半径（格子索引范围 [-halfExtent, halfExtent]） */
  readonly halfExtent: number
  /** 阻挡表：行 Map（j）→ 列 Map（i）→ true。稀疏存储（大地图省内存） */
  private blocked = new Map<number, Set<number>>()

  constructor(cellSize = 1, halfExtent = 32) {
    this.cellSize = cellSize
    this.halfExtent = halfExtent
  }

  /** 世界坐标 → 格子索引 */
  worldToCell(x: number, z: number): [number, number] {
    return [Math.round(x / this.cellSize), Math.round(z / this.cellSize)]
  }

  /** 格子索引 → 世界中心坐标 */
  cellToWorld(i: number, j: number): [number, number] {
    return [i * this.cellSize, j * this.cellSize]
  }

  /** 格子是否阻挡（越界视为阻挡，防走出地图） */
  isBlocked(i: number, j: number): boolean {
    if (Math.abs(i) > this.halfExtent || Math.abs(j) > this.halfExtent) return true
    return this.blocked.get(j)?.has(i) ?? false
  }

  /** 标记/清除单个格子阻挡 */
  setBlocked(i: number, j: number, value: boolean): void {
    let row = this.blocked.get(j)
    if (value) {
      if (!row) {
        row = new Set()
        this.blocked.set(j, row)
      }
      row.add(i)
    } else if (row) {
      row.delete(i)
      if (row.size === 0) this.blocked.delete(j)
    }
  }

  /**
   * 从静态碰撞体 AABB 重建阻挡格。
   * 仅收集 static 且属于建筑层的 Box 碰撞体（动态兵/圆形杂项不参与）。
   */
  rebuildFromStaticColliders(): number {
    this.blocked.clear()
    let count = 0
    // cannon 形状 AABB 计算用 Vec3（body.position/quaternion 也是 cannon 类型）
    const min = new CANNON.Vec3()
    const max = new CANNON.Vec3()
    for (const hit of PhysicsWorld.queryAll(new THREE.Vector3(0, 0, 0), 1e6)) {
      const comp = hit.collider
      if (comp.bodyType !== 'static') continue
      const body = hit.body
      if (body.shapes.length === 0) continue
      // 遍历形状求世界 AABB（不依赖步进/缓存，创建即有效）
      let x0 = Infinity, y0 = Infinity, z0 = Infinity
      let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
      for (let s = 0; s < body.shapes.length; s++) {
        body.shapes[s].calculateWorldAABB(body.position, body.quaternion, min, max)
        if (min.x < x0) x0 = min.x
        if (min.y < y0) y0 = min.y
        if (min.z < z0) z0 = min.z
        if (max.x > x1) x1 = max.x
        if (max.y > y1) y1 = max.y
        if (max.z > z1) z1 = max.z
      }
      if (!Number.isFinite(x0)) continue
      void y0; void y1
      // 路径点格 = 格中心落在 AABB 内的格子（严格贴合，不外扩）。
      // cellToWorld 返回格中心 * cellSize，所以判断用 [x0, x1] 区间内的格中心。
      // 包围盒 [x0,x1] 半开：取下界 ceil、上界 floor，等价于「x0 <= 中心 <= x1」。
      const i0 = Math.ceil(x0 / this.cellSize)
      const i1 = Math.floor(x1 / this.cellSize)
      const j0 = Math.ceil(z0 / this.cellSize)
      const j1 = Math.floor(z1 / this.cellSize)
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          this.setBlocked(i, j, true)
          count++
        }
      }
    }
    return count
  }

  /**
   * 环绕中心格 (ci, cj) 的「环形可走格」（格坐标，不是世界坐标）。
   * 用途：寻路目标被建筑占时，让多个兵分散到不同落脚点（避免全部挤到最近那一格）。
   * 规则：半径从 minR 扩到 maxR；每半径上按 8 方向（NE/E/SE/S/SW/W/NW/N）
   * 均匀采样，若该格被阻挡则跳过。
   */
  freeCellsAround(ci: number, cj: number, minR = 1, maxR = 2): Array<[number, number]> {
    const out: Array<[number, number]> = []
    const seen = new Set<number>()
    const stride = this.halfExtent * 2 + 1
    const key = (i: number, j: number) => (j + this.halfExtent) * stride + (i + this.halfExtent)
    const dirs: Array<[number, number]> = [
      [0, -1], [1, 0], [0, 1], [-1, 0],
      [1, -1], [1, 1], [-1, 1], [-1, -1],
    ]
    for (let r = minR; r <= maxR; r++) {
      for (const [dx, dz] of dirs) {
        const i = ci + dx * r
        const j = cj + dz * r
        if (this.isBlocked(i, j)) continue
        const k = key(i, j)
        if (seen.has(k)) continue
        seen.add(k)
        out.push([i, j])
      }
    }
    return out
  }

  /** 诊断快照（调试/日志用） */
  get blockedCount(): number {
    let n = 0
    for (const row of this.blocked.values()) n += row.size
    return n
  }
}
