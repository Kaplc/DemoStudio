/**
 * ClashBaseBuilder — 部落冲突基地地图构建器（专门负责创建基地地图）
 *
 * 职责：
 *  - 垫底地面（48x48，承接整个基地）
 *  - 中央草地（11x11，部落冲突风格方形草地）
 *  - 初始建筑布局（townhall/barracks/goldmine/elixir/cannon/wall）
 *
 * 建筑放置的运行时交互（选中/移动/删除/占用表/预览）由 FishBaseGameMode 管理，
 * 本类只负责"地图"本身的创建与持有。
 *
 * 生命周期：继承 BObject（构造自动注册到 ObjectRegistry），
 * 由 GameMode.BeginPlay 创建并驱动 build()，GameMode.EndPlay 驱动 EndPlay()（自动注销）。
 */
import * as THREE from 'three'
import { BObject, GenericActor, MeshComponent, logger } from '@/engine'
import type { World } from '@/engine'

/** 放置区域半边长（世界单位）：覆盖整个 48x48 地面（±24），每格 1 单位 */
export const PLACE_HALF = 24

/** 初始建筑布局：类型 id + 格子坐标（网格吸附，格子坐标 = 世界坐标整数） */
const INITIAL_LAYOUT: ReadonlyArray<{ id: string; gx: number; gz: number }> = [
  { id: 'townhall', gx: 0, gz: 0 },
  { id: 'barracks', gx: -3, gz: 2 },
  { id: 'goldmine', gx: 3, gz: -2 },
  { id: 'elixir', gx: -3, gz: -3 },
  { id: 'cannon', gx: 3, gz: 3 },
  { id: 'wall', gx: 2, gz: 1 },
  { id: 'wall', gx: 1, gz: 2 },
  { id: 'wall', gx: 0, gz: 2 },
]

export class ClashBaseBuilder extends BObject {
  /** 所属 World（build 时用于创建网格/托管 Actor） */
  readonly world: World
  /** 装饰根 Actor（地面/草地统一挂载，经 World 托管生命周期） */
  decor: GenericActor | null = null
  /** 垫底地面 mesh（48x48） */
  ground: THREE.Mesh | null = null
  /** 中央草地 mesh（11x11） */
  grass: THREE.Mesh | null = null

  constructor(world: World) {
    super('ClashBaseBuilder')
    this.world = world
  }

  /**
   * 构建基地地图：垫底地面 + 中央草地 + 初始建筑布局。
   * @param placeBuilding 放置建筑回调（由 GameMode 提供：维护占用表/列表等运行时状态）
   */
  build(placeBuilding: (typeId: string, gx: number, gz: number) => boolean): void {
    const world = this.world

    // ─── 装饰根 Actor：地面/草地统一挂载，经 World 托管生命周期 ───
    // （DestroyAllActors/Destroy 时组件 EndPlay 自动释放 geometry/material）
    const decor = new GenericActor('ClashDecor')

    // ─── 垫底地面（场景资产已清空，提供整体地面承接装饰）───
    const ground = world.createPlaneMesh(48, 48, 0x2e7d32)
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.05
    decor.addComponent(new MeshComponent(decor, ground, 'GroundMesh'))

    // ─── 草地（部落冲突风格：方形草地地图，中央区域）───
    const grass = world.createPlaneMesh(11, 11, 0x7cb342)
    grass.rotation.x = -Math.PI / 2
    grass.position.y = -0.02
    decor.addComponent(new MeshComponent(decor, grass, 'GrassMesh'))

    // 装饰 Actor 进 World 统一管理
    world.SpawnActor(decor)
    this.decor = decor
    this.ground = ground
    this.grass = grass

    // ─── 初始建筑（部落冲突开局布局）───
    for (const { id, gx, gz } of INITIAL_LAYOUT) {
      placeBuilding(id, gx, gz)
    }

    logger.info(`[BaseBuilder] 基地地图已构建（放置范围 ±${PLACE_HALF}，覆盖整个地面）`)
  }

  override EndPlay(): void {
    // 装饰 Actor 由 World.DestroyAllActors 统一销毁（组件 EndPlay 自动释放资源），
    // 这里只清引用
    this.decor = null
    this.ground = null
    this.grass = null
    super.EndPlay()
  }
}
