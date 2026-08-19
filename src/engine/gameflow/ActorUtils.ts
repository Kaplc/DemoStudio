/**
 * ActorUtils — Actor 生命周期与查询工具函数集
 *
 * 封装 World/ActorManagerComponent 中常用的 Actor 增删查方法，
 * 统一入口，避免直接访问 actorMgr 内部实现。
 */
import { GameInstance } from './GameInstance'
import type { Actor } from '../entity/Actor'
import type { BObject } from '../entity/BObject'
import type { Component } from '../entity/Component'
import type { World } from './World'
import type { ActorManagerComponent } from './ActorManagerComponent'
import type { PropertyPatch } from '../tools/deepMerge'
import type { BlueprintComponentDef } from '../asset/BlueprintAsset'

/**
 * 从 World 或 ActorManagerComponent 获取查询/操作接口。
 */
function getActorMgr(world: World): ActorManagerComponent {
  return world.actorMgr
}

/**
 * 注册已有 Actor 实例到世界（BeginPlay 队列）。
 * 内部使用 GameInstance.current 获取活跃世界。
 */
export function spawnActor<T extends Actor>(actor: T): T {
  const world = GameInstance.current?.getWorld()
  if (!world) throw new Error('[ActorUtils] spawnActor: 当前没有活跃 GameInstance 或未关联 World')
  getActorMgr(world).SpawnActor(actor)
  return actor
}

/**
 * 构造 Actor 子类实例并注册到世界。
 * 等价于 new T(...args) + spawnActor(actor)。
 */
export function spawnActorOfType<T extends Actor, A extends unknown[]>(
  type: new (...args: A) => T,
  ...args: A
): T {
  const actor = new type(...args)
  return spawnActor(actor)
}

/**
 * 从 Blueprint 实例化 Actor 并注册到世界。
 * @param world  目标世界
 * @param path   Blueprint id
 * @param overrides       实例级覆盖（position/rotation/scale/自定义参数）
 * @param componentOverrides 实例级组件属性覆盖
 */
export function spawnFromBlueprint(
  world: World,
  path: string,
  overrides?: PropertyPatch,
  componentOverrides?: BlueprintComponentDef[],
): Actor | null {
  return getActorMgr(world).SpawnActorFromBlueprint(path, overrides, componentOverrides)
}

/**
 * 销毁单个 Actor（标记待销毁，下帧 World.tick 时执行清理）。
 * 会递归销毁子 Actor（attachTo 树）。
 */
export function destroyActor(world: World, actor: Actor): void {
  getActorMgr(world).DestroyActor(actor)
}

/**
 * 通用对象销毁入口。
 * - Actor → 走 pendingDestroy 队列（tick 时执行清理）
 * - 其他 BObject → 立即 EndPlay
 */
export function destroyObject(world: World, obj: BObject): void {
  getActorMgr(world).DestroyObject(obj)
}

/**
 * 查找世界中第一个指定类型的 Actor。
 * 搜索范围：已生成 + 待生成（pendingSpawn）。
 * @returns 首个匹配实例；无则返回 null
 */
export function findActor<T extends Actor>(world: World, type: new (...args: any[]) => T): T | null {
  return getActorMgr(world).FindActor(type)
}

/**
 * 查找世界中所有指定类型的 Actor。
 * 搜索范围：仅已生成（不含 pendingSpawn）。
 * @returns 匹配实例数组（无则空数组）
 */
export function findActors<T extends Actor>(world: World, type: new (...args: any[]) => T): T[] {
  return getActorMgr(world).FindActors(type)
}

/**
 * 获取世界中所有已生成的 Actor。
 * @returns Actor 快照数组
 */
export function getAllActors(world: World): Actor[] {
  return getActorMgr(world).GetAllActors()
}

/**
 * 在世界中查找所有挂载了指定 Component 类型的 Actor 及其实例。
 * @param world  世界实例
 * @param type   Component 构造函数
 * @returns 匹配组件数组（无则空数组）
 */
export function getAllActorComponents<T extends Component>(
  world: World,
  type: new (...args: any[]) => T,
): T[] {
  return getActorMgr(world).getAllActorComponents(type)
}
