/**
 * starfieldTile — 星图背景无缝平铺星空贴图（项目侧，对齐 starTextures.ts 惯例）
 *
 * 思路：不再画一张与地图等大的巨型 canvas（拉远相机就露底），而是生成一张
 * 可无缝平铺的小 tile（512²），由 StarMapRenderComponent 铺在放大数倍的地面
 * 平面上靠 RepeatWrapping 重复拼接——单 drawcall、显存恒定、星空"无限大"。
 *
 * 无缝三要素：
 *  1. 底色渐变只沿 v 轴且首尾同色（对称渐变）→ 上下拼接无色阶跳变
 *  2. 星点/星云全部按 ±tile 九宫格环绕绘制 → 跨边元素在相邻边补画，无截断
 *  3. 星云带横向正弦起伏以 tile 宽为周期 → 左右拼接波形连续
 *
 * 环境无 2D canvas（单测/极简容器）返回 null，调用方退化为纯色地面
 * （先例：同目录 starTextures.ts makeStarTexture 的守卫写法）。
 */
import * as THREE from 'three'

/** tile 边长（POT，mipmap 友好；512² 在缩放下星点尺度与旧 1920×1080 图一致） */
export const TILE_SIZE = 512

/** 地面尺寸（tile 整数倍：19456×18432 = 38×36 次平铺；海王星轨道半径 7517px（AU×250）
 *  需地面覆盖直径 ≥15100 + 相机 12000 高度下 ±30° 视野边距，2 万级尺寸留足余量。
 *  必须取整数倍 —— 非整数 repeat 会让边缘星点被切一半、平铺不连续） */
export const GROUND_W = TILE_SIZE * 38
export const GROUND_H = TILE_SIZE * 36

/** 星空种子（确定性：同 seed 每次生成的像素一致，重进游戏星空不变） */
export const STARFIELD_TILE_SEED = 20260907

/** 星空配置 */
export interface StarfieldTileOptions {
  /** 随机种子（缺省 STARFIELD_TILE_SEED） */
  seed?: number
  /** 星点数（缺省 72，密度与旧版 340 颗/全图相当） */
  stars?: number
  /** 星云强度 [0,1]（缺省 0.5） */
  nebula?: number
}

/** mulberry32 — 种子确定性 PRNG（与引擎 ShadowBlob 系列同款） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 纹理收尾配置（对齐 StarMapRenderComponent.configureTexture 惯例） */
function configureTile(tex: THREE.CanvasTexture): void {
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.generateMipmaps = false
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.colorSpace = THREE.SRGBColorSpace
}

/**
 * 生成无缝平铺星空 tile。
 * @returns CanvasTexture（repeat 由调用方按地面尺寸设置）；无 2D canvas 环境返回 null
 */
export function makeStarfieldTileTexture(opts: StarfieldTileOptions = {}): THREE.CanvasTexture | null {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null
  const g = canvas?.getContext('2d') ?? null
  if (!canvas || !g) return null

  const S = TILE_SIZE
  const seed = Math.floor(opts.seed ?? STARFIELD_TILE_SEED)
  const starCount = Math.max(1, Math.round(opts.stars ?? 72))
  const nebula = Math.min(1, Math.max(0, opts.nebula ?? 0.5))
  const rng = mulberry32(seed)
  canvas.width = S
  canvas.height = S

  // ─── 1. 底色：对称垂直渐变（v=0 与 v=1 同色 → 上下拼接无接缝） ───
  const grad = g.createLinearGradient(0, 0, 0, S)
  grad.addColorStop(0, '#000000')
  grad.addColorStop(0.5, '#050508')
  grad.addColorStop(1, '#000000')
  g.fillStyle = grad
  g.fillRect(0, 0, S, S)

  // ─── 九宫格环绕绘制：跨边元素在相邻复制位置补画，保证平铺后连续 ───
  const drawWrapped = (draw: (ox: number, oy: number) => void, x: number, y: number, r: number): void => {
    const xs = [0]
    const ys = [0]
    if (x - r < 0) xs.push(S)
    if (x + r > S) xs.push(-S)
    if (y - r < 0) ys.push(S)
    if (y + r > S) ys.push(-S)
    for (const ox of xs) for (const oy of ys) draw(x + ox, y + oy)
  }

  // ─── 2. 星云：全 tile 均匀软刷（平铺后呈均匀深空云；带状设计会随平铺重复出条纹） ───
  if (nebula > 0) {
    for (let i = 0; i < 22; i++) {
      const x = rng() * S
      const y = rng() * S
      const r = S * (0.06 + rng() * 0.15)
      const a = (0.04 + 0.05 * nebula) * (0.5 + rng() * 0.5)
      drawWrapped(
        (ox, oy) => {
          const rg = g.createRadialGradient(ox, oy, 0, ox, oy, r)
          rg.addColorStop(0, `rgba(210,228,255,${a})`)
          rg.addColorStop(1, 'rgba(210,228,255,0)')
          g.fillStyle = rg
          g.fillRect(ox - r, oy - r, r * 2, r * 2)
        },
        x,
        y,
        r,
      )
    }
    // 彩色暗斑（紫/青各一，10% 强度，点亮色温层次）
    const tintColors = ['rgba(120,90,200,', 'rgba(70,160,190,']
    for (let i = 0; i < 2; i++) {
      const x = rng() * S
      const y = S * (0.3 + rng() * 0.4)
      const r = S * (0.18 + rng() * 0.1)
      const a = 0.08 * nebula
      drawWrapped(
        (ox, oy) => {
          const rg = g.createRadialGradient(ox, oy, 0, ox, oy, r)
          rg.addColorStop(0, `${tintColors[i]}${a})`)
          rg.addColorStop(1, `${tintColors[i]}0)`)
          g.fillStyle = rg
          g.fillRect(ox - r, oy - r, r * 2, r * 2)
        },
        x,
        y,
        r,
      )
    }
  }

  // ─── 3. 星点：全部九宫格环绕（跨边星在对面补画）；少数亮星带十字光晕 ───
  for (let i = 0; i < starCount; i++) {
    const x = rng() * S
    const y = rng() * S
    const r = rng() * 1.4 + 0.3
    const alpha = rng() * 0.55 + 0.1
    // 色温：85% 白 / 15% 冷蓝（对齐旧版配色）
    const color = rng() > 0.85 ? '#bfe9ff' : '#e8f4ff'
    const cross = rng() < 0.04
    drawWrapped(
      (ox, oy) => {
        g.globalAlpha = alpha
        g.fillStyle = color
        g.beginPath()
        g.arc(ox, oy, r, 0, Math.PI * 2)
        g.fill()
        if (cross) {
          g.globalAlpha = alpha * 0.5
          g.fillRect(ox - r * 4, oy - 0.4, r * 8, 0.8)
          g.fillRect(ox - 0.4, oy - r * 4, 0.8, r * 8)
        }
      },
      x,
      y,
      Math.max(r, cross ? r * 4 : 0),
    )
  }
  g.globalAlpha = 1

  const tex = new THREE.CanvasTexture(canvas)
  configureTile(tex)
  return tex
}
