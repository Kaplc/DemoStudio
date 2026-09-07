/**
 * MapRenderComponent — 省份地图渲染 v2（矢量填充 + 矢量边界，plan §D2 矢量化改造）
 *
 * 全部图层均为程序生成矢量，无任何底图纹理（terrain.png 已退役）：
 *   fillMesh      省填充三角网（map.geo.json 预三角化，顶点色按模式重写）
 *                 —— 政治模式=控制国色，地形模式=terrains.config 地块色（逐省确定性微抖动）
 *   borderLines   省界/国界折线（LineSegments 顶点色：黑=国界、灰=省界，随 colorLUT 动态重分类）
 *   highlightMesh 高亮省动态填充（选中/路点，独立小网格）
 *   labelSprites  国名标注（CanvasTexture Sprite，屏幕恒定字号，tick 逐帧缩放）
 *
 * 放大锐利性：填充与边界全是几何（不随纹理插值放大），边界线恒 1 屏幕像素。
 * 政治色更新：setColorLUT → 遍历 fillRanges 写顶点色（157k 顶点 ~1ms，替代旧 2M 像素全图扫描）。
 * 拾取：pickProvince(screenX, screenY) —— 相机射线与 y=0 平面求交 → 省 ID 图（provinces.png）查表，与渲染解耦。
 */
import * as THREE from 'three'
import { ActorComponent, GameInstance, logger, ThreeObject } from '@/engine'
import type { Actor } from '@/engine'
import { PhySys } from '@/engine'
import type { MapData } from '../core/MapData'

export type MapMode = 'political' | 'terrain'

/** map.geo.json 结构（scripts/hoi4-map-gen.mjs 产出） */
export interface MapGeoData {
  /** 边界折线顶点（世界坐标 xz 平铺） */
  lineVerts: number[]
  /** [a, b, vStart, vCount]* —— a/b=两侧省 id */
  lineSpans: number[]
  /** 填充网格顶点（世界坐标 xz 平铺） */
  fillVerts: number[]
  /** 三角形顶点索引平铺 */
  fillTris: number[]
  /** [pid, vStart, vCount, tStart, tCount]* */
  fillRanges: number[]
  /** NE 原始矢量大边界顶点（世界坐标 xz 平铺，不经过栅格化） */
  bVerts: number[]
  /** [kind(1=海岸线 2=国界), vStart, vCount]* */
  bSpans: number[]
  /** 海面罩层顶点（全图矩形挖掉全部国家环，世界坐标 xz 平铺） */
  seaVerts: number[]
  /** 海面罩层三角形索引平铺 */
  seaTris: number[]
}

/** 省拾取结果 */
export interface ProvincePick {
  province: number
  /** 命中点世界坐标（相机对拍用） */
  x: number
  z: number
}

/** 国界线色（近黑） */
const COLOR_COUNTRY_BORDER = 0x0c0c10
/** 省界线色（中灰，纯色填充上可辨） */
const COLOR_PROV_BORDER = 0x565e68
/** 高亮填充色（选中省） */
const COLOR_HIGHLIGHT = 0xffe082
/** 无主省兜底色 */
const COLOR_UNOWNED = 0x6b7263
/** 国名标注目标屏幕字号（px） */
const LABEL_PX = 26
/** 标注面积门槛（省三角形数聚合，近似旧像素阈值） */
const LABEL_MIN_TRIS = 8

interface LabelSprite {
  sprite: THREE.Sprite
  canvas: HTMLCanvasElement
  texture: THREE.CanvasTexture
  material: THREE.SpriteMaterial
  text: string
  /** 标注锚点（世界坐标） */
  x: number
  z: number
}

export class MapRenderComponent extends ActorComponent<Actor> {
  readonly map: MapData
  private mode: MapMode = 'political'
  /** geo 数据（loadImages 注入） */
  private geo: MapGeoData | null = null
  /** 省 ID 图像素（provinces.png），拾取用 */
  private idData: Uint8ClampedArray | null = null
  /** 省 id → 控制国颜色 LUT（repaint 前由 GameMode 刷新） */
  private colorLUT: Uint32Array
  /** 湖省标记（政治模式刷成洋面色） */
  private lakeLUT: Uint8Array
  private lakeColor = 0x2c4a6c
  private seaColor = 0x2c4a6c
  /** 地形模式地块色（terrain → #rrggbb int；默认板，bootstrap 后被 terrains.config 覆盖） */
  private terrainPalette: Record<string, number> = {
    plains: 0xb3a878, forest: 0x6f8b5c, hills: 0xa89968, mountain: 0x99897a,
    marsh: 0x8ba17e, city: 0xb0a0a0, ocean: 0x2c4a6c,
  }
  /** 国名标注：pid → 标签序号（0xFFFF=无），同一国名共享一个标注 */
  private labelLUT: Uint16Array
  private labelTexts: string[] = []
  /** 选中/路点高亮：pid → 0xRRGGBB */
  private highlights = new Map<number, number>()
  /** 省 → 控制国 tag 快照（国界分类/标注归属用） */
  private planeSize: { w: number; h: number }
  /** NE 静态国界线是否过期（发生占领后切回省网格国界） */
  private bordersStale = false

  /** 视图对象（buildViews 创建，EndPlay 统一释放） */
  private fillMesh: ThreeObject<THREE.Mesh> | null = null
  private borderLines: ThreeObject<THREE.LineSegments> | null = null
  private highlightMesh: ThreeObject<THREE.Mesh> | null = null
  private seaMesh: ThreeObject<THREE.Mesh> | null = null
  private coastLines: ThreeObject<THREE.LineSegments> | null = null
  private borderLinesNE: ThreeObject<THREE.LineSegments> | null = null
  private fillGeometry: THREE.BufferGeometry | null = null
  private fillMaterial: THREE.MeshBasicMaterial | null = null
  private borderGeometry: THREE.BufferGeometry | null = null
  private borderMaterial: THREE.LineBasicMaterial | null = null
  private highlightGeometry: THREE.BufferGeometry | null = null
  private highlightMaterial: THREE.MeshBasicMaterial | null = null
  private seaGeometry: THREE.BufferGeometry | null = null
  private seaMaterial: THREE.MeshBasicMaterial | null = null
  private coastGeometry: THREE.BufferGeometry | null = null
  private coastMaterial: THREE.LineBasicMaterial | null = null
  private borderGeometryNE: THREE.BufferGeometry | null = null
  private borderMaterialNE: THREE.LineBasicMaterial | null = null
  private labels = new Map<number, LabelSprite>() // 标签序号 → sprite
  /** 省 质心（世界坐标，fillRanges 顶点平均）与三角形数 */
  private provCentroid = new Map<number, { x: number; z: number; tris: number }>()
  /** fillRanges 的 pid 索引 → [vStart, vCount, tStart, tCount] */
  private rangeByPid = new Map<number, [number, number, number, number]>()

  constructor(owner: Actor, map: MapData) {
    super(owner)
    this.name = 'MapRenderComponent'
    this.map = map
    this.planeSize = { w: map.def.worldWidth, h: map.def.worldHeight }
    this.colorLUT = new Uint32Array(65536)
    this.lakeLUT = new Uint8Array(65536)
    for (const [pid, p] of map.provinces) {
      if (p.sea && p.terrain !== 'ocean') this.lakeLUT[pid] = 1
    }
    this.labelLUT = new Uint16Array(65536).fill(0xffff)
  }

  override BeginPlay(): void {
    super.BeginPlay()
    // 视图在 loadImages 数据就绪后统一创建（工厂不可用则地图无法渲染）
    if (!this.owner.world?.factory) logger.error('[MapRender] World 工厂不可用，地图视图将无法创建')
  }

  override EndPlay(): void {
    for (const ref of [this.fillMesh, this.borderLines, this.highlightMesh, this.seaMesh, this.coastLines, this.borderLinesNE]) {
      if (!ref) continue
      ref.object.removeFromParent()
      ref.dispose() // 递归释放 geometry / material
    }
    this.fillMesh = null
    this.borderLines = null
    this.highlightMesh = null
    this.seaMesh = null
    this.coastLines = null
    this.borderLinesNE = null
    for (const l of this.labels.values()) {
      l.sprite.removeFromParent()
      l.material.dispose()
      l.texture.dispose()
    }
    this.labels.clear()
    this.fillGeometry = null
    this.fillMaterial = null
    this.borderGeometry = null
    this.borderMaterial = null
    this.highlightGeometry = null
    this.highlightMaterial = null
    this.seaGeometry = null
    this.seaMaterial = null
    this.coastGeometry = null
    this.coastMaterial = null
    this.borderGeometryNE = null
    this.borderMaterialNE = null
    super.EndPlay()
  }

  /** 加载省 ID 图与矢量数据；全部就绪后自动构建视图（bootstrap 门槛） */
  async loadImages(provincesUrl: string, geo: MapGeoData): Promise<void> {
    const provImg = await loadImage(provincesUrl)
    this.geo = geo
    this.idData = readImageData(provImg)
    this.buildGeoIndexes(geo)
    const factory = this.owner.world?.factory
    if (!factory) {
      logger.error('[MapRender] 工厂不可用，地图视图未创建')
      return
    }
    // 矢量省填充（顶点色三角网；几何已是世界 XZ 坐标，无需旋转）
    this.fillGeometry = this.buildFillGeometry(geo)
    this.fillMaterial = factory.createMeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })
    this.fillMesh = factory.createMesh(this.fillGeometry, this.fillMaterial)
    this.fillMesh.object.position.y = 0.02
    this.fillMesh.object.renderOrder = 1
    this.owner.root.add(this.fillMesh.object)
    // 矢量边界线（顶点色，只含陆-陆省界/国界；海岸段由 NE 大边界线接管）
    this.borderGeometry = this.buildBorderGeometry(geo)
    this.borderMaterial = factory.createLineBasicMaterial({ vertexColors: true })
    this.borderLines = factory.createLine(this.borderGeometry, this.borderMaterial)
    this.borderLines.object.position.y = 0.05
    this.borderLines.object.renderOrder = 3
    this.owner.root.add(this.borderLines.object)
    // 海面罩层：全图矩形挖掉国家环，盖在省填充上方 → 海岸线为 NE 平滑曲线而非栅格锯齿
    if (geo.seaVerts.length > 0 && geo.seaTris.length > 0) {
      this.seaGeometry = this.buildSeaOverlayGeometry(geo)
      this.seaMaterial = factory.createMeshBasicMaterial({ color: this.seaColor })
      this.seaMesh = factory.createMesh(this.seaGeometry, this.seaMaterial)
      this.seaMesh.object.position.y = 0.03
      this.seaMesh.object.renderOrder = 2
      this.owner.root.add(this.seaMesh.object)
    }
    // NE 大边界线：海岸线恒显（描边并压住栅格残留台阶），静态国界线政治模式显示
    if (geo.bVerts.length > 0 && geo.bSpans.length > 0) {
      this.coastGeometry = this.buildNeLineGeometry(geo, 1)
      this.coastMaterial = factory.createLineBasicMaterial({ vertexColors: true })
      this.coastLines = factory.createLine(this.coastGeometry, this.coastMaterial)
      this.coastLines.object.position.y = 0.05
      this.coastLines.object.renderOrder = 3
      this.owner.root.add(this.coastLines.object)
      this.borderGeometryNE = this.buildNeLineGeometry(geo, 2)
      this.borderMaterialNE = factory.createLineBasicMaterial({ vertexColors: true })
      this.borderLinesNE = factory.createLine(this.borderGeometryNE, this.borderMaterialNE)
      this.borderLinesNE.object.position.y = 0.05
      this.borderLinesNE.object.renderOrder = 3
      this.borderLinesNE.object.visible = this.mode === 'political' && !this.bordersStale
      this.owner.root.add(this.borderLinesNE.object)
      this.applyNeLineColors()
    }
    // 高亮网格（动态重建）；同 fill 绕向问题，双面免疫
    this.highlightMaterial = factory.createMeshBasicMaterial({
      color: COLOR_HIGHLIGHT, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide,
    })
    this.highlightMesh = null // rebuildHighlights 按需创建
    this.applyBorderColors()
    this.applyMapColors()
    this.rebuildHighlights()
    this.rebuildLabels()
    logger.info('[MapRender] 矢量地图视图就绪'
      + `（fill 顶点 ${geo.fillVerts.length / 2}，边界点 ${geo.lineVerts.length / 2}）`)
  }

  /** 图片与矢量数据是否就绪（bootstrap 门槛之一） */
  hasImages(): boolean {
    return this.idData !== null && this.geo !== null && this.fillMesh !== null
  }

  setMode(mode: MapMode): void {
    if (this.mode === mode) return
    this.mode = mode
    // 同一张填充网格，切模式 = 重写顶点色（~1ms）
    this.applyMapColors()
    for (const l of this.labels.values()) l.sprite.visible = mode === 'political'
    // 静态国界线只在政治模式显示（地形模式看地块，不看政治边界）
    if (this.borderLinesNE) this.borderLinesNE.object.visible = mode === 'political' && !this.bordersStale
  }

  /** 占领导致国界变化后调用：隐藏 NE 静态国界线，省网格国界线接管（随 LUT 精确移动） */
  setNationalBordersStale(stale: boolean): void {
    if (this.bordersStale === stale) return
    this.bordersStale = stale
    if (this.borderLinesNE) this.borderLinesNE.object.visible = !stale && this.mode === 'political'
    this.rebuildBorderIndex()
  }

  getMapMode(): MapMode {
    return this.mode
  }

  /** 设置/清除高亮（选中省、行军目的地等）；null 颜色 = 清除 */
  setHighlight(province: number, color: number | null): void {
    if (color === null) this.highlights.delete(province)
    else this.highlights.set(province, color)
    this.rebuildHighlights()
  }

  clearHighlights(): void {
    if (this.highlights.size === 0) return
    this.highlights.clear()
    this.rebuildHighlights()
  }

  /** 刷新控制国颜色 LUT（归属变化后由 GameMode 调用） */
  setColorLUT(resolveColor: (province: number) => number | null): void {
    this.colorLUT.fill(0)
    for (const pid of this.map.provinces.keys()) {
      const c = resolveColor(pid)
      if (c !== null) this.colorLUT[pid] = c
    }
    this.applyBorderColors()
    this.applyMapColors()
    this.rebuildBorderIndex() // 国界/省界分类随 LUT 变化
  }

  /** 注入地形色板（terrain → int 色；bootstrap 后由 GameMode 从 terrains.config 下发） */
  setTerrainPalette(palette: Record<string, number>): void {
    this.terrainPalette = { ...this.terrainPalette, ...palette }
    if (this.mode === 'terrain') this.applyMapColors()
  }

  /** 刷新国名标注（归属变化后调用；文本集合 diff，位置更新） */
  setCountryLabels(resolve: (province: number) => string | null): void {
    this.labelLUT.fill(0xffff)
    this.labelTexts = []
    const indexByText = new Map<string, number>()
    for (const pid of this.map.provinces.keys()) {
      const text = resolve(pid)
      if (text === null) continue
      let idx = indexByText.get(text)
      if (idx === undefined) {
        idx = this.labelTexts.length
        indexByText.set(text, idx)
        this.labelTexts.push(text)
      }
      this.labelLUT[pid] = idx
    }
    this.rebuildLabels()
  }

  /** 每帧：国名 Sprite 屏幕恒定字号缩放（相机拉远字不缩小） */
  override Tick(dt: number): void {
    void dt
    if (this.labels.size === 0 || this.mode !== 'political') return
    const inst = GameInstance.current
    const cam = inst?.getActiveCamera() as THREE.PerspectiveCamera | null
    const renderer = inst?.world.gameRenderer?.renderer
    if (!cam || !renderer) return
    const viewportH = renderer.domElement.clientHeight || 1
    const worldPerPx = (2 * cam.position.distanceTo(cam.position.clone().setY(0)) * Math.tan(((cam.fov ?? 45) * Math.PI) / 360)) / viewportH
    for (const l of this.labels.values()) {
      const h = LABEL_PX * worldPerPx
      const w = h * (l.canvas.width / l.canvas.height)
      l.sprite.scale.set(w, h, 1)
    }
  }

  // ═══════════════ 视图构建 ═══════════════

  /** geo 索引：fillRanges → rangeByPid + 省质心/三角形数（顶点平均近似） */
  private buildGeoIndexes(geo: MapGeoData): void {
    this.rangeByPid.clear()
    this.provCentroid.clear()
    const v = geo.fillVerts
    for (let r = 0; r < geo.fillRanges.length; r += 5) {
      const pid = geo.fillRanges[r]
      const vStart = geo.fillRanges[r + 1]
      const vCount = geo.fillRanges[r + 2]
      const tStart = geo.fillRanges[r + 3]
      const tCount = geo.fillRanges[r + 4]
      this.rangeByPid.set(pid, [vStart, vCount, tStart, tCount])
      let sx = 0, sz = 0
      for (let i = 0; i < vCount; i++) {
        sx += v[(vStart + i) * 2]
        sz += v[(vStart + i) * 2 + 1]
      }
      this.provCentroid.set(pid, { x: sx / Math.max(1, vCount), z: sz / Math.max(1, vCount), tris: tCount / 3 })
    }
  }

  /** 省填充三角网几何（位置 + 顶点色 + 索引） */
  private buildFillGeometry(geo: MapGeoData): THREE.BufferGeometry {
    const factory = this.owner.world!.factory
    const g = factory.createBufferGeometry()
    const n = geo.fillVerts.length / 2
    const pos = new Float32Array(n * 3)
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      pos[i * 3] = geo.fillVerts[i * 2]
      pos[i * 3 + 1] = 0
      pos[i * 3 + 2] = geo.fillVerts[i * 2 + 1]
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(geo.fillTris), 1))
    return g
  }

  /** 边界折线几何（位置 + 顶点色 + 索引，段分类在 applyBorderColors）
   *  lineVerts 是折线点序列（span 内每点存一次），LineSegments 无索引会按
   *  「两两一对」消费顶点：偶数点 span 缺段、奇数点 span 末点与下一 span 首点
   *  连成横跨地图的假线 → 必须按 span 建段索引。
   *  涉海段一律不画（海岸线由 NE 大边界线接管）；国界段按 bordersStale 切换
   *  （和平时期走 NE 平滑国界线，发生占领后省网格国界线接管）。 */
  private buildBorderGeometry(geo: MapGeoData): THREE.BufferGeometry {
    const factory = this.owner.world!.factory
    const g = factory.createBufferGeometry()
    const n = geo.lineVerts.length / 2
    const pos = new Float32Array(n * 3)
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      pos[i * 3] = geo.lineVerts[i * 2]
      pos[i * 3 + 1] = 0
      pos[i * 3 + 2] = geo.lineVerts[i * 2 + 1]
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    this.rebuildBorderIndex()
    return g
  }

  /** 按「陆-陆 + 国界显隐规则」重建省界线段索引（LUT 变化/占领切换时调用） */
  private rebuildBorderIndex(): void {
    const geo = this.geo
    const g = this.borderGeometry
    if (!geo || !g) return
    const spans = geo.lineSpans
    const want = (a: number, b: number): boolean => {
      if (!this.isLandSpan(a, b)) return false
      // 和平时期国界由 NE 线画；省界（同控制国）始终画
      return this.bordersStale || this.colorLUT[a] === this.colorLUT[b]
    }
    let segTotal = 0
    for (let r = 0; r < spans.length; r += 4) if (want(spans[r], spans[r + 1])) segTotal += spans[r + 3] - 1
    const idx = new Uint32Array(segTotal * 2)
    let w = 0
    for (let r = 0; r < spans.length; r += 4) {
      if (!want(spans[r], spans[r + 1])) continue
      const vStart = spans[r + 2]
      const vCount = spans[r + 3]
      for (let i = 0; i + 1 < vCount; i++) {
        idx[w++] = vStart + i
        idx[w++] = vStart + i + 1
      }
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1))
  }

  /** span 两侧都是陆省才画（海省 id / 未知 id 一律不画） */
  private isLandSpan(a: number, b: number): boolean {
    if (a === 0 || b === 0) return false
    const pa = this.map.province(a)
    const pb = this.map.province(b)
    return !!pa && !pa.sea && !!pb && !pb.sea
  }

  /** 海面罩层几何（全图矩形 - 国家环，顶点已预三角化） */
  private buildSeaOverlayGeometry(geo: MapGeoData): THREE.BufferGeometry {
    const factory = this.owner.world!.factory
    const g = factory.createBufferGeometry()
    const n = geo.seaVerts.length / 2
    const pos = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      pos[i * 3] = geo.seaVerts[i * 2]
      pos[i * 3 + 1] = 0
      pos[i * 3 + 2] = geo.seaVerts[i * 2 + 1]
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(geo.seaTris), 1))
    return g
  }

  /** NE 大边界线几何（kind：1=海岸线 2=国界），顶点色由 applyNeLineColors 写 */
  private buildNeLineGeometry(geo: MapGeoData, kind: number): THREE.BufferGeometry {
    const factory = this.owner.world!.factory
    const g = factory.createBufferGeometry()
    // 顶点按 span 区间拷贝（kind 过滤后顶点局部化，省得整表建索引）
    const posArr: number[] = []
    const colArr: number[] = []
    const idx: number[] = []
    for (let r = 0; r < geo.bSpans.length; r += 3) {
      if (geo.bSpans[r] !== kind) continue
      const vStart = geo.bSpans[r + 1]
      const vCount = geo.bSpans[r + 2]
      const base = posArr.length / 3
      for (let i = 0; i < vCount; i++) {
        posArr.push(geo.bVerts[(vStart + i) * 2], 0, geo.bVerts[(vStart + i) * 2 + 1])
        colArr.push(0, 0, 0)
      }
      for (let i = 0; i + 1 < vCount; i++) {
        idx.push(base + i, base + i + 1)
      }
    }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(posArr), 3))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colArr), 3))
    g.setIndex(idx)
    return g
  }

  /** NE 线顶点色（海岸=洋面加深，国界=国界黑） */
  private applyNeLineColors(): void {
    const fills: Array<[THREE.BufferGeometry | null, THREE.Color]> = [
      [this.coastGeometry, new THREE.Color(this.seaColor).multiplyScalar(0.55)],
      [this.borderGeometryNE, new THREE.Color(COLOR_COUNTRY_BORDER)],
    ]
    for (const [geo, c] of fills) {
      const attr = geo?.getAttribute('color') as THREE.BufferAttribute | undefined
      if (!attr) continue
      const arr = attr.array as Float32Array
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] = c.r; arr[i + 1] = c.g; arr[i + 2] = c.b
      }
      attr.needsUpdate = true
    }
  }

  /** 按当前模式把色板写入填充顶点色（政治=控制国色，地形=地块色） */
  private applyMapColors(): void {
    if (this.mode === 'terrain') this.applyTerrainColors()
    else this.applyFillColors()
  }

  /** 政治色 → 填充顶点色（全量重写，~1ms） */
  private applyFillColors(): void {
    const geo = this.geo
    const attr = this.fillGeometry?.getAttribute('color') as THREE.BufferAttribute | undefined
    if (!geo || !attr) return
    const arr = attr.array as Float32Array
    const tmp = new THREE.Color()
    const writeRange = (vStart: number, vCount: number, hex: number) => {
      tmp.setHex(hex)
      for (let i = 0; i < vCount; i++) {
        const o = (vStart + i) * 3
        arr[o] = tmp.r
        arr[o + 1] = tmp.g
        arr[o + 2] = tmp.b
      }
    }
    for (let r = 0; r < geo.fillRanges.length; r += 5) {
      const pid = geo.fillRanges[r]
      const vStart = geo.fillRanges[r + 1]
      const vCount = geo.fillRanges[r + 2]
      const p = this.map.province(pid)
      let color = this.colorLUT[pid]
      if (color === 0) color = p?.sea ? this.seaColor : COLOR_UNOWNED
      else if (this.lakeLUT[pid] === 1) color = this.lakeColor
      writeRange(vStart, vCount, color)
    }
    attr.needsUpdate = true
  }

  /** 地形色 → 填充顶点色（程序生成：terrains.config 地块色 + 逐省确定性明度微抖动） */
  private applyTerrainColors(): void {
    const geo = this.geo
    const attr = this.fillGeometry?.getAttribute('color') as THREE.BufferAttribute | undefined
    if (!geo || !attr) return
    const arr = attr.array as Float32Array
    const tmp = new THREE.Color()
    for (let r = 0; r < geo.fillRanges.length; r += 5) {
      const pid = geo.fillRanges[r]
      const vStart = geo.fillRanges[r + 1]
      const vCount = geo.fillRanges[r + 2]
      const p = this.map.province(pid)
      const base = p?.sea || p?.terrain === 'ocean'
        ? this.seaColor
        : (this.terrainPalette[p?.terrain ?? ''] ?? 0xa8a878)
      tmp.setHex(base).multiplyScalar(0.92 + this.hash01(pid) * 0.13)
      for (let i = 0; i < vCount; i++) {
        const o = (vStart + i) * 3
        arr[o] = tmp.r
        arr[o + 1] = tmp.g
        arr[o + 2] = tmp.b
      }
    }
    attr.needsUpdate = true
  }

  /** 省份确定性伪随机（0~1，pid 相同则恒定） */
  private hash01(pid: number): number {
    return (Math.imul(pid, 2654435761) >>> 8 & 1023) / 1023
  }

  /** 边界分类（国界黑/省界灰）→ 线顶点色 */
  private applyBorderColors(): void {
    const geo = this.geo
    const attr = this.borderGeometry?.getAttribute('color') as THREE.BufferAttribute | undefined
    if (!geo || !attr) return
    const arr = attr.array as Float32Array
    const cCountry = new THREE.Color(COLOR_COUNTRY_BORDER)
    const cProv = new THREE.Color(COLOR_PROV_BORDER)
    for (let r = 0; r < geo.lineSpans.length; r += 4) {
      const a = geo.lineSpans[r]
      const b = geo.lineSpans[r + 1]
      const vStart = geo.lineSpans[r + 2]
      const vCount = geo.lineSpans[r + 3]
      const c = this.colorLUT[a] !== this.colorLUT[b] ? cCountry : cProv
      for (let i = 0; i < vCount; i++) {
        const o = (vStart + i) * 3
        arr[o] = c.r
        arr[o + 1] = c.g
        arr[o + 2] = c.b
      }
    }
    attr.needsUpdate = true
  }

  /** 高亮省动态网格（独立 mesh，覆盖在填充上方） */
  private rebuildHighlights(): void {
    const geo = this.geo
    const factory = this.owner.world?.factory
    if (!geo || !factory) return
    if (this.highlightMesh) {
      this.highlightMesh.object.removeFromParent()
      this.highlightMesh.object.geometry.dispose()
      this.highlightMesh.dispose()
      this.highlightMesh = null
      this.highlightGeometry = null
    }
    if (this.highlights.size === 0) return
    const posArr: number[] = []
    const idxArr: number[] = []
    for (const pid of this.highlights.keys()) {
      const range = this.rangeByPid.get(pid)
      if (!range) continue
      const [vStart, vCount, tStart, tCount] = range
      const base = posArr.length / 3
      for (let i = 0; i < vCount; i++) {
        posArr.push(geo.fillVerts[(vStart + i) * 2], 0, geo.fillVerts[(vStart + i) * 2 + 1])
      }
      for (let i = 0; i < tCount; i++) idxArr.push(geo.fillTris[tStart + i] + base)
    }
    if (idxArr.length === 0) return
    const g = factory.createBufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(posArr), 3))
    g.setIndex(idxArr)
    this.highlightGeometry = g
    this.highlightMesh = factory.createMesh(g, this.highlightMaterial!)
    // 顶点已是世界 XZ 坐标（y=0），不再旋转
    this.highlightMesh.object.position.y = 0.035
    this.highlightMesh.object.renderOrder = 3
    this.owner.root.add(this.highlightMesh.object)
  }

  /** 国名标注 Sprite（文本池复用纹理；位置=成员国省质心加权） */
  private rebuildLabels(): void {
    // 每标签：三角形数（面积近似）与质心聚合
    const count = new Array<number>(this.labelTexts.length).fill(0)
    const sx = new Array<number>(this.labelTexts.length).fill(0)
    const sz = new Array<number>(this.labelTexts.length).fill(0)
    for (const [pid, idx] of this.labelIndexEntries()) {
      const c = this.provCentroid.get(pid)
      if (!c) continue
      count[idx] += c.tris
      sx[idx] += c.x * c.tris
      sz[idx] += c.z * c.tris
    }
    const wanted = new Map<number, { text: string; x: number; z: number }>()
    for (let i = 0; i < this.labelTexts.length; i++) {
      if (count[i] < LABEL_MIN_TRIS) continue // 碎占飞地不标
      wanted.set(i, { text: this.labelTexts[i], x: sx[i] / count[i], z: sz[i] / count[i] })
    }
    // 回收不再需要的
    for (const [idx, l] of [...this.labels]) {
      if (!wanted.has(idx)) {
        l.sprite.removeFromParent()
        l.material.dispose()
        l.texture.dispose()
        this.labels.delete(idx)
      }
    }
    // 新建 / 更新位置
    const factory = this.owner.world?.factory
    if (!factory) return
    for (const [idx, w] of wanted) {
      let l = this.labels.get(idx)
      if (!l) {
        l = this.createLabelSprite(factory, w.text)
        this.labels.set(idx, l)
        this.owner.root.add(l.sprite)
      }
      l.x = w.x
      l.z = w.z
      l.sprite.position.set(w.x, 0.6, w.z)
      l.sprite.visible = this.mode === 'political'
    }
  }

  /** labelLUT 非空项遍历（pid → 标签序号） */
  private *labelIndexEntries(): Generator<[number, number]> {
    for (const pid of this.map.provinces.keys()) {
      const idx = this.labelLUT[pid]
      if (idx !== 0xffff) yield [pid, idx]
    }
  }

  /** 画国名到 canvas 并建 Sprite（描边保证任何政治色上可读） */
  private createLabelSprite(factory: NonNullable<Actor['world']>['factory'], text: string): LabelSprite {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    const font = `700 64px "Source Han Sans SC", "Microsoft YaHei", sans-serif`
    ctx.font = font
    ctx.letterSpacing = '10px'
    const tw = Math.ceil(ctx.measureText(text).width) + 24
    canvas.width = Math.min(1024, Math.max(64, tw))
    canvas.height = 96
    const ctx2 = canvas.getContext('2d')!
    ctx2.font = font
    ctx2.letterSpacing = '10px'
    ctx2.textAlign = 'center'
    ctx2.textBaseline = 'middle'
    ctx2.lineJoin = 'round'
    ctx2.strokeStyle = 'rgba(12, 15, 20, 0.7)'
    ctx2.lineWidth = 8
    ctx2.strokeText(text, canvas.width / 2, canvas.height / 2 + 4)
    ctx2.fillStyle = 'rgba(255, 255, 255, 0.95)'
    ctx2.fillText(text, canvas.width / 2, canvas.height / 2 + 4)
    const texture = factory.createCanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    const material = factory.createSpriteMaterial({ map: texture, transparent: true, depthWrite: false })
    const sprite = factory.createSprite(material).object
    sprite.renderOrder = 10
    return { sprite, canvas, texture, material, text, x: 0, z: 0 }
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
