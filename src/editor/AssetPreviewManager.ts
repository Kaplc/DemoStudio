/**
 * AssetPreviewManager — 资产预览总管理器
 *
 * 管理所有资产 3D 预览实例（蓝图预览、场景预览等）的注册与查找。
 * 外部（BlueprintEditor、ScenePreviewEditor、Outline）通过此管理器
 * 按资产路径操作对应的预览实例，不直接持有静态引用。
 */
import { BlueprintPreviewManager } from './BlueprintPreviewManager'
import { ScenePreviewManager } from './ScenePreviewManager'

type PreviewInstance = BlueprintPreviewManager | ScenePreviewManager

export class AssetPreviewManager {
  /** 资产路径 → 预览实例 */
  private static _instances = new Map<string, PreviewInstance>()

  /** 当前活动预览实例的资产路径 */
  private static _activePath: string | null = null

  /** 注册预览实例 */
  static register(path: string, instance: PreviewInstance): void {
    AssetPreviewManager._instances.set(path, instance)
  }

  /** 注销预览实例 */
  static unregister(path: string): void {
    AssetPreviewManager._instances.delete(path)
    if (AssetPreviewManager._activePath === path) {
      AssetPreviewManager._activePath = null
    }
  }

  /** 按资产路径获取预览实例 */
  static get<T extends PreviewInstance>(path: string): T | null {
    return (AssetPreviewManager._instances.get(path) as T) ?? null
  }

  /** 获取当前活动预览实例 */
  static getActive<T extends PreviewInstance>(): T | null {
    if (!AssetPreviewManager._activePath) return null
    return AssetPreviewManager.get<T>(AssetPreviewManager._activePath)
  }

  /** 获取当前活动资产路径 */
  static getActivePath(): string | null {
    return AssetPreviewManager._activePath
  }

  /** 设置当前活动预览 */
  static setActive(path: string | null): void {
    AssetPreviewManager._activePath = path
  }
}
