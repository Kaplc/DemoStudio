/**
 * BlueprintRegistry — Blueprint 蓝图注册中心
 *
 * 管理 蓝图 id → BlueprintAsset 的映射，并提供继承链解析（resolve）。
 *
 * 核心能力 resolve(id)：递归 parent 链合并出扁平 CDO（ResolvedBlueprint）：
 *   - components：按 type 合并（同 type props deepMerge；_remove 移除）
 *   - children：按 name 合并（无 name 追加；_remove 移除）
 *   - defaults：deepMerge（父 → 子）
 *   - baseClass：子优先，否则继承父
 *
 * 缓存与失效：
 *   - resolve 结果缓存在 cache。register / loadFromJson 时 invalidate 该 id 及所有后代。
 *   - 维护 childrenIndex（parent → 直接子 id 集合）以支持递归失效。
 *
 * 环检测：parent 链与 children 的 blueprint 引用各做循环检测，抛错而非静默。
 */
import { logger } from '../../Logger'
import { mergePatch, clonePatch, type PropertyPatch } from '../tools/deepMerge'
import type {
  BlueprintAsset,
  BlueprintChildDef,
  ResolvedBlueprint,
  ResolvedChildDef,
  ResolvedComponentDef,
} from './BlueprintAsset'
import type { SceneNode } from '../scene/SceneAsset'

export class BlueprintRegistry {
  private static assets = new Map<string, BlueprintAsset>()
  private static cache = new Map<string, ResolvedBlueprint>()
  /** parent → 直接子 id 集合（用于失效传播） */
  private static childrenIndex = new Map<string, Set<string>>()
  /** id → 自身的 parent（用于重新注册时清理旧索引） */
  private static reverseParent = new Map<string, string | undefined>()

  /** 注册一个蓝图资产（覆盖同名，并失效自身及后代缓存） */
  static register(asset: BlueprintAsset): void {
    const id = asset.id
    const oldParent = BlueprintRegistry.reverseParent.get(id)
    if (oldParent !== undefined) {
      BlueprintRegistry.childrenIndex.get(oldParent)?.delete(id)
    }
    const newParent = asset.parent
    BlueprintRegistry.reverseParent.set(id, newParent)
    if (newParent) {
      let set = BlueprintRegistry.childrenIndex.get(newParent)
      if (!set) {
        set = new Set()
        BlueprintRegistry.childrenIndex.set(newParent, set)
      }
      set.add(id)
    }
    BlueprintRegistry.assets.set(id, asset)
    BlueprintRegistry.invalidate(id)
  }

  /** 从 JSON 注册（id 覆盖 json.id，便于文件名与 id 解耦） */
  static loadFromJson(id: string, json: BlueprintAsset): void {
    BlueprintRegistry.register({ ...json, id })
  }

  /** 检查是否已注册 */
  static has(id: string): boolean {
    return BlueprintRegistry.assets.has(id)
  }

  /** 获取所有已注册的蓝图 id */
  static getRegisteredIds(): string[] {
    return [...BlueprintRegistry.assets.keys()]
  }

  /** 清空所有注册的蓝图（切换工程时调用） */
  static clearAll(): void {
    BlueprintRegistry.assets.clear()
    BlueprintRegistry.cache.clear()
    BlueprintRegistry.childrenIndex.clear()
    BlueprintRegistry.reverseParent.clear()
  }

  /** 获取原始资产（未解析继承） */
  static get(id: string): BlueprintAsset | null {
    return BlueprintRegistry.assets.get(id) ?? null
  }

  /**
   * 解析继承链，返回扁平 CDO（带缓存）。环或缺失父级时抛错。
   * 返回对象视为只读 —— 实例化时不应修改。
   */
  static resolve(id: string): ResolvedBlueprint {
    return BlueprintRegistry.resolveInternal(id, new Set())
  }

  /** 递归失效 id 及其后代的缓存 */
  private static invalidate(id: string): void {
    BlueprintRegistry.cache.delete(id)
    const kids = BlueprintRegistry.childrenIndex.get(id)
    if (kids) {
      for (const child of kids) BlueprintRegistry.invalidate(child)
    }
  }

  private static resolveInternal(id: string, ancestors: Set<string>): ResolvedBlueprint {
    const cached = BlueprintRegistry.cache.get(id)
    if (cached) return cached

    const asset = BlueprintRegistry.assets.get(id)
    if (!asset) {
      throw new Error(`Blueprint "${id}" 未注册`)
    }
    if (ancestors.has(id)) {
      const chain = [...ancestors, id].join(' -> ')
      throw new Error(`检测到 Blueprint 继承循环: ${chain}`)
    }

    // 从父级继承起始状态（深拷贝，避免污染父缓存）
    let baseClass = asset.baseClass
    let components: ResolvedComponentDef[] = []
    let children: ResolvedChildDef[] = []
    let defaults: PropertyPatch = {}
    let scene: string | undefined
    let objects: SceneNode[] | undefined

    if (asset.parent) {
      const parentAncestors = new Set(ancestors)
      parentAncestors.add(id)
      const parent = BlueprintRegistry.resolveInternal(asset.parent, parentAncestors)
      baseClass = asset.baseClass ?? parent.baseClass
      components = parent.components.map((c) => ({ type: c.type, props: clonePatch(c.props) }))
      children = parent.children.map((ch) => ({
        ...ch,
        overrides: clonePatch(ch.overrides),
        objects: ch.objects ? [...ch.objects] : undefined,
        children: ch.children ? ch.children.map((rc) => ({ ...rc, overrides: clonePatch(rc.overrides) })) : undefined,
      }))
      defaults = clonePatch(parent.defaults)
      scene = parent.scene
      objects = parent.objects ? [...parent.objects] : undefined
    }

    // 本层 scene 覆盖父级（已弃用，保留兼容）
    if (asset.scene !== undefined) {
      scene = asset.scene
    }

    // 本层 objects 覆盖父级（根级内联网格）
    if (asset.objects !== undefined) {
      objects = asset.objects
    }

    // 合并本层的 components
    if (asset.components) {
      for (const cdef of asset.components) {
        if (cdef._remove) {
          components = components.filter((c) => c.type !== cdef.type)
          continue
        }
        const existing = components.find((c) => c.type === cdef.type)
        if (existing) {
          if (cdef.props) mergePatch(existing.props, clonePatch(cdef.props))
        } else {
          components.push({ type: cdef.type, props: clonePatch(cdef.props ?? {}) })
        }
      }
    }

    // 合并本层的 children（含递归嵌套的对象/子节点）
    if (asset.children) {
      for (const chdef of asset.children) {
        const named = chdef.name
        if (chdef._remove && named) {
          children = children.filter((c) => c.name !== named)
          continue
        }
        if (named) {
          const existing = children.find((c) => c.name === named)
          if (existing) {
            if (chdef.overrides) mergePatch(existing.overrides, clonePatch(chdef.overrides))
            if (chdef.blueprint) existing.blueprint = chdef.blueprint
            if (chdef.actor) existing.actor = chdef.actor
            // 本层 objects 覆盖父级（子优先）
            if (chdef.objects !== undefined) {
              existing.objects = chdef.objects
            }
            // 合并递归 children
            if (chdef.children) {
              existing.children = BlueprintRegistry.mergeNestedChildren(existing.children ?? [], chdef.children)
            }
            continue
          }
        }
        children.push(BlueprintRegistry.cloneChildDef(chdef))
      }
    }

    // 合并本层的 defaults
    if (asset.defaults) {
      mergePatch(defaults, clonePatch(asset.defaults))
    }

    // children 的 blueprint 引用环检测：递归 resolve 子蓝图，带上含本 id 的祖先集
    const childAncestors = new Set(ancestors)
    childAncestors.add(id)
    for (const ch of children) {
      if (ch.blueprint) {
        if (childAncestors.has(ch.blueprint)) {
          throw new Error(`检测到 Blueprint 子节点循环引用: ${id} 的子节点引用祖先 "${ch.blueprint}"`)
        }
        BlueprintRegistry.resolveInternal(ch.blueprint, childAncestors)
      }
    }

    const resolved: ResolvedBlueprint = { id, baseClass, scene, objects, components, children, defaults }
    BlueprintRegistry.cache.set(id, resolved)
    logger.debug(`[BlueprintRegistry] resolve(${id}) → base=${baseClass}, scene=${scene ?? '-'}, objects=${objects?.length ?? 0}, comps=${components.length}, kids=${children.length}`)
    return resolved
  }

  private static cloneChildDef(chdef: BlueprintChildDef): ResolvedChildDef {
    return {
      blueprint: chdef.blueprint,
      actor: chdef.actor,
      name: chdef.name,
      overrides: clonePatch(chdef.overrides ?? {}),
      objects: chdef.objects ? [...chdef.objects] : undefined,
      children: chdef.children
        ? chdef.children.map((c) => BlueprintRegistry.cloneChildDef(c) as ResolvedChildDef)
        : undefined,
    }
  }

  /** 递归合并嵌套 children（按 name 合并） */
  private static mergeNestedChildren(
    base: ResolvedChildDef[],
    overlay: BlueprintChildDef[],
  ): ResolvedChildDef[] {
    const result = base.map((ch) => ({
      ...ch,
      overrides: clonePatch(ch.overrides),
      objects: ch.objects ? [...ch.objects] : undefined,
      children: ch.children
        ? ch.children.map((rc) => ({ ...rc, overrides: clonePatch(rc.overrides) }))
        : undefined,
    }))
    for (const chdef of overlay) {
      const named = chdef.name
      if (chdef._remove && named) {
        const idx = result.findIndex((c) => c.name === named)
        if (idx !== -1) result.splice(idx, 1)
        continue
      }
      if (named) {
        const existing = result.find((c) => c.name === named)
        if (existing) {
          if (chdef.overrides) mergePatch(existing.overrides, clonePatch(chdef.overrides))
          if (chdef.blueprint) existing.blueprint = chdef.blueprint
          if (chdef.actor) existing.actor = chdef.actor
          if (chdef.objects !== undefined) existing.objects = chdef.objects
          if (chdef.children) {
            existing.children = BlueprintRegistry.mergeNestedChildren(existing.children ?? [], chdef.children)
          }
          continue
        }
      }
      result.push(BlueprintRegistry.cloneChildDef(chdef) as ResolvedChildDef)
    }
    return result
  }
}
