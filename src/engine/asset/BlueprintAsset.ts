/**
 * BlueprintAsset — Blueprint 资产类型定义
 *
 * 一个 Blueprint = "这个 Actor 子类默认长什么样" + 可选继承（parent）。
 * 对应 Unity Prefab / UE Blueprint Class 的"类定义 + CDO 默认值"。
 *
 * 设计取舍：行为逻辑由 baseClass（TS Actor 子类）承载；
 * 数据（Component 组合 / 子 Actor / 默认属性 / 继承）由本资产描述。不引入可视化脚本。
 *
 * Actor 生成统一经静态方法 Instantiate，禁止通过 World 直接创建。
 */
import type { PropertyPatch } from '../tools/deepMerge'
import type { Actor } from '../entity/Actor'
import { GameInstance } from '../gameflow/GameInstance'

/** 蓝图中的 Component 描述 */
export interface BlueprintComponentDef {
  /** 组件 id（该蓝图内唯一） */
  id?: number
  /** 组件显示名称 */
  name?: string
  /** Component 注册类型（ComponentRegistry key），如 'SpriteComponent' */
  baseClass: string
  /** 组件特有属性（构造参数 + 可配置属性） */
  properties?: PropertyPatch
  /** 变体继承时：true 表示从父级移除该 id 的 Component */
  _remove?: boolean
}

/** 蓝图中的子 Actor 描述（与 BlueprintAsset 结构一致，仅多 name/ref/overrides/_remove） */
export interface BlueprintChildDef {
  /** 引用另一个蓝图资产文件的路径（与 baseClass 二选一） */
  ref?: string
  /** 内联的 ActorRegistry 类型（同根级 baseClass） */
  baseClass?: string
  /** 子 Actor 名（具名子节点用于继承链合并定位；无 name 则纯追加） */
  name?: string
  /** 本文件内唯一 id（用于编辑器定位/资产校验） */
  id?: number
  /** 子 Actor 的默认属性覆盖（仅 blueprint 引用时有效） */
  overrides?: PropertyPatch
  /** 内联组件列表（同根级 components） */
  components?: BlueprintComponentDef[]
  /** 是否激活（false = 已创建但不渲染，作用于该节点及整个子树，默认 true） */
  active?: boolean
  /** 世界坐标位置（旧格式已废弃：位置必须写在 transform/uitransform 组件，此处可选仅为兼容） */
  position?: [number, number, number]
  /** 欧拉旋转角（弧度，旧格式已废弃，同上） */
  rotation?: [number, number, number]
  /** 缩放（旧格式已废弃，同上） */
  scale?: [number, number, number]
  /** 递归嵌套子 Actor */
  children?: BlueprintChildDef[]
  /** 变体继承时：true 表示从父级移除该具名子节点 */
  _remove?: boolean
}

/** 蓝图资产（JSON 文档根） */
export interface BlueprintAsset {
  /** 蓝图显示名称 */
  name: string
  /** baseClass（ActorRegistry key），如 'Actor' / 'FishHouse' */
  baseClass: string
  /** 默认挂载的 Component */
  components?: BlueprintComponentDef[]
  /** 子 Actor */
  children?: BlueprintChildDef[]
  /** 是否激活（false = 已创建但不渲染，作用于该节点及整个子树，默认 true） */
  active?: boolean
  /** 世界坐标位置 */
  position?: [number, number, number]
  /** 欧拉旋转角（弧度） */
  rotation?: [number, number, number]
  /** 缩放 */
  scale?: [number, number, number]
}

// ─── resolve 后的扁平化结果（继承链已合并，视为只读） ───

export interface ResolvedComponentDef {
  id?: number
  name?: string
  baseClass: string
  properties: PropertyPatch
}

export interface ResolvedChildDef {
  ref?: string
  baseClass?: string
  name?: string
  id?: number
  overrides: PropertyPatch
  components?: ResolvedComponentDef[]
  /** 是否激活（false = 已创建但不渲染，作用于该节点及整个子树，默认 true） */
  active?: boolean
  /** 旧格式已废弃：位置必须写在 transform/uitransform 组件（可选仅为兼容） */
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: [number, number, number]
  children?: ResolvedChildDef[]
}

/** resolve(path) 的产物：使用 path 作为 key，不参与继承（parent 已移除） */
export interface ResolvedBlueprint {
  path: string
  name: string
  baseClass: string
  components: ResolvedComponentDef[]
  children: ResolvedChildDef[]
  /** 是否激活（false = 已创建但不渲染，作用于该节点及整个子树，默认 true） */
  active?: boolean
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: [number, number, number]
}

// ─── 静态生成入口 ───

import { BlueprintRegistry } from './BlueprintRegistry'
import { ActorRegistry } from '../tools/ActorRegistry'
import { ComponentRegistry } from '../tools/ComponentRegistry'
import { ensureTransformForActor } from '../ui/UITransformComponent'
import { logger } from '../Logger'

/**
 * 静态 Blueprint 实例化入口：在当前 GameInstance 关联的 World 中生成 Actor。
 * 等价于 `world.actorMgr.SpawnActorFromBlueprint(path)`，但合成一步调用。
 *
 * 使用示例：
 *   const actor = BlueprintAsset.Instantiate('assets/blueprints/FishHouse')
 *   const actor2 = BlueprintAsset.Instantiate('assets/blueprints/FishHouse', { position: [1, 0, 2] })
 */
export function Instantiate(
  path: string,
  overrides?: PropertyPatch,
  componentOverrides?: BlueprintComponentDef[],
): Actor | null {
  const world = GameInstance.current?.getWorld()
  if (!world) {
    logger.error(`[BlueprintAsset.Instantiate] 当前没有活跃 GameInstance 或未关联 World`)
    return null
  }
  return world.actorMgr.SpawnActorFromBlueprint(path, overrides, componentOverrides)
}
