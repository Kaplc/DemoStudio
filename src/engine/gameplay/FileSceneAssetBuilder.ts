/**
 * FileSceneAssetBuilder — 通过文件路径加载场景资产
 * 每次 build() 时重新读取 JSON 文件，支持热更新
 * 要求 Electron IPC readJsonFile 可用，否则 fallback 到静态数据
 */
import type { WorldBuilder, WorldBuildConfig, WorldAsset } from './WorldAsset'
import type { SceneAsset } from './SceneAsset'
import { loadScene } from './SceneLoader'

export class FileSceneAssetBuilder implements WorldBuilder {
  constructor(private readonly filePath: string) {}

  async build(_config: WorldBuildConfig): Promise<WorldAsset> {
    // 优先通过 Electron IPC 读取
    if (window.electronAPI?.readJsonFile) {
      const result = await window.electronAPI.readJsonFile(this.filePath)
      if (result.success && result.data) {
        return loadScene(result.data as SceneAsset)
      }
      console.warn(`[FileSceneAssetBuilder] 读取失败: ${result.error}，使用空场景`)
    }

    // fallback：空场景
    return loadScene({ name: 'Empty', objects: [] })
  }
}
