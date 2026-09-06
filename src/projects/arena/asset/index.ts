/**
 * Arena — 资产自动注册入口
 *
 * 与 fish 同一套约定：import.meta.glob 相对模式自动扫描 asset/，
 * 新增 .scene.json / .widget.json / .script.ts 时无需修改此文件。
 */
import { AssetRegistry, logger } from '@/engine'
import type { SceneAsset, BlueprintAsset, BehaviourScriptConstructor, ConfigGlobModules } from '@/engine'

/** 注册 Arena 项目的所有资产（打开工程时调用） */
export function registerArenaAssets(): void {
  // 场景资产（含子目录）
  const sceneModules = import.meta.glob<{ default: SceneAsset }>('./**/*.scene.json', { eager: true })
  const scenes = Object.values(sceneModules).map((m) => m.default as SceneAsset)

  // 蓝图：blueprints/**/*.blueprint.json + blueprints/ui/**/*.json（UI widget）
  const bpModules = import.meta.glob<{ default: BlueprintAsset }>(
    ['./blueprints/**/*.blueprint.json', './blueprints/ui/**/*.json'],
    { eager: true },
  )

  // UI 行为脚本：gameplay/**/*.script.ts（默认导出 BehaviourScript 子类）
  const scriptModules = import.meta.glob<{ default: BehaviourScriptConstructor }>(
    '../gameplay/**/*.script.ts',
    { eager: true },
  )

  AssetRegistry.registerAll({ scenes, blueprintModules: bpModules, scriptModules })

  logger.info(
    `[Arena/Asset] 注册完成: 场景=${scenes.map((s) => s?.name).join(', ')} | 蓝图=${Object.keys(bpModules).length} | 脚本=${Object.keys(scriptModules).length}`,
  )
}

/** 配置表 glob（ConfigLoader.registerGlob 消费；当前无配置表资产，留空骨架） */
export const configGlob: ConfigGlobModules = {
  configModules: import.meta.glob('./config/**/*.config.json'),
  tableModules: import.meta.glob('./config/**/*.table.json'),
}
