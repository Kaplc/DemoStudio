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

export class BlueprintRegistry {
  private static assets = new Map<number, BlueprintAsset>()
  private static cache = new Map<number, ResolvedBlueprint>()
  /** parent → 直接子 id 集合（用于失效传播） */
  private static childrenIndex = new Map<number, Set<number>>()
  /** id → 自身的 parent（用于重新注册时清理旧索引） */
  private static reverseParent = new Map<number, number | undefined>()

  /** 注册一个蓝图资产（覆盖同名，并失效自身及后代缓存） */
  static register(asset: BlueprintAsset): void {
    const id = asset.id
    const oldParent = BlueprintRegistry.reverseParent.get(id)
    if (oldParent !== undefined) {
      BlueprintRegistry.childrenIndex.get(oldParent)?.delete(id)
    }
    const newParent = asset.parent
    BlueprintRegistry.reverseParent.set(id, newParent)
    if (newParent !== undefined) {
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
  static loadFromJson(id: number, json: BlueprintAsset): void {
    BlueprintRegistry.register({ ...json, id })
  }

  /** 检查是否已注册 */
  static has(id: number): boolean {
    return BlueprintRegistry.assets.has(id)
  }

  /** 获取所有已注册的蓝图 id */
  static getRegisteredIds(): number[] {
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
  static get(id: number): BlueprintAsset | null {
    return BlueprintRegistry.assets.get(id) ?? null
  }

  /**
   * 解析继承链，返回扁平 CDO（带缓存）。环或缺失父级时抛错。
   * 返回对象视为只读 —— 实例化时不应修改。
   */
  static resolve(id: number): ResolvedBlueprint {
    return BlueprintRegistry.resolveInternal(id, new Set())
  }

  /** 递归失效 id 及其后代的缓存 */
  private static invalidate(id: number): void {
    BlueprintRegistry.cache.delete(id)
    const kids = BlueprintRegistry.childrenIndex.get(id)
    if (kids) {
      for (const child of kids) BlueprintRegistry.invalidate(child)
    }
  }

  private static resolveInternal(id: number, ancestors: Set<number>): ResolvedBlueprint {
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
    let position: [number, number, number] | undefined
    let rotation: [number, number, number] | undefined
    let scale: [number, number, number] | undefined

    if (asset.parent) {
      const parentAncestors = new Set(ancestors)
      parentAncestors.add(id)
      const parent = BlueprintRegistry.resolveInternal(asset.parent, parentAncestors)
      baseClass = asset.baseClass ?? parent.baseClass
      components = parent.components.map((c) => ({
        id: c.id,
        name: c.name,
        baseClass: c.baseClass,
        properties: clonePatch(c.properties),
      }))
      children = parent.children.map((ch) => ({
        ...ch,
        ref: ch.ref,
        overrides: clonePatch(ch.overrides),
        components: ch.components ? ch.components.map((c) => ({ ...c, properties: clonePatch(c.properties ?? {}) })) : undefined,
        children: ch.children ? ch.children.map((rc) => ({ ...rc, overrides: clonePatch(rc.overrides) })) : undefined,
      }))
      position = parent.position
      rotation = parent.rotation
      scale = parent.scale
    }

    // 合并本层的 components
    if (asset.components) {
      for (const cdef of asset.components) {
        if (cdef._remove) {
          components = components.filter((c) => c.baseClass !== cdef.baseClass)
          continue
        }
        const existing = components.find((c) => c.baseClass === cdef.baseClass)
        if (existing) {
          if (cdef.properties) mergePatch(existing.properties, clonePatch(cdef.properties))
          if (cdef.name !== undefined) existing.name = cdef.name
          if (cdef.id !== undefined) existing.id = cdef.id
        } else {
          components.push({
            id: cdef.id,
            name: cdef.name,
            baseClass: cdef.baseClass,
            properties: clonePatch(cdef.properties ?? {}),
          })
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
          if (chdef.ref) existing.ref = chdef.ref
          if (chdef.baseClass) existing.baseClass = chdef.baseClass
            if (chdef.position !== undefined) existing.position = chdef.position
            if (chdef.rotation !== undefined) existing.rotation = chdef.rotation
            if (chdef.scale !== undefined) existing.scale = chdef.scale
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

    // 顶层 position/rotation/scale 覆盖父级
    if (asset.position !== undefined) position = asset.position
    if (asset.rotation !== undefined) rotation = asset.rotation
    if (asset.scale !== undefined) scale = asset.scale

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

    const resolved: ResolvedBlueprint = { id, name: asset.name, baseClass, components, children, position, rotation, scale }
    BlueprintRegistry.cache.set(id, resolved)
    logger.debug(`[BlueprintRegistry] resolve(${id}) → base=${baseClass}, comps=${components.length}, kids=${children.length}`)
    return resolved
  }

  private static cloneChildDef(chdef: BlueprintChildDef): ResolvedChildDef {
    return {
      blueprint: chdef.blueprint,
      ref: chdef.ref,
      baseClass: chdef.baseClass,
      name: chdef.name,
      id: chdef.id,
      overrides: clonePatch(chdef.overrides ?? {}),
      components: chdef.components
        ? chdef.components.map((c) => ({
            ...c,
            properties: clonePatch(c.properties ?? {}),
          }))
        : undefined,
      position: chdef.position,
      rotation: chdef.rotation,
      scale: chdef.scale,
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
    const result: ResolvedChildDef[] = base.map((ch) => ({
      ...ch,
      overrides: clonePatch(ch.overrides),
      children: ch.children
        ? ch.children.map((rc) => ({ ...rc, overrides: clonePatch(rc.overrides) } as ResolvedChildDef))
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
          if (chdef.baseClass) existing.baseClass = chdef.baseClass
          if (chdef.components) {
            // 子节点 components 合并（同 baseClass 覆盖，异 baseClass 追加）
            for (const cdef of chdef.components) {
              const ec = (existing.components ?? []).find((c) => c.baseClass === cdef.baseClass)
              if (ec) {
                if (cdef.properties) mergePatch(ec.properties, clonePatch(cdef.properties))
              } else {
                if (!existing.components) existing.components = []
                existing.components.push({
                  ...cdef,
                  properties: clonePatch(cdef.properties ?? {}),
                })
              }
            }
          }
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
