/**
 * assetLint/AssetSource — 资产文件来源（环境抽象）
 *
 * ElectronAssetSource（默认）：用既有 listProjectAssets + readJsonFile 做真磁盘扫描，
 *   能抓到解析失败 / 未注册的坏文件。readJsonFile 返回 {success, data?, error?} 信封。
 * RegistryAssetSource（降级）：window.electronAPI 不存在时，遍历 AssetRegistry /
 *   BlueprintRegistry 内存态。抓不到 parse 失败文件，但能校验已加载资产。
 *
 * 两者都按扩展名过滤只收 *.scene.json / *.blueprint.json / *.widget.json。
 */
import { AssetRegistry, BlueprintRegistry } from '../../../engine'
import type { AssetFile } from './types'

export interface AssetSource {
  /** 列出工程 asset 文件夹下所有资产（已解析或带解析错误）。 */
  list(folder: string): Promise<AssetFile[]>
}

/** 仅收场景/蓝图/widget 资产（按命名约定）。 */
const ASSET_EXT_RE = /\.(scene|blueprint|widget)\.json$/i

/** 从资产路径推导展示用扩展名标签（降级源无磁盘 ext 字段）。 */
function extOf(path: string): string {
  const m = /\.([a-z]+)\.json$/i.exec(path)
  return m ? `.${m[1]}.json` : '.json'
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/** Electron：真磁盘扫描。 */
class ElectronAssetSource implements AssetSource {
  async list(folder: string): Promise<AssetFile[]> {
    const api = window.electronAPI
    if (!api?.listProjectAssets || !api?.readJsonFile) return []

    let entries: Array<{ path: string; ext: string; size: number }> = []
    try {
      entries = await api.listProjectAssets(folder)
    } catch (err) {
      return []
    }

    const files: AssetFile[] = []
    for (const e of entries) {
      if (!ASSET_EXT_RE.test(e.path)) continue
      try {
        const result = await api.readJsonFile(e.path) // { success, data?, error? }
        if (result.success) {
          files.push({ path: e.path, ext: e.ext, ok: true, doc: result.data })
        } else {
          files.push({ path: e.path, ext: e.ext, ok: false, doc: null, error: result.error ?? '读取失败' })
        }
      } catch (err) {
        files.push({ path: e.path, ext: e.ext, ok: false, doc: null, error: errMsg(err) })
      }
    }
    return files
  }
}

/** 浏览器/Mock 降级：扫内存态注册中心。 */
class RegistryAssetSource implements AssetSource {
  async list(_folder: string): Promise<AssetFile[]> {
    const files: AssetFile[] = []

    // 场景资产
    for (const name of AssetRegistry.getSceneNames()) {
      const scene = AssetRegistry.getScene(name)
      if (scene) {
        files.push({ path: `scenes/${name}.scene.json`, ext: '.scene.json', ok: true, doc: scene })
      }
    }

    // 蓝图资产（含 widget 编译产物——ui 目录下 .json 同样注册进 BlueprintRegistry；
    // 旧实现把所有路径硬标 '.blueprint.json'，widget 资产因此脱离设计检查）
    for (const p of BlueprintRegistry.getRegisteredPaths()) {
      if (!ASSET_EXT_RE.test(p)) continue
      const bp = BlueprintRegistry.get(p)
      if (bp) {
        files.push({ path: p, ext: extOf(p), ok: true, doc: bp })
      }
    }

    return files
  }
}

/** 按环境选择 Source：有 electronAPI 用磁盘扫描，否则降级内存态。 */
export function createAssetSource(): AssetSource {
  if (typeof window !== 'undefined' && window.electronAPI) {
    return new ElectronAssetSource()
  }
  return new RegistryAssetSource()
}
