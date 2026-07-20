/**
 * BlueprintAsset — Blueprint 资产类型定义
 *
 * 一个 Blueprint = "这个 Actor 子类默认长什么样" + 可选继承（parent）。
 * 对应 Unity Prefab / UE Blueprint Class 的"类定义 + CDO 默认值"。
 *
 * 设计取舍：行为逻辑由 baseClass（TS Actor 子类）承载；
 * 数据（Component 组合 / 子 Actor / 默认属性 / 继承）由本资产描述。不引入可视化脚本。
 */
import type { PropertyPatch } from '../tools/deepMerge'
import type { SceneNode } from '../scene/SceneAsset'

/** 蓝图中的 Component 描述 */
export interface BlueprintComponentDef {
  /** Component 类型（ComponentRegistry key），如 'sprite' */
  type: string
  /** 默认 props（构造参数 + 可配置属性） */
  props?: PropertyPatch
  /** 变体继承时：true 表示从父级移除该类型 Component */
  _remove?: boolean
}

/** 蓝图中的子 Actor 描述 */
export interface BlueprintChildDef {
  /** 引用另一个 Blueprint 实例化（与 actor 二选一） */
  blueprint?: string
  /** 或内联一个 ActorRegistry 类型 */
  actor?: string
  /** 子 Actor 名（具名子节点用于继承链合并定位；无 name 则纯追加） */
  name?: string
  /** 子 Actor 的默认属性覆盖 */
  overrides?: PropertyPatch
  /** 内联网格列表（复用 SceneAsset 的节点类型：box/plane/sphere/sprite 等） */
  objects?: SceneNode[]
  /** 递归嵌套子 Actor（形成完整对象树） */
  children?: BlueprintChildDef[]
  /** 变体继承时：true 表示从父级移除该具名子节点 */
  _remove?: boolean
}

/** 蓝图资产（JSON 文档根） */
export interface BlueprintAsset {
  /** 蓝图唯一 id（注册到 BlueprintRegistry） */
  id: string
  /** baseClass（ActorRegistry key），如 'Actor' / 'FishHouse' */
  baseClass: string
  /** 父级 Blueprint id（继承 / 变体） */
  parent?: string
  /** 默认挂载的 Component */
  components?: BlueprintComponentDef[]
  /** 子 Actor */
  children?: BlueprintChildDef[]
  /** (已弃用) 场景资产名称。推荐用 children.objects 内联定义网格。保留兼容 */  scene?: string
  /** 根级内联网格列表 */
  objects?: SceneNode[]
  /** CDO 默认属性（transform + 行为类参数） */
  defaults?: PropertyPatch
}

// ─── resolve 后的扁平化结果（继承链已合并，视为只读） ───

export interface ResolvedComponentDef {
  type: string
  props: PropertyPatch
}

export interface ResolvedChildDef {
  blueprint?: string
  actor?: string
  name?: string
  overrides: PropertyPatch
  objects?: SceneNode[]
  children?: ResolvedChildDef[]
}

/** resolve(id) 的产物：继承链合并后的扁平 CDO（只读） */
export interface ResolvedBlueprint {
  id: string
  baseClass: string
  /** (已弃用) 保留兼容 */  scene?: string
  /** 根级内联网格 */
  objects?: SceneNode[]
  components: ResolvedComponentDef[]
  children: ResolvedChildDef[]
  defaults: PropertyPatch
}
