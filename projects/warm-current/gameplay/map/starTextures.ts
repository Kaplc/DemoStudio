/**
 * starTextures — 星图天体程序化贴图（Canvas 程序噪声，无外部资产依赖）
 *
 * 图像生成 API 额度受限/不可用时保证星图可换装：每张贴图 = 纬度底色分带 + 噪声
 * 斑点层叠涂，经度环绕（x 出界回卷）弱化球面接缝；Canvas → CanvasTexture（sRGB）。
 * 天体色调沿用星图原配色（sun 熔金 / earth 蓝绿 / moon 灰月海 / europa 冰裂 / mars 锈红）。
 *
 * 先例：引擎 ShadowBlobComponent 的 sharedTexture 程序化兜底思路（环境无 DOM canvas
 * 时降级）。无模块级缓存：每个天体 Actor 生成时调用一次（BeginPlay），贴图挂在其
 * SphereMesh 材质上，Actor 销毁时经 ThreeObject.dispose 递归释放。
 */
import * as THREE from 'three'
import { logger } from '@/engine'

// ─── Solar System Scope 真贴图（CC BY 4.0，1638×819 equirect）───
// 来源 Solar System Scope / NASA imagery，经 Qt qt3d planets-qml 分发；
// 许可与归属：asset/textures/LICENSE-solarsystemscope.txt + qt_attribution.json。
// Vite 静态资源 URL import（hoi4 provinces.png 同款），构建期保证路径有效，
// 运行时直接得到可用 URL 喂 loadTexture 缓存。europa 木卫二官方无提供，程序化兜底。
import sunUrl from '../../asset/textures/sun.jpg'
import mercuryUrl from '../../asset/textures/mercury.jpg'
import venusUrl from '../../asset/textures/venus.jpg'
import earthUrl from '../../asset/textures/earth.jpg'
import moonUrl from '../../asset/textures/moon.jpg'
import marsUrl from '../../asset/textures/mars.jpg'
import jupiterUrl from '../../asset/textures/jupiter.jpg'
import saturnUrl from '../../asset/textures/saturn.jpg'
import uranusUrl from '../../asset/textures/uranus.jpg'
import neptuneUrl from '../../asset/textures/neptune.jpg'

/** 天体 → SSS 真贴图 URL（官方未提供的 europa/未知天体不在表中 → null） */
export function bodyTextureUrl(bodyId: string): string | null {
  const table: Record<string, string> = {
    sun: sunUrl, mercury: mercuryUrl, venus: venusUrl, earth: earthUrl, moon: moonUrl,
    mars: marsUrl, jupiter: jupiterUrl, saturn: saturnUrl, uranus: uranusUrl, neptune: neptuneUrl,
  }
  return table[bodyId] ?? null
}

/** 斑点层（噪声基元）：数量 + 半径范围 + 颜色 + 不透明度 */
interface BlobLayer {
  count: number
  rMin: number
  rMax: number
  color: string
  alpha: number
}

/** 每天体贴图配方 */
interface StarTexRecipe {
  /** 底色带（纬度分段：y 比例 → 颜色），从北极到南极 */
  bands: Array<{ at: number; color: string }>
  /** 斑点层（叠涂） */
  blobs: BlobLayer[]
}

/** 暖流星图调色（与 balance.COLORS 同源观感） */
const RECIPES: Record<string, StarTexRecipe> = {
  sun: {
    bands: [
      { at: 0, color: '#ffd98a' }, { at: 0.5, color: '#ffb347' },
      { at: 0.82, color: '#ff9840' }, { at: 1, color: '#e07b30' },
    ],
    blobs: [
      { count: 90, rMin: 2, rMax: 9, color: '#ffdf9e', alpha: 0.5 },
      { count: 26, rMin: 4, rMax: 14, color: '#e8871f', alpha: 0.4 },
      { count: 7, rMin: 3, rMax: 8, color: '#b8651a', alpha: 0.5 },
    ],
  },
  earth: {
    bands: [
      { at: 0, color: '#dfeef5' }, { at: 0.12, color: '#bcd9e8' }, { at: 0.22, color: '#3f83a8' },
      { at: 0.5, color: '#2f6d92' }, { at: 0.78, color: '#3f83a8' }, { at: 0.9, color: '#bcd9e8' },
      { at: 1, color: '#e8f2f8' },
    ],
    blobs: [
      { count: 12, rMin: 14, rMax: 42, color: '#5e9468', alpha: 0.9 },
      { count: 10, rMin: 8, rMax: 26, color: '#8aa66a', alpha: 0.85 },
      { count: 26, rMin: 10, rMax: 36, color: '#e8f2f8', alpha: 0.25 },
      { count: 40, rMin: 2, rMax: 7, color: '#ffffff', alpha: 0.35 },
    ],
  },
  moon: {
    bands: [
      { at: 0, color: '#d8dee4' }, { at: 0.5, color: '#c9d4de' }, { at: 1, color: '#b9c4cf' },
    ],
    blobs: [
      { count: 9, rMin: 16, rMax: 40, color: '#a8b4c0', alpha: 0.55 },
      { count: 46, rMin: 2, rMax: 8, color: '#8e9aa6', alpha: 0.5 },
      { count: 26, rMin: 1.5, rMax: 5, color: '#e8edf2', alpha: 0.5 },
    ],
  },
  europa: {
    bands: [
      { at: 0, color: '#e8f4fa' }, { at: 0.5, color: '#bfe0f0' }, { at: 1, color: '#a8d0e8' },
    ],
    blobs: [
      { count: 30, rMin: 1, rMax: 4, color: '#b06a4a', alpha: 0.55 },
      { count: 16, rMin: 2, rMax: 6, color: '#c88a62', alpha: 0.4 },
      { count: 8, rMin: 8, rMax: 20, color: '#d8ecf6', alpha: 0.5 },
    ],
  },
  mercury: {
    bands: [
      { at: 0, color: '#a89c90' }, { at: 0.5, color: '#9a8f84' }, { at: 1, color: '#847a70' },
    ],
    blobs: [
      { count: 52, rMin: 2, rMax: 7, color: '#6e645c', alpha: 0.5 },
      { count: 20, rMin: 1.5, rMax: 4, color: '#c4bab0', alpha: 0.45 },
    ],
  },
  venus: {
    bands: [
      { at: 0, color: '#e8cf9e' }, { at: 0.5, color: '#d9b06c' }, { at: 1, color: '#c29a58' },
    ],
    blobs: [
      { count: 14, rMin: 18, rMax: 48, color: '#e8d8a8', alpha: 0.4 },
      { count: 10, rMin: 10, rMax: 28, color: '#b8905a', alpha: 0.35 },
    ],
  },
  jupiter: {
    bands: [
      { at: 0, color: '#e0cba8' }, { at: 0.18, color: '#c9a678' }, { at: 0.34, color: '#a87c50' },
      { at: 0.46, color: '#d9b88c' }, { at: 0.58, color: '#b8865a' }, { at: 0.74, color: '#c9a678' },
      { at: 0.9, color: '#e0cba8' }, { at: 1, color: '#a87850' },
    ],
    blobs: [
      { count: 16, rMin: 8, rMax: 26, color: '#e8d8b8', alpha: 0.4 },
      { count: 8, rMin: 4, rMax: 10, color: '#b05a3a', alpha: 0.55 },
      { count: 24, rMin: 2, rMax: 6, color: '#f0e4cc', alpha: 0.35 },
    ],
  },
  saturn: {
    bands: [
      { at: 0, color: '#e8d8ac' }, { at: 0.5, color: '#d8c08c' }, { at: 0.85, color: '#c8ac74' },
      { at: 1, color: '#e0d0a0' },
    ],
    blobs: [
      { count: 12, rMin: 10, rMax: 30, color: '#f0e4c0', alpha: 0.35 },
      { count: 10, rMin: 6, rMax: 16, color: '#b09868', alpha: 0.3 },
    ],
  },
  uranus: {
    bands: [
      { at: 0, color: '#b8e4e8' }, { at: 0.5, color: '#9fd8dd' }, { at: 1, color: '#88c8d0' },
    ],
    blobs: [
      { count: 6, rMin: 10, rMax: 24, color: '#c8ecf0', alpha: 0.3 },
    ],
  },
  neptune: {
    bands: [
      { at: 0, color: '#6a9ce0' }, { at: 0.5, color: '#5a8fd8' }, { at: 1, color: '#4a7cc8' },
    ],
    blobs: [
      { count: 8, rMin: 6, rMax: 16, color: '#3a68b0', alpha: 0.4 },
      { count: 4, rMin: 2, rMax: 5, color: '#d8e8f8', alpha: 0.45 },
    ],
  },
  mars: {
    bands: [
      { at: 0, color: '#e8d8c8' }, { at: 0.1, color: '#d8a878' }, { at: 0.5, color: '#e8926f' },
      { at: 0.9, color: '#c87850' }, { at: 1, color: '#e8dcc8' },
    ],
    blobs: [
      { count: 26, rMin: 6, rMax: 22, color: '#a85a38', alpha: 0.5 },
      { count: 44, rMin: 2, rMax: 8, color: '#f0b088', alpha: 0.4 },
      { count: 10, rMin: 4, rMax: 12, color: '#7a4228', alpha: 0.45 },
    ],
  },
}

/** 确定性 PRNG（mulberry32，配方稳定 → 贴图稳定，快照/重放观感一致） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t ^ (t >>> 14)) >>> 0
    return t / 4294967296
  }
}

/** 纬度取色（bands 分段：相邻带硬切，观感为纬向色层） */
function bandColor(recipe: StarTexRecipe, t: number): string {
  for (let i = 0; i < recipe.bands.length - 1; i++) {
    if (t >= recipe.bands[i].at && t <= recipe.bands[i + 1].at) {
      const f = (t - recipe.bands[i].at) / Math.max(1e-6, recipe.bands[i + 1].at - recipe.bands[i].at)
      return f < 0.5 ? recipe.bands[i].color : recipe.bands[i + 1].color
    }
  }
  return recipe.bands[recipe.bands.length - 1].color
}

/** 画一个经度环绕的圆（x 出界回卷，接缝两侧纹理连续） */
function wrapCircle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, W: number): void {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  if (x < r) { ctx.beginPath(); ctx.arc(x + W, y, r, 0, Math.PI * 2); ctx.fill() }
  if (x > W - r) { ctx.beginPath(); ctx.arc(x - W, y, r, 0, Math.PI * 2); ctx.fill() }
}

/**
 * 生成天体贴图（equirect 2:1，球面 UV 直接包裹）。
 * 环境无 DOM canvas（单测/极简容器）返回 null，调用方保持无贴图纯色。
 */
export function makeStarTexture(bodyId: string): THREE.CanvasTexture | null {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null
  if (!canvas) return null
  const recipe = RECIPES[bodyId] ?? RECIPES.moon
  const W = 512
  const H = 256
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  // 1) 纬度底色带
  for (let y = 0; y < H; y++) {
    ctx.fillStyle = bandColor(recipe, y / (H - 1))
    ctx.fillRect(0, y, W, 1)
  }
  // 2) 斑点层（叠涂，经度环绕）
  const rnd = mulberry32(0x5742)
  for (const layer of recipe.blobs) {
    ctx.fillStyle = layer.color
    ctx.globalAlpha = layer.alpha
    for (let i = 0; i < layer.count; i++) {
      const r = layer.rMin + rnd() * (layer.rMax - layer.rMin)
      const x = rnd() * W
      const y = H * 0.08 + rnd() * H * 0.84
      wrapCircle(ctx, x, y, r, W)
    }
  }
  ctx.globalAlpha = 1
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * 天体贴图统一入口：真贴图优先（SSS CC-BY 4.0），程序化兜底。
 * 返回 string = 真贴图 URL（调用方 setTexture(string) 走 loadTexture 缓存）；
 * 返回 Texture = 程序化 CanvasTexture（europa 及配方内未知天体）；
 * null = 无 DOM canvas 环境且无真贴图，调用方保持无贴图纯色。
 */
export function starTextureFor(bodyId: string): string | THREE.Texture | null {
  return bodyTextureUrl(bodyId) ?? makeStarTexture(bodyId)
}

// ─── 地球特写增强贴图（观察模式：地形凹凸）───
// 确定性随机（mulberry32 固定种子）→ 贴图稳定，快照/重放观感一致。
// 无 DOM canvas（单测/极简容器）返回 null，调用方跳过该层（材质保持默认）。
// 夜面城市灯光已按用户要求移除（2026-09-10）：原 makeEarthNightTexture 连同
// EarthActor 的日面遮罩 shader 一并删除。
// 地球云层壳亦已按用户要求移除（2026-09-10）：原 earthCloudsUrl() 是恒 null 的死导出
// （SSS 未提供云图，云层恒走程序化兜底），随云层壳一并删除；本区只剩 bump 一张。

/**
 * 地球地形凹凸灰度图（equirect 512×256，配 albedo UV）。
 * 低频"大陆板块"隆起 + 高频噪声细部；灰度 = 高度 → bumpMap 消费
 * （bumpScale 控强度）。确定性风格。
 */
export function makeEarthBumpTexture(): THREE.CanvasTexture | null {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null
  if (!canvas) return null
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const W = 512
  const H = 256
  canvas.width = W
  canvas.height = H
  // 海平面中灰（海洋平坦）
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, W, H)
  const rnd = mulberry32(0xb0b5)
  // 14 块大陆板块（亮 = 高地），椭圆叠涂 + 经度环绕
  for (let c = 0; c < 14; c++) {
    const cx = rnd() * W
    const cy = H * (0.2 + rnd() * 0.6)
    const rx = 30 + rnd() * 70
    const ry = rx * (0.4 + rnd() * 0.5)
    const lift = 150 + Math.floor(rnd() * 80)
    ctx.fillStyle = `rgb(${lift},${lift},${lift})`
    ctx.globalAlpha = 0.5
    for (const dx of [0, -W, W]) {
      ctx.beginPath()
      ctx.ellipse(cx + dx, cy, rx, ry, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  // 高频山脉噪声细部
  ctx.globalAlpha = 0.25
  for (let i = 0; i < 900; i++) {
    const g = 90 + Math.floor(rnd() * 140)
    ctx.fillStyle = `rgb(${g},${g},${g})`
    const x = rnd() * W
    const y = H * 0.1 + rnd() * H * 0.8
    ctx.fillRect(x, y, 1 + rnd() * 3, 1 + rnd() * 2)
  }
  ctx.globalAlpha = 1
  const tex = new THREE.CanvasTexture(canvas)
  // 凹凸图是数据（非线性）贴图：不设 sRGB
  return tex
}

// ─── 地球海洋高光粗糙度分区（2026-09-12 群星观感改版：PBR 镜面反射）───

/**
 * 从真实 albedo（earth.jpg）派生海洋/陆地粗糙度分区：蓝主导像素（海洋）→ 低粗糙度
 * （GGX 镜面高光），其余（陆地/冰盖）→ 高粗糙度（哑光）。与真实大陆形状对齐，
 * 高光只落在海面上。异步入 Image 解码后回调挂材质（加载失败静默跳过，不阻塞装配）。
 * 无 DOM 环境（单测）直接返回。
 */
export function applyEarthOceanRoughness(mesh: { setRoughnessMap(t: THREE.Texture | null): void }): void {
  if (typeof document === 'undefined') return
  const img = new Image()
  img.onload = () => {
    try {
      const W = 512
      const H = 256
      // 1) albedo 画到采样画布，逐像素分类（海洋=蓝主导且足够蓝）
      const s = document.createElement('canvas')
      s.width = W
      s.height = H
      const sc = s.getContext('2d')
      if (!sc) return
      sc.drawImage(img, 0, 0, W, H)
      const data = sc.getImageData(0, 0, W, H).data
      // 2) 分类到 1/4 分辨率掩码（海洋暗=光滑 / 陆地亮=哑光）
      const mW = W >> 2
      const mH = H >> 2
      const m = document.createElement('canvas')
      m.width = mW
      m.height = mH
      const mc = m.getContext('2d')
      if (!mc) return
      const mid = mc.createImageData(mW, mH)
      for (let y = 0; y < mH; y++) {
        for (let x = 0; x < mW; x++) {
          const sx = Math.min(W - 1, Math.floor((x * W) / mW))
          const sy = Math.min(H - 1, Math.floor((y * H) / mH))
          const i = (sy * W + sx) * 4
          const r = data[i]
          const b = data[i + 2]
          const ocean = b > r + 12 && b > 70
          // 粗糙度值：海洋 ~0.45（宽柔高光——0.28 以下 GGX 峰值过曝会被 bloom 炸成白穹）/ 陆地 ~0.92（哑光）
          const v = ocean ? 115 : 235
          const o = (y * mW + x) * 4
          mid.data[o] = v
          mid.data[o + 1] = v
          mid.data[o + 2] = v
          mid.data[o + 3] = 255
        }
      }
      mc.putImageData(mid, 0, 0)
      // 3) 放大回 W×H（canvas 双线性平滑 → 海岸线柔化，无硬边）
      const f = document.createElement('canvas')
      f.width = W
      f.height = H
      const fc = f.getContext('2d')
      if (!fc) return
      fc.imageSmoothingEnabled = true
      fc.imageSmoothingQuality = 'high'
      fc.drawImage(m, 0, 0, W, H)
      const tex = new THREE.CanvasTexture(f)
      // 粗糙度是数据（非线性）贴图：不设 sRGB
      mesh.setRoughnessMap(tex)
      logger.info('[starTextures] Earth 海洋粗糙度贴图装配完成（PBR 海洋高光）')
    } catch (err) {
      logger.warn(`[starTextures] Earth 海洋粗糙度贴图生成失败（跳过高光层）: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  img.src = earthUrl
}
