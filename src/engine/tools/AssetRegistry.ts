/**
 * AssetRegistry — 资产注册中心
 *
 * 统一管理项目中所有场景资产（.scene.json）和蓝图资产（.blueprint.json），
 * 让 asset/ 文件夹实现"自动映射、注册和管理"：
 *
 * - 场景资产按 name 注册，可通过 name / mode 查找
 * - 蓝图资产从 import.meta.glob 的 key 自动推导注册路径（asset/...）并注册到 BlueprintRegistry
 * - 项目中只需在 asset/index.ts 中 glob 扫描，剩余由 registerAll() 自动完成
 *
 * 用法（每个项目的 asset/index.ts）：
 *   import { AssetRegistry } from '@/engine'
 *   import type { SceneAsset, BlueprintAsset } from '@/engine'
 *
 *   // 用 import.meta.glob 扫描（eager: true），传入 blueprintModules 后
 *   // 注册 key 由文件路径自动推导（asset/...），JSON 内无需写 path
 *   AssetRegistry.registerAll({ scenes, blueprintModules: bpModules })
 *
 * 然后即可通过 World.SwitchToScene('FishMenu') 按场景名称切换。
 */
import type { SceneAsset } from '../scene/SceneAsset'
import type { BlueprintAsset } from '../blueprint/BlueprintAsset'
import { BlueprintRegistry } from '../blueprint/BlueprintRegistry'
import { ScriptRegistry, type ScriptModules } from '../script/ScriptRegistry'
import { logger } from '../Logger'

/** 资产注册批量参数 */
export interface ProjectAssets {
  scenes?: SceneAsset[]
  /** import.meta.glob 结果：key = 相对 asset/ 的文件路径（如 "./blueprints/beach_house.blueprint.json"），
   *  由 key 自动推导注册路径（asset/...），无需在 JSON 内写 path */
  blueprintModules?: Record<string, { default: BlueprintAsset }>
  /** import.meta.glob 结果：key = 相对 asset/ 的脚本文件路径（如 "../gameplay/base/Foo.script.ts"），
   *  由 ScriptRegistry 从 key 自动推导脚本 id（无需手写 register） */
  scriptModules?: ScriptModules
}

/** 将 import.meta.glob key（相对 asset/，如 "./blueprints/foo.blueprint.json"）转为注册路径（asset/...） */
function globKeyToAssetPath(key: string): string {
  // "./blueprints/foo.blueprint.json" → "asset/blueprints/foo.blueprint.json"
  const cleaned = key.replace(/^\.\//, '')
  return cleaned.startsWith('asset/') ? cleaned : `asset/${cleaned}`
}

export class AssetRegistry {
  /** name → SceneAsset */
  private static scenes = new Map<string, SceneAsset>()

  // ═══════════════════════════════════
  //  批量注册（项目 asset/index.ts 使用）
  // ═══════════════════════════════════

  /**
   * 批量注册项目的所有资产。
   * 蓝图自动注册到 BlueprintRegistry（注册 key 由 glob key 推导为 asset/...），
   * 场景按 name 索引。
   */
  static registerAll(assets: ProjectAssets): void {
    // 注册蓝图（从 glob key 推导注册路径）
    if (assets.blueprintModules) {
      for (const [key, mod] of Object.entries(assets.blueprintModules)) {
        const bp = mod.default
        const path = globKeyToAssetPath(key)
        BlueprintRegistry.loadFromJson(path, bp)
        logger.debug(`[AssetRegistry] 注册蓝图: ${path} (来自 ${key})`)
      }
    }

    // 注册场景
    if (assets.scenes) {
      for (const scene of assets.scenes) {
        const name = scene.name
        if (!name) {
          logger.warn('[AssetRegistry] 场景缺少 name，跳过')
          continue
        }
        AssetRegistry.scenes.set(name, scene)
        logger.debug(`[AssetRegistry] 注册场景: ${name} (mode=${scene.mode ?? '无'})`)
      }
    }

    // 注册行为脚本（供 UIScriptComponent 按 id 挂载）：交由 ScriptRegistry 从 glob key 推导 id
    if (assets.scriptModules) {
      ScriptRegistry.registerAll(assets.scriptModules)
    }

    logger.info(
      `[AssetRegistry] 注册完成: ` +
        `场景=${assets.scenes?.length ?? 0}, ` +
        `蓝图=${assets.blueprintModules ? Object.keys(assets.blueprintModules).length : 0}, ` +
        `脚本=${assets.scriptModules ? Object.keys(assets.scriptModules).length : 0}`,
    )
  }

  // ═══════════════════════════════════
  //  查找
  // ═══════════════════════════════════

  /** 按名称查找场景资产 */
  static getScene(name: string): SceneAsset | null {
    return AssetRegistry.scenes.get(name) ?? null
  }

  /** 按 mode 查找第一个匹配的场景资产（适用于唯一 mode 的项目） */
  static getSceneByMode(mode: string): SceneAsset | null {
    for (const scene of AssetRegistry.scenes.values()) {
      if (scene.mode === mode) return scene
    }
    return null
  }

  /** 获取所有已注册的场景名 */
  static getSceneNames(): string[] {
    return [...AssetRegistry.scenes.keys()]
  }

  /** 检查场景是否已注册 */
  static hasScene(name: string): boolean {
    return AssetRegistry.scenes.has(name)
  }

  // ═══════════════════════════════════
  //  重置（仅测试用）
  // ═══════════════════════════════════

  static reset(): void {
    AssetRegistry.scenes.clear()
  }
}
