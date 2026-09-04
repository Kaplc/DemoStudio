/**
 * ClashBaseBuilder — 部落冲突基地初始建筑布局构建器
 *
 * 职责：
 *  - 初始建筑布局（townhall/barracks/goldmine/elixir/cannon/wall）
 *  - 放置预览的宿主 Actor（decor，GameMode 把半透明预览方块挂到它上面）
 *
 * 草地与景物（路/池塘/树/石/花/栅栏）由场景资产 fish_base.scene.json 声明
 * （World.SwitchToScene → loadSceneAsActors 统一生成，草地 kind:standard 接收阴影），
 * 本类不再创建任何装饰网格。
 *
 * 建筑放置的运行时交互（选中/移动/删除/占用表/预览）由 FishBaseGameMode 管理，
 * 本类只负责"初始布局"的创建与预览宿主的持有。
 *
 * 生命周期：继承 BObject（构造自动注册到 ObjectRegistry），
 * 由 GameMode.BeginPlay 创建并驱动 build()，GameMode.EndPlay 驱动 EndPlay()（自动注销）。
 */
import { BObject, GenericActor, spawnActor, logger } from '@/engine'
import type { World } from '@/engine'

/** 放置区域半边长（世界单位）：覆盖整个草地（±24），每格 1 单位 */
export const PLACE_HALF = 24

/** 初始建筑布局：类型 id + 格子坐标（网格吸附，格子坐标 = 世界坐标整数） */
const INITIAL_LAYOUT: ReadonlyArray<{ id: string; gx: number; gz: number }> = [
  { id: 'townhall', gx: 0, gz: 0 },
  { id: 'barracks', gx: -3, gz: 2 },
  { id: 'goldmine', gx: 3, gz: -2 },
  { id: 'elixir', gx: -3, gz: -3 },
  { id: 'cannon', gx: 3, gz: 3 },
  { id: 'laboratory', gx: 4, gz: 1 },
  { id: 'wall', gx: 2, gz: 1 },
  { id: 'wall', gx: 1, gz: 2 },
  { id: 'wall', gx: 0, gz: 2 },
]

export class ClashBaseBuilder extends BObject {
  /** 所属 World（build 时用于托管 Actor） */
  readonly world: World
  /** 预览兜底宿主 Actor（正常路径预览挂场景资产的 BattleGround，本 Actor 仅在场景缺失时兜底） */
  decor: GenericActor | null = null

  constructor(world: World) {
    super('ClashBaseBuilder')
    this.world = world
  }

  /**
   * 构建初始建筑布局 + 创建预览宿主。
   * @param placeBuilding 放置建筑回调（由 GameMode 提供：维护占用表/列表等运行时状态）
   */
  build(placeBuilding: (typeId: string, gx: number, gz: number) => boolean): void {
    // ─── 预览宿主 Actor：放置预览方块统一挂载，经 World 托管生命周期 ───
    // （DestroyAllActors/Destroy 时组件 EndPlay 自动释放 geometry/material）
    const decor = new GenericActor('ClashDecor')
    spawnActor(decor)
    this.decor = decor

    // ─── 初始建筑（部落冲突开局布局）───
    for (const { id, gx, gz } of INITIAL_LAYOUT) {
      placeBuilding(id, gx, gz)
    }

    logger.info(`[BaseBuilder] 基地初始布局已构建（草地/景物由场景资产 FishBaseIsland 声明，放置范围 ±${PLACE_HALF}）`)
  }

  override EndPlay(): void {
    // 预览宿主 Actor 由 World.DestroyAllActors 统一销毁（组件 EndPlay 自动释放资源），
    // 这里只清引用
    logger.info('[BaseBuilder] EndPlay: 清理预览兜底宿主引用（decor 由 World 统一销毁）')
    this.decor = null
    super.EndPlay()
  }
}
