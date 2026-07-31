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
import { AssetRegistry, logger } from '@/engine'
import type { SceneAsset, BlueprintAsset } from '@/engine'

/** 注册 FishMaster 项目的所有资产 */
export function registerFishAssets(): void {
  // 自动扫描所有 .scene.json（含子目录，如 blueprints/beach_house_parts.scene.json）
  const sceneModules = import.meta.glob<{ default: SceneAsset }>('./**/*.scene.json', { eager: true })
  const scenes = Object.values(sceneModules).map((m) => m.default as SceneAsset)

  // 自动扫描所有蓝图：blueprints/**/*.blueprint.json（通用蓝图）
  // + blueprints/ui/**/*.json（UI widget，命名如 main_menu.widget.json，不带 .blueprint 后缀）
  // 传入 glob 原始结果（blueprintModules），注册路径由 AssetRegistry 从 key 自动推导（asset/...），
  // 蓝图 JSON 内无需再写 path 字段。
  const bpModules = import.meta.glob<{ default: BlueprintAsset }>(
    ['./blueprints/**/*.blueprint.json', './blueprints/ui/**/*.json'],
    { eager: true },
  )

  AssetRegistry.registerAll({
    scenes,
    blueprintModules: bpModules,
  })

  logger.info(
    `[Fish/Asset] 注册完成: 场景=${scenes.map(s => s.name).join(', ')} | 蓝图=${Object.keys(bpModules).map(k => k.replace(/^\.\//, 'asset/')).join(', ')}`,
  )
}
