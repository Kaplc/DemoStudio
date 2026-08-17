/**
 * NewActor — Actor 静态工厂
 *
 * 统一入口：NewActor.Spawn<T>(...args)
 * 内部自动 new + SpawnActor + 返回带 world 引用的实例。
 *
 * 使用示例：
 *   const fish = NewActor.Spawn(EatFishFoodPawn)
 *   const pawn = NewActor.Spawn(EatFishPawn)
 */
import { Actor } from './Actor'
import { GameInstance } from '../gameflow/GameInstance'

export class NewActor {
  /**
   * 在当前 GameInstance 关联的 World 中生成 Actor。
   * 等价于 `world.SpawnActor(new T(...args))`，但合成一步调用。
   *
   * @param Ctor  Actor 子类构造器
   * @param args  构造器参数
   */
  static Spawn<Ctor extends new (...args: any[]) => Actor>(
    Ctor: Ctor,
    ...args: ConstructorParameters<Ctor>
  ): InstanceType<Ctor> {
    const inst = GameInstance.current
    const world = inst?.getWorld()
    if (!world) throw new Error('[NewActor] 当前没有活跃的 GameInstance 或未关联 World')
    const actor = new Ctor(...args)
    world.SpawnActor(actor)
    return actor as InstanceType<Ctor>
  }
}
