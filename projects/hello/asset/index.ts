/**
 * Hello — 资产自动注册入口
 *
 * 与内置工程的 asset/index.ts 同一套约定：import.meta.glob 相对模式自动扫描 asset/，
 * 新增资产文件无需修改本文件。registerAssets 由打开工程链路调用。
 */
import { AssetRegistry, logger } from '@/engine'
import type { SceneAsset } from '@/engine'

/** 注册 Hello 工程的所有资产 */
export function registerHelloAssets(): void {
  const sceneModules = import.meta.glob<{ default: SceneAsset }>('./**/*.scene.json', { eager: true })
  const scenes = Object.values(sceneModules).map((m) => m.default as SceneAsset)

  AssetRegistry.registerAll({ scenes })

  logger.info(`[Hello/Asset] 注册完成: 场景=${scenes.map(s => s.name).join(', ')}`)
}