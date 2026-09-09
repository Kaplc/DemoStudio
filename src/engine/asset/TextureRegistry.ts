/**
 * TextureRegistry — 项目内贴图资产注册中心
 *
 * 把项目 asset/ 下的图片文件（jpg/png/webp/...）注册为可按 "asset/..." 路径
 * 引用的贴图资产：蓝图 texture 字段写 "asset/textures/earth.jpg"，
 * loadTexture 在加载时翻译为 Vite import.meta.glob(?url) 得到的打包 URL。
 *
 * 注册链路（与场景/蓝图/脚本同一套约定，新增文件零代码改动）：
 *   项目 asset/index.ts 用 import.meta.glob<{ default: string }>('./**\/*.jpg', { eager: true, query: '?url' })
 *   收集 → TextureRegistry.registerGlob(结果)
 *
 * 为什么用 ?url：图片经 import 得到的是构建期确定的静态资源 URL
 * （dev 为文件路径、build 为带 hash 的 /assets/...），规避运行时相对路径
 * 解析不到打包资产的 404 问题（SSS 星图首版手写 import 的痛点）。
 *
 * 路径推导（textureKeyToAssetPath）：与 AssetRegistry.globKeyToAssetPath 同构——
 * 外部工程 glob key 形如 "/projects/warm-current/asset/textures/earth.jpg"，
 * 截取 asset/ 段；项目内相对 key "./textures/earth.jpg" 前缀补 asset/。
 * 注册 key 即蓝图引用字符串，挪动贴图文件 = 改注册 key = 所有引用失效（与蓝图 ref 同规）。
 */
import { logger } from '../Logger'

/** import.meta.glob(?url) 结果：key = 相对 asset/ 的文件路径，value.default = 打包 URL。
 *  兼容裸字符串形态（某些运行时下 import: 'default' 的实际返回） */
export type TextureUrlModules = Record<string, { default: string } | string>

/** 将 glob key（相对 asset/ 或外部工程绝对路径）转为注册路径（asset/...） */
export function textureKeyToAssetPath(key: string): string {
  // "/projects/warm-current/asset/textures/earth.jpg" → "asset/textures/earth.jpg"
  const idx = key.indexOf('asset/')
  if (idx >= 0) return key.slice(idx)
  // "./textures/earth.jpg" → "asset/textures/earth.jpg"
  const cleaned = key.replace(/^\.\//, '')
  return cleaned.startsWith('asset/') ? cleaned : `asset/${cleaned}`
}

export class TextureRegistry {
  /** 注册路径（asset/...）→ 打包 URL */
  private static urls = new Map<string, string>()

  /** 批量注册：接收 import.meta.glob(?url) 的 eager 结果，key 自动推导注册路径 */
  static registerGlob(modules: TextureUrlModules): void {
    for (const [key, mod] of Object.entries(modules)) {
      // 兼容两种形态：{ default: url }（标准模块对象）/ 裸 string（部分运行时 import:'default' 的实际返回）
      const url = typeof mod === 'string' ? mod : mod?.default
      if (typeof url !== 'string' || !url) {
        logger.warn(`[TextureRegistry] 贴图模块缺 default URL，跳过: ${key}`)
        continue
      }
      const path = textureKeyToAssetPath(key)
      TextureRegistry.urls.set(path, url)
    }
    if (modules && Object.keys(modules).length > 0) {
      logger.info(`[TextureRegistry] 注册贴图资产: ${Object.keys(modules).length} 个`)
    }
  }

  /** 蓝图 texture 引用 → 打包 URL。
   *  非 asset/ 路径（http/blob/data/绝对路径等显式 URL）原样 passthrough；
   *  asset/ 路径查注册表，未注册返回 null（loadTexture 回退原值）。 */
  static resolve(path: string): string | null {
    if (!path.startsWith('asset/')) return path
    return TextureRegistry.urls.get(path) ?? null
  }

  /** 是否已注册 */
  static has(path: string): boolean {
    return TextureRegistry.urls.has(path)
  }

  /** 所有已注册路径（诊断 / Inspector 下拉用） */
  static getRegisteredPaths(): string[] {
    return [...TextureRegistry.urls.keys()]
  }

  /** 清空注册表（切工程时与 AssetRegistry.reset 等一起调用） */
  static clearAll(): void {
    TextureRegistry.urls.clear()
  }
}
