/**
 * SVGTexture — SVG 文件运行时栅格化（浏览器渲染管线）
 *
 * 路线：SVG 文本 → 定标 → 尺寸注入 → blob URL → new Image() 解码 →
 * 离屏 canvas drawImage → THREE.CanvasTexture。浏览器即最完整的 SVG 渲染器
 * （SVG-in-img 静态快照：CSS/滤镜/文本全特性，不执行脚本、不加载外链资源），
 * 不引入 three SVGLoader（贴图场景覆盖度差且为解析成几何设计）。
 *
 * 两条消费路径：
 *   3D 端  loadTexture() 按 .svg 后缀分流到 loadSVGTexture（SphereMesh 等零改动获益）
 *   UI 端  UIImageComponent.loadImage 分流到 loadSVGImage（控件尺寸 × density 定标）
 *
 * 占位契约（关键设计）：loadSVGTexture 同步返回以洋红占位 canvas 建立的
 * CanvasTexture，异步光栅化完成后重设同一 canvas 尺寸（重设即清空）再画入真图，
 * texture.needsUpdate = true —— Texture 实例不变，材质引用不断，调用方零感知。
 * 失败路径：logger.error + 保留洋红占位（坏图编辑器里一眼可见，不 crash）。
 *
 * 已知约束（详见 doc-dev/svg-texture/plan.md §8）：
 *   - SVG-in-img 不执行脚本、不加载外链图片/字体 → assetLint doc:svg 拦外链；
 *     svg 内引用 http 资源会污染 canvas → CanvasTexture GPU 上传静默失败 → lint error 硬拦；
 *   - 只有 viewBox 的 SVG 直接画 = Firefox 0×0 / Chrome 300×150 → 显式注入尺寸是硬前提；
 *   - 光栅化尺寸 clamp 4096（GPU 纹理保守上限）。
 */
import * as THREE from 'three'
import { logger } from '../Logger'

export interface SVGRenderOptions {
  /** 光栅化目标宽/高（SVG 用户单位）。缺省 = 根元素 width/height，再缺省 = viewBox 宽高 */
  width?: number
  height?: number
  /** 超采样倍率，默认 2（位图像素 = 目标尺寸 × density，覆盖 4K 缩放） */
  density?: number
}

/** 默认超采样倍率：控件位图即显示像素（1单位=1px 体制），×2 覆盖 4K 整数缩放 */
const DEFAULT_DENSITY = 2
/** GPU 纹理单边保守上限（光栅化尺寸 clamp） */
const MAX_TEXTURE_EDGE = 4096
/** 占位 canvas 标记（dataset 键；loadSVGTexture 据此跳过占位回填，测试据此断言失败路径） */
const PLACEHOLDER_FLAG = 'svgPlaceholder'

/** 缓存：resolvedUrl|width x height|density → CanvasTexture。density 不同 = 不同实例 */
const textureCache = new Map<string, THREE.CanvasTexture>()

/** 是否 SVG 来源：.svg 后缀（dev 文件路径 / build 带 hash URL）或内联 data URI
 *  （vite dev 下 svg ?url 会被内联成 data:image/svg+xml，后缀判定不到） */
export function isSVGUrl(url: string): boolean {
  return /\.svg($|\?)/i.test(url) || /^data:image\/svg\+xml/i.test(url.trim())
}

/** 加载 SVG 为离屏 canvas（定标 → fetch → 注入尺寸 → blob → Image → drawImage）。
 *  内容级失败（XML 解析失败 / 无尺寸 / 解码失败）不 reject：logger.error 后 resolve
 *  洋红占位 canvas；仅 fetch IO 失败 reject（调用方自行兜底）。 */
export async function loadSVGImage(url: string, opts?: SVGRenderOptions): Promise<HTMLCanvasElement> {
  const text = await fetchSVGText(url)
  try {
    return await rasterizeSVG(text, opts)
  } catch (err) {
    logger.error(`[SVGTexture] SVG 光栅化失败: ${url} — ${errMsg(err)}（返回洋红占位）`)
    return createPlaceholderCanvas()
  }
}

/** loadTexture 的 svg 分流出口：同步返回占位 CanvasTexture、异步填充（与 loadTexture 契约一致）。
 *  同 url 同 opts 返回缓存同实例；density/尺寸不同 = 不同实例。 */
export function loadSVGTexture(resolvedUrl: string, opts?: SVGRenderOptions): THREE.CanvasTexture {
  const density = opts?.density ?? DEFAULT_DENSITY
  const key = `${resolvedUrl}|${opts?.width ?? ''}x${opts?.height ?? ''}|d${density}`
  const cached = textureCache.get(key)
  if (cached) return cached

  const canvas = createPlaceholderCanvas()
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  // flipY 走 THREE 默认 true（与 TextureLoader 加载位图一致）
  textureCache.set(key, tex)

  void loadSVGImage(resolvedUrl, opts)
    .then((real) => {
      // 内容失败时 loadSVGImage 已 log 并返回占位——保持纹理占位态，不重复填充
      if (isSVGPlaceholderCanvas(real)) return
      canvas.width = real.width // 重设尺寸即清空画布，正好覆盖掉占位纹
      canvas.height = real.height
      canvas.getContext('2d')?.drawImage(real, 0, 0)
      delete canvas.dataset[PLACEHOLDER_FLAG] // 摘掉占位标记：此后是真图 canvas
      tex.needsUpdate = true
    })
    .catch((err) => {
      logger.error(`[SVGTexture] SVG 加载失败: ${resolvedUrl} — ${errMsg(err)}（保留洋红占位）`)
    })
  return tex
}

/** 清空 SVG 纹理缓存并释放（clearTextureCache 联动调用，两份缓存都要清） */
export function clearSVGTextureCache(): void {
  for (const tex of textureCache.values()) tex.dispose()
  textureCache.clear()
}

/** 是否为失败占位 canvas（失败视觉 = 洋红，编辑器里一眼可见坏图） */
export function isSVGPlaceholderCanvas(canvas: HTMLCanvasElement): boolean {
  return canvas.dataset[PLACEHOLDER_FLAG] === '1'
}

// ─── 内部实现 ───

async function fetchSVGText(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

/**
 * SVG 文本 → 离屏 canvas。内容级问题（解析失败 / 无法定标 / 解码失败）throw，
 * 由调用方决定占位策略。
 */
async function rasterizeSVG(text: string, opts?: SVGRenderOptions): Promise<HTMLCanvasElement> {
  const root = parseSVGDocument(text)
  if (!root) throw new Error('SVG XML 解析失败')
  const intrinsic = resolveIntrinsicSize(root)
  if (!intrinsic) throw new Error('无 viewBox 也无显式 width/height，无法定标')

  // 目标尺寸：opts 优先，其次 SVG 固有尺寸；光栅化像素 = 目标 × density，clamp 4096
  const width = opts?.width ?? intrinsic.width
  const height = opts?.height ?? intrinsic.height
  const density = opts?.density ?? DEFAULT_DENSITY
  const pw = clampEdge(Math.round(width * density))
  const ph = clampEdge(Math.round(height * density))

  // 尺寸注入：根元素缺显式 width/height 时按固有尺寸补齐（blob 解码出确定视口）。
  // 只有 viewBox 的 SVG 直接画 = Firefox 0×0 / Chrome 300×150，注入是硬前提。
  if (parseSVGLength(root.getAttribute('width')) === null) root.setAttribute('width', String(intrinsic.width))
  if (parseSVGLength(root.getAttribute('height')) === null) root.setAttribute('height', String(intrinsic.height))

  const serialized = new XMLSerializer().serializeToString(root.ownerDocument ?? root)
  const img = await decodeSVG(serialized)

  const canvas = document.createElement('canvas')
  canvas.width = pw
  canvas.height = ph
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2D 上下文不可用')
  ctx.drawImage(img, 0, 0, pw, ph)
  return canvas
}

/** XML 解析；失败（parsererror / 根非 svg）返回 null。 */
function parseSVGDocument(text: string): SVGSVGElement | null {
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  } catch {
    return null
  }
  if (doc.getElementsByTagName('parsererror').length > 0) return null
  const root = doc.documentElement
  if (!root || root.localName !== 'svg') return null
  return root as unknown as SVGSVGElement
}

/** 解析 SVG 长度属性（纯数字/px）；% 等无法定标的单位返回 null。 */
function parseSVGLength(v: string | null): number | null {
  if (!v) return null
  const m = /^\s*([+-]?\d+(?:\.\d+)?)\s*(px)?\s*$/i.exec(v)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

/** SVG 固有尺寸：显式 width/height 优先，缺省回落 viewBox 宽高；都没有 = null */
function resolveIntrinsicSize(root: SVGSVGElement): { width: number; height: number } | null {
  const w = parseSVGLength(root.getAttribute('width'))
  const h = parseSVGLength(root.getAttribute('height'))
  if (w !== null && h !== null) return { width: w, height: h }
  const vb = parseViewBox(root.getAttribute('viewBox'))
  if (vb) return { width: vb.width, height: vb.height }
  return null
}

function parseViewBox(v: string | null): { width: number; height: number } | null {
  if (!v) return null
  const parts = v.trim().split(/[\s,]+/).map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null
  const [, , w, h] = parts
  if (w <= 0 || h <= 0) return null
  return { width: w, height: h }
}

function clampEdge(px: number): number {
  return Math.max(1, Math.min(MAX_TEXTURE_EDGE, px))
}

/** 序列化文本 → blob URL → Image 解码（SVG-in-img 静态快照，脚本/外链不执行） */
function decodeSVG(svgText: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' })
    const blobUrl = URL.createObjectURL(blob)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      URL.revokeObjectURL(blobUrl)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(blobUrl)
      reject(new Error('SVG 解码失败（Image onerror）'))
    }
    img.src = blobUrl
  })
}

/** 洋红斜纹占位 canvas（与引擎排障习惯一致：坏图一眼可见） */
function createPlaceholderCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 8
  canvas.height = 8
  canvas.dataset[PLACEHOLDER_FLAG] = '1'
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#ff00ff'
    ctx.fillRect(0, 0, 8, 8)
    ctx.strokeStyle = '#4a004a'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(-2, 6)
    ctx.lineTo(6, -2)
    ctx.moveTo(2, 10)
    ctx.lineTo(10, 2)
    ctx.stroke()
  }
  return canvas
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
