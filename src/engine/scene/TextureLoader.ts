/**
 * TextureLoader — 纹理加载与缓存
 * 封装 THREE.TextureLoader，按路径缓存，避免重复加载与解码。
 * colorSpace 统一设为 sRGB（贴图用作颜色/albedo）。
 *
 * load() 同步返回 Texture：图片异步解码完成后会自动更新到引用它的材质，
 * 调用方无需 await。
 */
import * as THREE from 'three'

const cache = new Map<string, THREE.Texture>()
const loader = new THREE.TextureLoader()

/** 加载纹理（同路径返回缓存实例） */
export function loadTexture(path: string): THREE.Texture {
  const cached = cache.get(path)
  if (cached) return cached
  const tex = loader.load(path)
  tex.colorSpace = THREE.SRGBColorSpace
  cache.set(path, tex)
  return tex
}

/** 清空纹理缓存并释放显存（切换工程/卸载时调用） */
export function clearTextureCache(): void {
  for (const tex of cache.values()) tex.dispose()
  cache.clear()
}
