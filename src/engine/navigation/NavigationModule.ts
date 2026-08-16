/**
 * NavigationModule — 寻路模块入口（导航系统对外门面）
 *
 * 组合 NavGrid（阻挡栅格）+ AStarPathfinder（寻路），供项目侧使用：
 *   const nav = new NavigationModule()
 *   nav.rebuild()                    // 关卡初始化时重建阻挡格
 *   const path = nav.findPath(...)   // Vector3[] | null
 *
 * 网格从 PhysicsWorld 静态碰撞体自动栅格化（仅 static 建筑）。
 */
import * as THREE from 'three'
import { NavGrid } from './NavGrid'
import { AStarPathfinder } from './AStarPathfinder'

export class NavigationModule {
  readonly grid: NavGrid
  readonly pathfinder: AStarPathfinder

  constructor(cellSize = 1, halfExtent = 32) {
    this.grid = new NavGrid(cellSize, halfExtent)
    this.pathfinder = new AStarPathfinder(this.grid)
  }

  /** 从 PhysicsWorld 静态碰撞体重建阻挡格（返回阻挡格数量） */
  rebuild(): number {
    return this.grid.rebuildFromStaticColliders()
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
}

export { NavGrid } from './NavGrid'
export { AStarPathfinder } from './AStarPathfinder'
