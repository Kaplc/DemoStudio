/**
 * ActorUtils — Actor 生命周期与查询工具函数集
 *
 * 封装 World/ActorManagerComponent 中常用的 Actor 增删查方法，
 * 统一入口，避免直接访问 actorMgr 内部实现。
 * 所有方法内部获取 World，无需外部传入。
 */
import { GameInstance } from './GameInstance'
import { PreviewObjectFactoryComponent } from './PreviewObjectFactoryComponent'
import type { Actor } from '../entity/Actor'
import type { BObject } from '../entity/BObject'
import type { Component } from '../entity/Component'
import type { World } from './World'
import type { PropertyPatch } from '../tools/deepMerge'
import type { BlueprintComponentDef } from '../asset/BlueprintAsset'

/** 统一获取活跃世界：运行时 GameInstance.current，编辑器预览回退到预览工厂 */
function getWorld(): World {
  const world = GameInstance.current?.getWorld() ?? PreviewObjectFactoryComponent.getCurrentWorld()
  if (!world) throw new Error('[ActorUtils] 当前没有活跃 GameInstance 或未关联 World')
  return world
}

/** 统一获取活跃世界（可返回 null） */
function tryGetWorld(): World | null {
  return GameInstance.current?.getWorld() ?? PreviewObjectFactoryComponent.getCurrentWorld()
}

// ═══════════════════════════════════
//  Spawn
// ═══════════════════════════════════

/**
 * 注册已有 Actor 实例到世界（BeginPlay 队列）。
 */
export function spawnActor<T extends Actor>(actor: T): T {
  const world = tryGetWorld()
  if (!world) throw new Error('[ActorUtils] spawnActor: 当前没有活跃 GameInstance 或未关联 World')
  world.actorMgr.SpawnActor(actor)
  return actor
}

/**
 * 构造 Actor 子类实例并注册到世界。
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
 */
export function spawnFromBlueprint(
  path: string,
  overrides?: PropertyPatch,
  componentOverrides?: BlueprintComponentDef[],
): Actor | null {
  return tryGetWorld()?.actorMgr.SpawnActorFromBlueprint(path, overrides, componentOverrides) ?? null
}

// ═══════════════════════════════════
//  Destroy
// ═══════════════════════════════════

/**
 * 销毁单个 Actor（标记待销毁，下帧 World.tick 时执行清理）。
 * 会递归销毁子 Actor（attachTo 树）。
 */
export function destroyActor(actor: Actor): void {
  const world = tryGetWorld()
  world?.actorMgr.DestroyActor(actor)
}

/**
 * 通用对象销毁入口。
 * - Actor → 走 pendingDestroy 队列（tick 时执行清理）
 * - 其他 BObject → 立即 EndPlay
 */
export function destroyObject(obj: BObject): void {
  const world = tryGetWorld()
  world?.actorMgr.DestroyObject(obj)
}

// ═══════════════════════════════════
//  Find
// ═══════════════════════════════════

/**
 * 查找世界中第一个指定类型的 Actor。
 * 搜索范围：已生成 + 待生成（pendingSpawn）。
 */
export function findActor<T extends Actor>(type: new (...args: any[]) => T): T | null {
  return tryGetWorld()?.actorMgr.FindActor(type) ?? null
}

/**
 * 查找世界中所有指定类型的 Actor。
 * 搜索范围：仅已生成（不含 pendingSpawn）。
 */
export function findActors<T extends Actor>(type: new (...args: any[]) => T): T[] {
  return tryGetWorld()?.actorMgr.FindActors(type) ?? []
}

/**
 * 获取世界中所有已生成的 Actor。
 */
export function getAllActors(): Actor[] {
  return tryGetWorld()?.actorMgr.GetAllActors() ?? []
}

/**
 * 在世界中查找所有挂载了指定 Component 类型的 Actor 及其实例。
 */
export function getAllActorComponents<T extends Component>(
  type: new (...args: any[]) => T,
): T[] {
  return tryGetWorld()?.actorMgr.getAllActorComponents(type) ?? []
}
