/**
 * TextureLoader — 纹理加载与缓存
 * 封装 THREE.TextureLoader，按路径缓存，避免重复加载与解码。
 * colorSpace 统一设为 sRGB（贴图用作颜色/albedo）。
 *
 * load() 同步返回 Texture：图片异步解码完成后会自动更新到引用它的材质，
 * 调用方无需 await。
 */
import * as THREE from 'three'
import { TextureRegistry } from '../asset/TextureRegistry'
import { loadSVGTexture, clearSVGTextureCache, isSVGUrl } from './SVGTexture'

const cache = new Map<string, THREE.Texture>()
const loader = new THREE.TextureLoader()

/** 加载纹理（同路径返回缓存实例）。项目资产路径（TextureRegistry 已注册）翻译为打包 URL。
 *  SVG 来源（.svg 后缀 / dev 下内联 data URI）分流到 SVGTexture（运行时栅格化 CanvasTexture），
 *  其余格式走 TextureLoader。 */
export function loadTexture(path: string): THREE.Texture {
  const resolved = TextureRegistry.resolve(path) ?? path
  if (isSVGUrl(resolved)) return loadSVGTexture(resolved)
  const cached = cache.get(resolved)
  if (cached) return cached
  const tex = loader.load(resolved)
  tex.colorSpace = THREE.SRGBColorSpace
  cache.set(resolved, tex)
  return tex
}

/** 清空纹理缓存并释放显存（切换工程/卸载时调用）。SVG 纹理是独立缓存，需一并清 */
export function clearTextureCache(): void {
  for (const tex of cache.values()) tex.dispose()
  cache.clear()
  clearSVGTextureCache()
}
