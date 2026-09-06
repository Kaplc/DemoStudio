/**
 * Hoi4 — 资产自动注册入口
 *
 * 与内置工程同一套约定：import.meta.glob 相对模式自动扫描 asset/
 * （注释里不写通配符序列——块注释中的星斜杠会提前终止注释）：
 *   map 场景 / blueprints-ui widget / gameplay 脚本（id = 'gameplay/...' 路径式）
 */
import { AssetRegistry, logger } from '@/engine'
import type { SceneAsset, BlueprintAsset, BehaviourScriptConstructor } from '@/engine'

/** 注册 Hoi4 项目的所有资产 */
export function registerHoi4Assets(): void {
  const sceneModules = import.meta.glob<{ default: SceneAsset }>('./**/*.scene.json', { eager: true })
  const scenes = Object.values(sceneModules).map((m) => m.default as SceneAsset)

  const bpModules = import.meta.glob<{ default: BlueprintAsset }>(
    ['./blueprints/**/*.blueprint.json', './blueprints/ui/**/*.json'],
    { eager: true },
  )

  const scriptModules = import.meta.glob<{ default: BehaviourScriptConstructor }>(
    '../gameplay/**/*.script.ts',
    { eager: true },
  )

  AssetRegistry.registerAll({
    scenes,
    blueprintModules: bpModules,
    scriptModules,
  })

  logger.info(
    `[Hoi4/Asset] 注册完成: 场景=${scenes.map((s) => s.name).join(', ')} | widget=${Object.keys(bpModules).length} | 脚本=${Object.keys(scriptModules).length}`,
  )
}
