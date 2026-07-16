/**
 * JsonSceneAssetBuilder — 通用 JSON 场景资产构建器
 * 实现 WorldBuilder 接口：build() 读取构造时注入的 SceneAsset，交给 SceneLoader 展开。
 *
 * 所有游戏共用此构建器 —— 新增/切换地图只需准备一份 *.scene.json，
 * 再 WorldRegistry.register(name, new JsonSceneAssetBuilder(asset))。
 */
import type { WorldBuilder, WorldBuildConfig, WorldAsset } from './WorldAsset'
import type { SceneAsset } from './SceneAsset'
import { loadScene } from './SceneLoader'

export class JsonSceneAssetBuilder implements WorldBuilder {
  constructor(private readonly asset: SceneAsset) {}

  build(_config: WorldBuildConfig): WorldAsset {
    // config 被有意忽略 —— 场景参数（如 gridSize）已固化进 JSON 资产本身，
    // 避免运行时外部参数与资产内容不一致
    return loadScene(this.asset)
  }
}
