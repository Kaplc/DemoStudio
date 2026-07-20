/**
 * FishMaster — 资产自动注册入口
 *
 * 使用 Vite import.meta.glob 自动扫描 asset/ 下的所有资产文件，
 * 新增 .scene.json 或 .blueprint.json 时无需修改此文件。
 *
 * 文件命名约定：
 *   asset/*.scene.json               → 场景资产（按 name 字段注册到 AssetRegistry）
 *   asset/blueprints/*.blueprint.json → 蓝图资产（按 id 字段注册到 BlueprintRegistry）
 */
import { AssetRegistry } from '@/engine'
import type { SceneAsset, BlueprintAsset } from '@/engine'

/** 注册 FishMaster 项目的所有资产 */
export function registerFishAssets(): void {
  // 自动扫描所有 .scene.json（含子目录，如 blueprints/beach_house_parts.scene.json）
  const sceneModules = import.meta.glob<{ default: SceneAsset }>('./**/*.scene.json', { eager: true })
  const scenes = Object.values(sceneModules).map((m) => m.default as SceneAsset)

  // 自动扫描所有 .blueprint.json（在 blueprints/ 子目录下）
  const bpModules = import.meta.glob<{ default: BlueprintAsset }>('./blueprints/*.blueprint.json', { eager: true })
  const blueprints = Object.values(bpModules).map((m) => m.default as BlueprintAsset)

  AssetRegistry.registerAll({ scenes, blueprints })
}
