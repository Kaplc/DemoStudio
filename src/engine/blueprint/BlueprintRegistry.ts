/**
 * BlueprintRegistry — Blueprint 蓝图注册中心
 *
 * 以蓝图资产文件路径（相对于 src/projects/）为 key 管理 BlueprintAsset。
 *
 * 核心能力 resolve(path)：
 *   - 直接查找 assets Map（无继承链，parent 已移除）
 *   - children 中的 ref 路径会被递归 resolve 并展开替换为内联数据
 *
 * 缓存与失效：
 *   - resolve 结果缓存在 cache，register / loadFromJson 时 invalidate 对应 path。
 */
import { logger } from '../Logger'
import { clonePatch, type PropertyPatch } from '../tools/deepMerge'
import type {
  BlueprintAsset,
  BlueprintChildDef,
  ResolvedBlueprint,
  ResolvedChildDef,
  ResolvedComponentDef,
} from './BlueprintAsset'

export class BlueprintRegistry {
  private static assets = new Map<string, BlueprintAsset>()
  private static cache = new Map<string, ResolvedBlueprint>()

  /** 注册一个蓝图资产（path 为注册 key，覆盖同名并失效缓存） */
  static register(path: string, asset: BlueprintAsset): void {
    BlueprintRegistry.assets.set(path, asset)
    BlueprintRegistry.cache.delete(path)
  }

  /** 从 JSON 注册（key 由外部传入，资产内不保存 path） */
  static loadFromJson(path: string, json: BlueprintAsset): void {
    BlueprintRegistry.register(path, json)
  }

  /** 检查是否已注册 */
  static has(path: string): boolean {
    return BlueprintRegistry.assets.has(path)
  }

  /** 获取所有已注册的蓝图路径 */
  static getRegisteredPaths(): string[] {
    return [...BlueprintRegistry.assets.keys()]
  }

  /** 清空所有注册的蓝图（切换工程时调用） */
  static clearAll(): void {
    BlueprintRegistry.assets.clear()
    BlueprintRegistry.cache.clear()
  }

  /** 获取原始资产 */
  static get(path: string): BlueprintAsset | null {
    return BlueprintRegistry.assets.get(path) ?? null
  }

  /**
   * 解析蓝图：展开 children 中的 ref 引用，返回扁平 CDO（带缓存）。
   * 返回对象视为只读 —— 实例化时不应修改。
   */
  static resolve(path: string): ResolvedBlueprint {
    const cached = BlueprintRegistry.cache.get(path)
    if (cached) return cached

    const asset = BlueprintRegistry.assets.get(path)
    if (!asset) {
      throw new Error(`Blueprint "${path}" 未注册`)
    }

    const components: ResolvedComponentDef[] = (asset.components ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      baseClass: c.baseClass,
      properties: clonePatch(c.properties ?? {}),
    }))

    const children = BlueprintRegistry.resolveChildren(asset.children ?? [], new Set([path]))

    const resolved: ResolvedBlueprint = { path, name: asset.name, baseClass: asset.baseClass, components, children, position: asset.position, rotation: asset.rotation, scale: asset.scale }
    BlueprintRegistry.cache.set(path, resolved)
    logger.debug(`[BlueprintRegistry] resolve(${path}) → base=${asset.baseClass}, comps=${components.length}, kids=${children.length}`)
    return resolved
  }

  /** 转换 children 为 ResolvedChildDef（ref 子节点保留为单节点，不展开） */
  private static resolveChildren(
    children: BlueprintChildDef[],
    resolving: Set<string>,
  ): ResolvedChildDef[] {
    const result: ResolvedChildDef[] = []
    for (const chdef of children) {
      // ref 环检测
      if (chdef.ref && resolving.has(chdef.ref)) {
        throw new Error(`检测到 Blueprint ref 循环引用: ${chdef.ref}`)
      }

      result.push({
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
          ? BlueprintRegistry.resolveChildren(chdef.children, new Set(chdef.ref ? [...resolving, chdef.ref] : resolving))
          : undefined,
      })
    }
    return result
  }
}
