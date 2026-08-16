/**
 * AssetPreviewManager — 资产预览总管理器
 *
 * 管理所有资产 3D 预览实例（蓝图预览、场景预览等）的注册与查找。
 * 外部（BlueprintEditor、ScenePreviewEditor、Outline）通过此管理器
 * 按资产路径操作对应的预览实例，不直接持有静态引用。
 */
import { BlueprintPreviewManager } from './BlueprintPreviewManager'
import { UIPreviewManager } from './UIPreviewManager'
import { ScenePreviewManager } from './ScenePreviewManager'
import { watchWorldActorChanges } from '../SelectionManager'

type PreviewInstance = BlueprintPreviewManager | UIPreviewManager | ScenePreviewManager

export class AssetPreviewManager {
  /** 资产路径 → 预览实例 */
  private static _instances = new Map<string, PreviewInstance>()

  /** 当前活动预览实例的资产路径 */
  private static _activePath: string | null = null

  /** 待恢复选中：资产路径 → actor 名（预览重建后由编辑器消费；如大纲右键创建新节点后自动选中） */
  private static _pendingSelection = new Map<string, string>()

  /** 注册预览实例 */
  static register(path: string, instance: PreviewInstance): void {
    AssetPreviewManager._instances.set(path, instance)
    // 监听预览 World 的 Actor 变化 → 刷新大纲（清树缓存 + 递增 selectionKey）
    watchWorldActorChanges(instance.world, () => instance.invalidateActorTree())
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

  /** 登记待恢复选中（预览重建后自动选中该 actor 名） */
  static setPendingSelection(path: string, actorName: string | null): void {
    if (actorName) AssetPreviewManager._pendingSelection.set(path, actorName)
    else AssetPreviewManager._pendingSelection.delete(path)
  }

  /** 消费待恢复选中（读取并清除） */
  static takePendingSelection(path: string): string | null {
    const name = AssetPreviewManager._pendingSelection.get(path) ?? null
    AssetPreviewManager._pendingSelection.delete(path)
    return name
  }
}
