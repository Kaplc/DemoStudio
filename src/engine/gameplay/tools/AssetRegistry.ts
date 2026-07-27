/**
 * AssetRegistry — 资产注册中心
 *
 * 统一管理项目中所有场景资产（.scene.json）和蓝图资产（.blueprint.json），
 * 让 asset/ 文件夹实现"自动映射、注册和管理"：
 *
 * - 场景资产按 name 注册，可通过 name / mode 查找
 * - 蓝图资产自动注册到 BlueprintRegistry
 * - 项目中只需在 asset/index.ts 中导入，剩余由 registerAll() 自动完成
 *
 * 用法（每个项目的 asset/index.ts）：
 *   import { AssetRegistry } from '@/engine'
 *   import menuScene from './fish_menu.scene.json'
 *   import baseScene from './fish_base.scene.json'
 *   import beachHouseBp from './blueprints/beach_house.blueprint.json'
 *
 *   AssetRegistry.registerAll({
 *     scenes: [menuScene, baseScene] as SceneAsset[],
 *     blueprints: [beachHouseBp] as BlueprintAsset[],
 *   })
 *
 * 然后即可通过 World.SwitchToScene('FishMenu') 按场景名称切换。
 */
import type { SceneAsset } from '../scene/SceneAsset'
import type { BlueprintAsset } from '../blueprint/BlueprintAsset'
import { BlueprintRegistry } from '../blueprint/BlueprintRegistry'
import { logger } from '../../Logger'

/** 资产注册批量参数 */
export interface ProjectAssets {
  scenes?: SceneAsset[]
  blueprints?: BlueprintAsset[]
}

export class AssetRegistry {
  /** name → SceneAsset */
  private static scenes = new Map<string, SceneAsset>()

  // ═══════════════════════════════════
  //  批量注册（项目 asset/index.ts 使用）
  // ═══════════════════════════════════

  /**
   * 批量注册项目的所有资产。
   * 蓝图自动注册到 BlueprintRegistry，场景按 name 索引。
   */
  static registerAll(assets: ProjectAssets): void {
    // 注册蓝图
    if (assets.blueprints) {
      for (const bp of assets.blueprints) {
        const path = bp.path
        if (!path) {
          logger.warn('[AssetRegistry] 蓝图缺少 path，跳过')
          continue
        }
        BlueprintRegistry.loadFromJson(path, bp)
        logger.debug(`[AssetRegistry] 注册蓝图: ${path}`)
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

    logger.info(
      `[AssetRegistry] 注册完成: ` +
        `场景=${assets.scenes?.length ?? 0}, ` +
        `蓝图=${assets.blueprints?.length ?? 0}`,
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
