/**
 * MapRenderComponent — 省份地图渲染（plan §D2：单平面 + Canvas2D 分层纹理 + ID 图拾取）
 *
 * 三层离屏 canvas 合成为一张 CanvasTexture 贴在 XZ 平面上：
 *   terrain    地形底图（terrain.png 原图）
 *   political  政治色层（按国家归属逐省染色；省→色 LUT 一次扫描成图）
 *   overlay    边界线 + 选中高亮（省界细线 / 国界粗黑线 / 选中亮边）
 * 地图模式切换（政治/地形）与归属变化 → repaint()（单次全图扫描 ~10ms 级，仅事件驱动）。
 *
 * 拾取：pickProvince(screenX, screenY) —— 相机射线与 y=0 平面求交 → 像素 →
 * 省 ID 图（provinces.png ImageData，启动时读入一次）查表。不依赖物理/射线 mesh。
 */
import * as THREE from 'three'
import { ActorComponent, GameInstance, logger } from '@/engine'
import type { Actor } from '@/engine'
import { PhySys } from '@/engine'
import type { MapData } from '../core/MapData'

export type MapMode = 'political' | 'terrain'

/** 省拾取结果 */
export interface ProvincePick {
  province: number
  /** 命中点世界坐标（相机对拍用） */
  x: number
  z: number
}

export class MapRenderComponent extends ActorComponent<Actor> {
  readonly map: MapData
  private mode: MapMode = 'political'
  /** 合成画布与纹理 */
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private texture: THREE.CanvasTexture
  /** 离屏层 */
  private terrainLayer: HTMLCanvasElement
  private politicalLayer: HTMLCanvasElement
  private overlayLayer: HTMLCanvasElement
  /** 省 ID 图像素（provinces.png） */
  private idData: Uint8ClampedArray | null = null
  /** 省 id → 控制国颜色 LUT（repaint 前由 GameMode 刷新） */
  private colorLUT: Uint32Array
  /** 选中/路点高亮：pid → 0xRRGGBB */
  private highlights = new Map<number, number>()
  private planeSize: { w: number; h: number }
  private mesh: THREE.Mesh | null = null

  constructor(owner: Actor, map: MapData) {
    super(owner)
    this.name = 'MapRenderComponent'
    this.map = map
    const W = map.def.width
    const H = map.def.height
    this.planeSize = { w: map.def.worldWidth, h: map.def.worldHeight }
    this.canvas = document.createElement('canvas')
    this.canvas.width = W
    this.canvas.height = H
    this.ctx = this.canvas.getContext('2d')!
    this.terrainLayer = document.createElement('canvas')
    this.terrainLayer.width = W
    this.terrainLayer.height = H
    this.politicalLayer = document.createElement('canvas')
    this.politicalLayer.width = W
    this.politicalLayer.height = H
    this.overlayLayer = document.createElement('canvas')
    this.overlayLayer.width = W
    this.overlayLayer.height = H
    this.colorLUT = new Uint32Array(65536)
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.anisotropy = 4
  }

  override BeginPlay(): void {
    super.BeginPlay()
    // 平面网格（经 World 工厂创建统一追踪释放；CodeLint 禁裸 new THREE 几何/网格/材质）
    const factory = this.owner.world?.factory
    if (!factory) {
      logger.error('[MapRender] World 工厂不可用，地图平面无法创建')
      return
    }
    const geo = factory.createPlaneGeometry(this.planeSize.w, this.planeSize.h)
    const mat = factory.createMeshBasicMaterial({ map: this.texture })
    this.mesh = factory.createMesh(geo, mat).object
    this.mesh.rotation.x = -Math.PI / 2
    this.owner.root.add(this.mesh)
    logger.info(`[MapRender] 平面已创建 ${this.planeSize.w}x${this.planeSize.h} 世界单位`)
  }

  override EndPlay(): void {
    this.mesh?.removeFromParent()
    this.texture.dispose()
    this.mesh = null
    super.EndPlay()
  }

  /** 加载底图（terrain.png / provinces.png）；两张都就绪后自动首次重绘 */
  async loadImages(terrainUrl: string, provincesUrl: string): Promise<void> {
    const [terrainImg, provImg] = await Promise.all([
      loadImage(terrainUrl),
      loadImage(provincesUrl),
    ])
    const tctx = this.terrainLayer.getContext('2d')!
    tctx.drawImage(terrainImg, 0, 0)
    this.idData = readImageData(provImg)
    logger.info('[MapRender] 底图与省 ID 图已就绪')
    this.repaint()
  }

  /** 图片是否已就绪（bootstrap 门槛之一） */
  hasImages(): boolean {
    return this.idData !== null
  }

  setMode(mode: MapMode): void {
    if (this.mode === mode) return
    this.mode = mode
    this.repaint()
  }

  getMapMode(): MapMode {
    return this.mode
  }

  /** 设置/清除高亮（选中省、行军目的地等）；null 颜色 = 清除 */
  setHighlight(province: number, color: number | null): void {
    if (color === null) this.highlights.delete(province)
    else this.highlights.set(province, color)
    this.repaint()
  }

  clearHighlights(): void {
    if (this.highlights.size === 0) return
    this.highlights.clear()
    this.repaint()
  }

  /** 刷新控制国颜色 LUT（归属变化后由 GameMode 调用再 repaint） */
  setColorLUT(resolveColor: (province: number) => number | null): void {
    this.colorLUT.fill(0)
    for (const pid of this.map.provinces.keys()) {
      const c = resolveColor(pid)
      if (c !== null) {
        // Uint32 LUT 存 0xRRGGBB
        this.colorLUT[pid] = c
      }
    }
    this.repaint()
  }

  /** 全图重绘（地形底图 → 政治层 → 边界/高亮层 → 合成） */
  repaint(): void {
    if (!this.idData) return
    const W = this.map.def.width
    const H = this.map.def.height
    const px = this.ctx
    const pxW = W, pxH = H

    // ── 政治层：逐像素查 LUT（省→国色；海洋透明） ──
    const pctx = this.politicalLayer.getContext('2d')!
    const pimg = pctx.createImageData(pxW, pxH)
    const pdata = pimg.data
    const octx = this.overlayLayer.getContext('2d')!
    const oimg = octx.createImageData(pxW, pxH)
    const odata = oimg.data
    const idData = this.idData
    // 州归属辅助：省 → 控制国 byte（LUT 指针即国家，边界判断直接比 LUT 值）
    for (let y = 0; y < pxH; y++) {
      const row = y * pxW
      for (let x = 0; x < pxW; x++) {
        const i = row + x
        const pid = idData[i * 4] | (idData[i * 4 + 1] << 8)
        const color = this.colorLUT[pid]
        const o4 = i * 4
        if (color !== 0 && this.mode === 'political') {
          pdata[o4] = (color >> 16) & 255
          pdata[o4 + 1] = (color >> 8) & 255
          pdata[o4 + 2] = color & 255
          pdata[o4 + 3] = 170 // 政治色半透明，透出地形纹理
        }
        // 边界：与右/下邻省不同 id → 画线（国界黑、省界深灰）
        const pidR = x + 1 < pxW ? idData[(i + 1) * 4] | (idData[(i + 1) * 4 + 1] << 8) : -1
        const pidD = y + 1 < pxH ? idData[(i + pxW) * 4] | (idData[(i + pxW) * 4 + 1] << 8) : -1
        for (const nid of [pidR, pidD]) {
          if (nid === -1 || nid === pid) continue
          const isCountryBorder = this.colorLUT[pid] !== this.colorLUT[nid]
          if (isCountryBorder) {
            odata[o4] = 12; odata[o4 + 1] = 12; odata[o4 + 2] = 16; odata[o4 + 3] = 235
          } else {
            odata[o4] = 30; odata[o4 + 1] = 32; odata[o4 + 2] = 38; odata[o4 + 3] = 110
          }
          break
        }
        // 选中高亮：省内边缘发亮（简单整省提亮）
        const hl = this.highlights.get(pid)
        if (hl !== undefined) {
          odata[o4] = (hl >> 16) & 255
          odata[o4 + 1] = (hl >> 8) & 255
          odata[o4 + 2] = hl & 255
          odata[o4 + 3] = Math.max(odata[o4 + 3], 90)
        }
      }
    }
    pctx.putImageData(pimg, 0, 0)
    octx.putImageData(oimg, 0, 0)

    // ── 合成 ──
    px.clearRect(0, 0, pxW, pxH)
    px.drawImage(this.terrainLayer, 0, 0)
    if (this.mode === 'political') px.drawImage(this.politicalLayer, 0, 0)
    px.drawImage(this.overlayLayer, 0, 0)
    this.texture.needsUpdate = true
  }

  // ═══════════════ 拾取 ═══════════════

  /** 屏幕坐标 → 省 id（未命中陆地/海洋外返回 null） */
  pickProvince(screenX: number, screenY: number): ProvincePick | null {
    if (!this.idData) return null
    const cam = GameInstance.current?.getActiveCamera()
    if (!cam) return null
    const raycaster = PhySys.screenToRay(screenX, screenY, cam)
    if (!raycaster) return null
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const hit = new THREE.Vector3()
    if (!raycaster.ray.intersectPlane(plane, hit)) return null
    return this.pickAtWorld(hit.x, hit.z)
  }

  /** 世界坐标 → 省 id */
  pickAtWorld(x: number, z: number): ProvincePick | null {
    if (!this.idData) return null
    const u = this.map.def.pxPerUnit
    const pxX = Math.floor((x + this.planeSize.w / 2) * u)
    const pxY = Math.floor((z + this.planeSize.h / 2) * u)
    if (pxX < 0 || pxY < 0 || pxX >= this.map.def.width || pxY >= this.map.def.height) return null
    const i = (pxY * this.map.def.width + pxX) * 4
    const pid = this.idData[i] | (this.idData[i + 1] << 8)
    if (!this.map.province(pid)) return null
    return { province: pid, x, z }
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`[MapRender] 图片加载失败: ${url}`))
    img.src = url
  })
}

function readImageData(img: HTMLImageElement): Uint8ClampedArray {
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(0, 0, c.width, c.height).data
}
