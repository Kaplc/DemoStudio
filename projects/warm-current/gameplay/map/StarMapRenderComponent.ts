/**
 * StarMapActor — 星图渲染（3D 标准：XZ 地面 + 真实球体 + 垂直俯视透视相机）
 *
 * 对齐 hoi4 的 3D 姿态：
 *  - 地图铺 XZ 平面（世界 x/z = 地图坐标 − 半宽/半高），文字用 CanvasTexture Sprite（自动朝向相机）
 *  - 星球 = 球体网格（Lambert 材质 + 场景灯光），护盾 = 半透明球形气泡
 *  - 航线 = 贴地细长面片（预旋转压平），飞船 = 球体 + 加色辉光 Sprite
 *  - 聚能环覆盖弧/建材进度弧 = 贴地 RingGeometry（仅状态变化时重建）
 * 指针拾取由 Controller 用自身相机射线 ∩ y=0 平面完成（编辑器注入的 worldPos 是 z=0 平面）。
 * 仿真坐标（星图画布系 1920×1080，y 向下）保持不变，渲染层做 map→world 换算。
 */
import * as THREE from 'three'
import { ActorComponent, logger } from '@/engine'
import type { ThreeFactoryComponent } from '@/engine'
import type { Actor } from '@/engine'
import { B, MAP_H, MAP_W } from '../core/balance'
import { endpointPos, shipPos, starLoad, windowAffected } from '../core/helpers'
import type { Endpoint, SimState, SimStation, StarId } from '../core/types'

/** 拖线状态（GameMode 维护，渲染只读；坐标 = 星图画布系） */
export interface DragState {
  fromEp: Endpoint
  fromX: number
  fromY: number
  curX: number
  curY: number
  hoverEp: Endpoint | null
  valid: boolean
  /** 光标旁实时浮层（预计净补/载重） */
  label: string
}

export type MapSelection = { type: 'route' | 'station'; id: number } | null

export interface MapFx {
  pulses: Array<{ x: number; y: number; age: number }>
  floats: Array<{ text: string; x: number; y: number; age: number }>
}

/** GameMode 侧数据源（避免渲染组件反向依赖具体 GameMode 类） */
export interface MapViewProvider {
  simState: { state: SimState }
  drag: DragState | null
  selection: MapSelection
  fx: MapFx
}

/** 星球是否已解锁（对齐 TransportComponent.starUnlocked 语义） */
function starUnlocked(s: SimState, id: StarId): boolean {
  return s.act >= B.stars[id].unlockAct
}

// ─── 地图系 → 世界系（XZ 地面） ───

const toWX = (mx: number): number => mx - MAP_W / 2
const toWZ = (my: number): number => my - MAP_H / 2

// ─── 颜色 ───

const COLORS_ORANGE = 0xff6a3d
const C_ROUTE_FORWARD = 0x78beeb
const C_ROUTE_REVERSE = 0xffb03d
const C_ROUTE_SELECTED = 0xdff3ff
const C_SHIP_OUTBOUND = 0xff6a3d
const C_SHIP_RETURN = 0x96bed6
const C_SHIP_MATERIAL = 0xffb03d
const C_SHIP_MISSION = 0xffe9a8

// ─── 纹理工厂（一次性生成） ───

function configureTexture(tex: THREE.Texture): void {
  tex.generateMipmaps = false
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.colorSpace = THREE.SRGBColorSpace
}

function makeStarfieldTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = MAP_W
  c.height = MAP_H
  const g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, 0, MAP_H)
  grad.addColorStop(0, '#081420')
  grad.addColorStop(0.5, '#0e2a3a')
  grad.addColorStop(1, '#0a1c28')
  g.fillStyle = grad
  g.fillRect(0, 0, MAP_W, MAP_H)
  for (let i = 0; i < 340; i++) {
    const x = Math.random() * MAP_W
    const y = Math.random() * MAP_H
    const r = Math.random() * 1.4 + 0.3
    g.globalAlpha = Math.random() * 0.55 + 0.1
    g.fillStyle = Math.random() > 0.85 ? '#bfe9ff' : '#e8f4ff'
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
  }
  g.globalAlpha = 1
  const tex = new THREE.CanvasTexture(c)
  configureTexture(tex)
  return tex
}

function makeGlowTexture(): THREE.CanvasTexture {
  const size = 64
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.3, 'rgba(255,255,255,0.9)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.beginPath()
  g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
  g.fill()
  const tex = new THREE.CanvasTexture(c)
  configureTexture(tex)
  return tex
}

function makeDashTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 8
  const g = c.getContext('2d')!
  g.clearRect(0, 0, 64, 8)
  g.fillStyle = '#ffffff'
  g.fillRect(0, 1, 38, 6)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  configureTexture(tex)
  return tex
}

function makeNoiseTexture(): THREE.CanvasTexture {
  const size = 128
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const g = c.getContext('2d')!
  const img = g.createImageData(size, size)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255
    img.data[i] = v
    img.data[i + 1] = v
    img.data[i + 2] = v
    img.data[i + 3] = 255
  }
  g.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  configureTexture(tex)
  return tex
}

function makeVignetteTexture(): THREE.CanvasTexture {
  const w = 480
  const h = 270
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  const rg = g.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.78)
  rg.addColorStop(0, 'rgba(255,80,60,0)')
  rg.addColorStop(1, 'rgba(255,80,60,0.9)')
  g.fillStyle = rg
  g.fillRect(0, 0, w, h)
  const tex = new THREE.CanvasTexture(c)
  configureTexture(tex)
  return tex
}

// ─── 文字 Sprite（CanvasTexture，内容脏检查；对齐 hoi4 国名标注做法） ───

class SpriteLabel {
  readonly sprite: THREE.Sprite
  private mat: THREE.SpriteMaterial
  private tex: THREE.CanvasTexture | null = null
  private key = ''

  constructor(private factory: ThreeFactoryComponent, parent: THREE.Object3D, renderOrder = 60) {
    this.mat = factory.createSpriteMaterial({ transparent: true, depthWrite: false, depthTest: false })
    this.sprite = factory.createSprite(this.mat).object
    this.sprite.renderOrder = renderOrder
    this.sprite.visible = false
    parent.add(this.sprite)
  }

  set(text: string, px: number, color: string, bold = false): void {
    const key = `${text}|${px}|${color}|${bold}`
    if (key === this.key) return
    this.key = key
    this.tex?.dispose()
    if (!text) {
      this.sprite.visible = false
      return
    }
    const scale = 2 // 超采样
    const c = document.createElement('canvas')
    const g = c.getContext('2d')!
    const font = `${bold ? 'bold ' : ''}${px * scale}px "Microsoft YaHei", sans-serif`
    g.font = font
    const w = Math.ceil(g.measureText(text).width) + 16
    const h = Math.ceil(px * scale * 1.4)
    c.width = w
    c.height = h
    g.font = font
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillStyle = color
    g.fillText(text, w / 2, h / 2)
    this.tex = new THREE.CanvasTexture(c)
    configureTexture(this.tex)
    this.mat.map = this.tex
    this.mat.needsUpdate = true
    this.sprite.scale.set(w * 0.5, h * 0.5, 1)
    this.sprite.visible = true
  }

  clear(): void {
    this.set('', 12, '#fff')
  }

  setPos(mx: number, my: number, y: number): void {
    this.sprite.position.set(toWX(mx), y, toWZ(my))
  }

  dispose(): void {
    this.tex?.dispose()
    this.mat.dispose()
  }
}

// ─── 补给站视图 ───

interface StationView {
  group: THREE.Group
  shield: THREE.Mesh
  equator: THREE.Mesh
  core: THREE.Mesh
  siteLine: THREE.LineLoop
  progressRing: THREE.Mesh | null
  title: SpriteLabel
  sub: SpriteLabel
  lastStockKey: string
  lastLevel: number
}

export class StarMapRenderComponent extends ActorComponent<Actor> {
  private provider: MapViewProvider
  private root3!: THREE.Group
  private tex: Record<string, THREE.Texture> = {}
  private mats: THREE.Material[] = []
  private geos: THREE.BufferGeometry[] = []

  /** 贴地 quad（预压平：local X=长度，local Z=宽度） */
  private flatQuadGeo!: THREE.PlaneGeometry
  /** 贴地环（预压平） */
  private flatRingGeo!: THREE.RingGeometry
  /** 单位球（缩放复用） */
  private unitSphere!: THREE.SphereGeometry

  private routeQuads = new Map<string, { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; dashTex?: THREE.Texture }>()
  private routeSig = ''

  private shipPool: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; glow: THREE.Sprite; glowMat: THREE.SpriteMaterial }> = []
  private readonly SHIP_CAP = 64

  private earthArc: THREE.Mesh | null = null
  private lastArcKey = ''
  private starViews: Partial<Record<string, { body: THREE.Mesh; mat: THREE.MeshLambertMaterial; name: SpriteLabel; sub: SpriteLabel; windowRing: THREE.Mesh }>> = {}
  private stationViews = new Map<number, StationView>()

  private tutGroup!: THREE.Group
  private tutRings: THREE.Mesh[] = []
  private tutArrows: THREE.Mesh[] = []

  private dragQuad!: THREE.Mesh
  private dragMat!: THREE.MeshBasicMaterial
  private dragRing!: THREE.Mesh
  private dragLabel!: SpriteLabel

  private pulsePool: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; busy: boolean }> = []
  private floatPool: Array<{ label: SpriteLabel; busy: boolean }> = []

  private flareGroup!: THREE.Group
  private flareNoiseMat!: THREE.MeshBasicMaterial
  private flareVigMat!: THREE.MeshBasicMaterial
  private missionLine!: THREE.Line

  private animTime = 0

  private factory: ThreeFactoryComponent | null = null

  /** BeginPlay 后访问（非空断言：所有构建路径都在工厂就绪后执行） */
  private get F(): ThreeFactoryComponent {
    if (!this.factory) throw new Error('[StarMap] 工厂未就绪（BeginPlay 前调用？）')
    return this.factory
  }

  constructor(owner: Actor, provider: MapViewProvider) {
    super(owner)
    this.name = 'StarMapRenderComponent'
    this.provider = provider
  }

  private trackMat<T extends THREE.Material>(m: T): T { this.mats.push(m); return m }
  private trackGeo<T extends THREE.BufferGeometry>(g: T): T { this.geos.push(g); return g }

  override BeginPlay(): void {
    this.factory = this.owner.world?.factory ?? null
    if (!this.factory) {
      logger.error('[StarMap] World 工厂不可用，星图将无法创建渲染对象')
      return
    }
    this.root3 = this.F.createGroup().object
    this.tutGroup = this.F.createGroup().object
    this.flareGroup = this.F.createGroup().object
    this.flatQuadGeo = this.F.createPlaneGeometry(1, 1)
    this.flatQuadGeo.rotateX(-Math.PI / 2)
    this.flatRingGeo = this.F.createRingGeometry(0.92, 1, 96)
    this.flatRingGeo.rotateX(-Math.PI / 2)
    this.unitSphere = this.F.createSphereGeometry(1, 28, 20)

    // ─── 灯光（3D 标准：球体材质需要光照） ───
    this.root3.add(new THREE.AmbientLight(0xcfe3ee, 0.85))
    const dir = new THREE.DirectionalLight(0xfff0dd, 1.15)
    dir.position.set(300, 800, 200)
    this.root3.add(dir)

    // ─── 地面（星空背景，只画一次传一次） ───
    const groundGeo = this.trackGeo(this.F.createPlaneGeometry(MAP_W, MAP_H))
    groundGeo.rotateX(-Math.PI / 2)
    const groundMat = this.trackMat(this.F.createMeshBasicMaterial({ map: makeStarfieldTexture(), depthWrite: false }))
    const ground = this.F.createMesh(groundGeo, groundMat).object
    ground.position.y = -0.5
    ground.renderOrder = 0
    this.root3.add(ground)

    this.tex.glow = makeGlowTexture()
    this.tex.dash = makeDashTexture()
    this.tex.noise = makeNoiseTexture()
    this.tex.vignette = makeVignetteTexture()

    this.buildShips()
    this.buildNodes()
    this.buildTutorial()
    this.buildDrag()
    this.buildFxPools()
    this.buildFlare()
    this.buildMissionLine()

    this.owner.root.add(this.root3)
    logger.info('[WarmCurrent] 星图渲染就绪（3D：XZ 地面 + 球体 + 俯视透视）')
  }

  override EndPlay(): void {
    this.owner.root.remove(this.root3)
    for (const m of this.mats) m.dispose()
    for (const g of this.geos) g.dispose()
    for (const t of Object.values(this.tex)) t?.dispose()
    for (const sv of this.stationViews.values()) this.disposeStation(sv)
    this.stationViews.clear()
    this.unitSphere.dispose()
    this.flatQuadGeo.dispose()
    this.flatRingGeo.dispose()
  }

  // ─── 飞船池 ───

  private buildShips(): void {
    const geo = this.trackGeo(this.F.createSphereGeometry(4.5, 12, 10))
    for (let i = 0; i < this.SHIP_CAP; i++) {
      const mat = this.trackMat(this.F.createMeshBasicMaterial({ color: C_SHIP_OUTBOUND }))
      const mesh = this.F.createMesh(geo, mat).object
      mesh.position.y = 9
      mesh.renderOrder = 14
      mesh.visible = false
      const glowMat = this.trackMat(this.F.createSpriteMaterial({
        map: this.tex.glow, color: C_SHIP_OUTBOUND, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }))
      const glow = this.F.createSprite(glowMat).object
      glow.scale.set(30, 30, 1)
      mesh.add(glow)
      this.shipPool.push({ mesh, mat, glow, glowMat })
      this.root3.add(mesh)
    }
  }

  // ─── 节点 ───

  private buildNodes(): void {
    // 地球球体（半嵌入地面，顶部露出）
    const earthMat = this.trackMat(this.F.createMeshLambertMaterial({ color: 0x3f83a8 }))
    const earth = this.F.createMesh(this.unitSphere, earthMat).object
    earth.scale.setScalar(B.map.nodes.earth.r)
    earth.position.set(toWX(B.map.nodes.earth.x), B.map.nodes.earth.r * 0.55, toWZ(B.map.nodes.earth.y))
    earth.renderOrder = 12
    this.root3.add(earth)
    // 聚能环覆盖轨道
    const trackMat = this.trackMat(this.F.createMeshBasicMaterial({ color: 0x7896af, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }))
    const track = this.F.createMesh(this.flatRingGeo, trackMat).object
    track.position.set(toWX(B.map.nodes.earth.x), 3, toWZ(B.map.nodes.earth.y))
    track.scale.setScalar(70)
    track.renderOrder = 11
    this.root3.add(track)
    // 地球标签
    const earthLabel = new SpriteLabel(this.F, this.root3)
    earthLabel.set('地球', 22, '#cfe8f5')
    earthLabel.setPos(B.map.nodes.earth.x, B.map.nodes.earth.y + B.map.nodes.earth.r + 28, 96)

    for (const star of Object.values(B.stars)) {
      const pos = B.map.nodes[star.id]
      const color = star.id === 'moon' ? 0xc9d4de : star.id === 'europa' ? 0x8fd0f0 : 0xe8926f
      const mat = this.trackMat(this.F.createMeshLambertMaterial({ color, transparent: true, opacity: 1 }))
      const body = this.F.createMesh(this.unitSphere, mat).object
      body.scale.setScalar(B.map.nodes[star.id].r)
      body.position.set(toWX(pos.x), B.map.nodes[star.id].r * 0.55, toWZ(pos.y))
      body.renderOrder = 12
      this.root3.add(body)
      const name = new SpriteLabel(this.F, this.root3)
      name.set(star.name, 22, '#dff0fa')
      name.setPos(pos.x, pos.y - B.map.nodes[star.id].r - 34, 96)
      const sub = new SpriteLabel(this.F, this.root3)
      const ringMat = this.trackMat(this.F.createMeshBasicMaterial({ color: 0xffb03d, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }))
      const windowRing = this.F.createMesh(this.flatRingGeo, ringMat).object
      windowRing.position.set(toWX(pos.x), 4, toWZ(pos.y))
      windowRing.scale.setScalar(B.map.nodes[star.id].r + 12)
      windowRing.renderOrder = 11
      windowRing.visible = false
      this.root3.add(windowRing)
      this.starViews[star.id] = { body, mat, name, sub, windowRing }
    }
  }

  // ─── 航线 ───

  private makeRouteQuad(): { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial } {
    const mat = this.trackMat(this.F.createMeshBasicMaterial({ transparent: true, depthWrite: false }))
    const mesh = this.F.createMesh(this.flatQuadGeo, mat).object
    mesh.position.y = 1.5
    mesh.renderOrder = 10
    this.root3.add(mesh)
    return { mesh, mat }
  }

  private syncRoutes(): void {
    const { simState: sim, selection } = this.provider
    const sig = sim.state.routes.map((r) => `${r.id}:${Math.max(1, r.shipIds.length)}:${r.direction}`).join('|')
    if (sig !== this.routeSig) {
      this.routeSig = sig
      for (const q of this.routeQuads.values()) {
        this.root3.remove(q.mesh)
        q.mat.dispose()
        q.dashTex?.dispose()
      }
      this.routeQuads.clear()
      for (const route of sim.state.routes) {
        const lanes = Math.max(1, route.shipIds.length)
        for (let i = 0; i < lanes; i++) {
          this.routeQuads.set(`${route.id}:${i}`, this.makeRouteQuad())
        }
      }
    }
    const windowActive = sim.state.gravity.phase === 'active'
    for (const route of sim.state.routes) {
      const from = endpointPos(sim.state, route.from)
      const to = endpointPos(sim.state, route.to)
      const selected = selection?.type === 'route' && selection.id === route.id
      const windowed = windowActive && windowAffected(sim.state, route)
      const dx = to.x - from.x
      const dy = to.y - from.y
      const len = Math.hypot(dx, dy)
      // 贴地 quad 的长度轴 = local X；rotation.y = atan2(-dz, dx)
      const angleY = Math.atan2(-(toWZ(to.y) - toWZ(from.y)), toWX(to.x) - toWX(from.x))
      const nlen = len || 1
      const nx = -dy / nlen
      const ny = dx / nlen
      const lanes = Math.max(1, route.shipIds.length)
      for (let i = 0; i < lanes; i++) {
        const q = this.routeQuads.get(`${route.id}:${i}`)
        if (!q) continue
        const off = (i - (lanes - 1) / 2) * 8
        q.mesh.position.set(toWX((from.x + to.x) / 2 + nx * off), 1.5, toWZ((from.y + to.y) / 2 + ny * off))
        q.mesh.rotation.y = angleY
        q.mesh.scale.set(len, 1, selected ? 5 : windowed ? 4 : 2.5)
        const wantDash = !selected && !windowed && route.direction === 'reverse'
        if (wantDash && !q.dashTex) {
          const tex = this.tex.dash.clone()
          tex.needsUpdate = true
          tex.repeat.set(Math.max(1, len / 26), 1)
          q.dashTex = tex
        }
        const wantMap = wantDash ? q.dashTex! : null
        if (q.mat.map !== wantMap) {
          q.mat.map = wantMap
          q.mat.needsUpdate = true
        }
        if (selected) {
          q.mat.color.setHex(C_ROUTE_SELECTED)
          q.mat.opacity = 0.95
        } else if (windowed) {
          q.mat.color.setHex(C_ROUTE_REVERSE)
          q.mat.opacity = 0.9
        } else {
          q.mat.color.setHex(route.direction === 'reverse' ? C_ROUTE_REVERSE : C_ROUTE_FORWARD)
          q.mat.opacity = 0.55
        }
      }
    }
  }

  // ─── 飞船 ───

  private syncShips(): void {
    const { simState: sim } = this.provider
    const flareActive = sim.state.flare.phase === 'active'
    let n = 0
    const place = (mx: number, my: number, color: number, glowScale: number) => {
      if (n >= this.SHIP_CAP) return
      const slot = this.shipPool[n++]
      slot.mesh.visible = true
      slot.mesh.position.set(toWX(mx), 9, toWZ(my))
      slot.mat.color.setHex(color)
      slot.glowMat.color.setHex(color)
      slot.glow.scale.setScalar(glowScale)
    }
    for (const route of sim.state.routes) {
      const from = endpointPos(sim.state, route.from)
      const to = endpointPos(sim.state, route.to)
      const nlen = Math.hypot(to.x - from.x, to.y - from.y) || 1
      const nx = -(to.y - from.y) / nlen
      const ny = (to.x - from.x) / nlen
      const lanes = Math.max(1, route.shipIds.length)
      route.shipIds.forEach((shipId, lane) => {
        const ship = sim.state.ships.find((s) => s.id === shipId)
        if (!ship || ship.state === 'frozen') return
        const pos = shipPos(sim.state, ship)
        const off = (lane - (lanes - 1) / 2) * 8
        let color = C_SHIP_OUTBOUND
        if (ship.state === 'flying' && ship.leg === 'return') color = C_SHIP_RETURN
        else if (ship.materials > 0) color = C_SHIP_MATERIAL
        place(pos.x + nx * off, pos.y + ny * off, color, flareActive ? 24 + Math.random() * 10 : 30)
      })
    }
    if (sim.state.module.state === 'mission') {
      const ship = sim.state.ships.find((s) => s.id === sim.state.module.shipId)
      if (ship && ship.state !== 'frozen') {
        const pos = shipPos(sim.state, ship)
        place(pos.x, pos.y, C_SHIP_MISSION, 40)
      }
    }
    for (let i = n; i < this.SHIP_CAP; i++) this.shipPool[i].mesh.visible = false
  }

  // ─── 节点同步 ───

  private syncNodes(): void {
    const { simState: sim } = this.provider
    // 覆盖弧（节点/环状态变化才重建）
    const arcKey = `${sim.state.nodes}`
    if (arcKey !== this.lastArcKey) {
      this.lastArcKey = arcKey
      if (this.earthArc) {
        this.root3.remove(this.earthArc)
        this.earthArc.geometry.dispose()
        ;(this.earthArc.material as THREE.Material).dispose()
      }
      const coverage = sim.state.nodes / 12
      const arcGeo = this.F.createRingGeometry(66, 73, 96, 1, -Math.PI / 2, coverage * Math.PI * 2)
      arcGeo.rotateX(-Math.PI / 2)
      const arcMat = this.F.createMeshBasicMaterial({ color: COLORS_ORANGE, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false })
      this.earthArc = this.F.createMesh(arcGeo, arcMat).object
      this.earthArc.position.set(toWX(B.map.nodes.earth.x), 3.5, toWZ(B.map.nodes.earth.y))
      this.earthArc.renderOrder = 11
      this.root3.add(this.earthArc)
    }
    if (this.earthArc) {
      const pulse = sim.state.ring === 'decaying' ? 0.5 + 0.5 * Math.sin(this.animTime * 6) : 0
      ;(this.earthArc.material as THREE.MeshBasicMaterial).color.setHex(
        sim.state.ring === 'decaying' ? (pulse > 0.5 ? 0xe84545 : 0xbfe9ff) : COLORS_ORANGE)
    }
    // 星球状态
    for (const star of Object.values(B.stars)) {
      const view = this.starViews[star.id]!
      const unlocked = starUnlocked(sim.state, star.id)
      view.mat.opacity = unlocked ? 1 : 0.25
      const pos = B.map.nodes[star.id]
      view.name.set(star.name, 22, unlocked ? '#dff0fa' : '#5a707f')
      view.name.setPos(pos.x, pos.y - B.map.nodes[star.id].r - 34, 96)
      const sub = unlocked ? `满载 ${Math.round(starLoad(sim.state.mods, star.id))}/船` : `第${star.unlockAct}幕解锁`
      view.sub.set(sub, 16, unlocked ? '#8fb2c6' : '#48606f')
      view.sub.setPos(pos.x, pos.y + B.map.nodes[star.id].r + 30, 82)
      if (star.id === 'europa' && sim.state.gravity.phase !== 'idle') {
        const active = sim.state.gravity.phase === 'active'
        view.windowRing.visible = true
        const s = (B.map.nodes[star.id].r + 12) * (1 + Math.sin(this.animTime * 5) * 0.05)
        view.windowRing.scale.setScalar(s)
        ;(view.windowRing.material as THREE.MeshBasicMaterial).color.setHex(active ? 0xffb03d : 0x8a6a3a)
        ;(view.windowRing.material as THREE.MeshBasicMaterial).opacity = active ? 0.8 : 0.45
      } else {
        view.windowRing.visible = false
      }
    }
  }

  // ─── 补给站 ───

  private buildStationView(st: SimStation): StationView {
    const group = this.F.createGroup().object
    const shieldMat = this.trackMat(this.F.createMeshBasicMaterial({ color: 0x5ac8ff, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }))
    const shield = this.F.createMesh(this.unitSphere, shieldMat).object
    shield.position.y = 2
    shield.renderOrder = 9
    const equatorMat = this.trackMat(this.F.createMeshBasicMaterial({ color: 0x5ac8ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }))
    const equator = this.F.createMesh(this.flatRingGeo, equatorMat).object
    equator.position.y = 2
    equator.renderOrder = 9
    const coreMat = this.trackMat(this.F.createMeshBasicMaterial({ color: 0x9fdcff }))
    const core = this.F.createMesh(this.unitSphere, coreMat).object
    core.scale.setScalar(10)
    core.position.y = 10
    core.renderOrder = 12
    // 站点虚线圈
    const pts: THREE.Vector3[] = []
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2
      pts.push(new THREE.Vector3(Math.cos(a) * 22, 0, Math.sin(a) * 22))
    }
    const siteGeo = this.trackGeo(this.F.createBufferGeometry().setFromPoints(pts))
    const siteMat = this.trackMat(this.F.createLineDashedMaterial({ color: 0xffb03d, transparent: true, opacity: 0.8, dashSize: 6, gapSize: 6, depthWrite: false }))
    const siteLine = new THREE.LineLoop(siteGeo, siteMat)
    siteLine.computeLineDistances()
    siteLine.renderOrder = 9
    group.add(shield, equator, core, siteLine)
    const title = new SpriteLabel(this.F, group)
    const sub = new SpriteLabel(this.F, group)
    group.position.set(toWX(st.x), 0, toWZ(st.y))
    this.root3.add(group)
    return { group, shield, equator, core, siteLine, progressRing: null, title, sub, lastStockKey: '', lastLevel: -1 }
  }

  private disposeStation(v: StationView): void {
    v.title.dispose()
    v.sub.dispose()
    if (v.progressRing) {
      v.progressRing.geometry.dispose()
      ;(v.progressRing.material as THREE.Material).dispose()
    }
  }

  private syncStations(): void {
    const { simState: sim, selection } = this.provider
    for (const [id, view] of this.stationViews) {
      if (!sim.state.stations.find((st) => st.id === id)) {
        this.root3.remove(view.group)
        this.disposeStation(view)
        this.stationViews.delete(id)
      }
    }
    for (const st of sim.state.stations) {
      let view = this.stationViews.get(st.id)
      if (!view) {
        view = this.buildStationView(st)
        this.stationViews.set(st.id, view)
      }
      const selected = selection?.type === 'station' && selection.id === st.id
      const built = st.level >= 1
      view.siteLine.visible = !built
      view.shield.visible = built
      view.equator.visible = built
      view.core.visible = built
      if (built) {
        const r = B.station.radius[st.level]
        view.shield.scale.setScalar(r)
        view.equator.scale.setScalar(r)
        ;(view.equator.material as THREE.MeshBasicMaterial).opacity = selected ? 0.7 : 0.35
        ;(view.shield.material as THREE.MeshBasicMaterial).opacity = selected ? 0.12 : 0.07
      }
      view.group.position.set(toWX(st.x), 0, toWZ(st.y))
      if (built) {
        view.title.set(`补给站 Lv${st.level}`, 18, '#9fdcff')
        view.title.setPos(st.x, st.y, B.station.radius[st.level] * 0.5 + 30)
        const sub = st.level < 3 && st.need > 0 ? `升级建材 ${Math.floor(st.stock)}/${st.need}` : '护盾在线'
        view.sub.set(sub, 15, '#7fa8bc')
        view.sub.setPos(st.x, st.y, 40)
      } else {
        view.title.set(`站点 ${Math.floor(st.stock)}/${st.need}`, 16, '#ffb03d')
        view.title.setPos(st.x, st.y, 56)
        view.sub.clear()
      }
      // 进度弧（到货才重建）
      const nextNeed = st.level === 0 ? st.need : st.level < 3 ? st.need : 0
      const key = `${Math.floor(st.stock)}|${st.level}|${nextNeed}`
      if (key !== view.lastStockKey) {
        view.lastStockKey = key
        if (view.progressRing) {
          view.group.remove(view.progressRing)
          view.progressRing.geometry.dispose()
          ;(view.progressRing.material as THREE.Material).dispose()
          view.progressRing = null
        }
        if (nextNeed > 0 && st.stock > 0) {
          const frac = Math.min(1, st.stock / nextNeed)
          const r = built ? 26 : 34
          const geo = this.F.createRingGeometry(r - 3.5, r, 64, 1, -Math.PI / 2, frac * Math.PI * 2)
          geo.rotateX(-Math.PI / 2)
          const mat = this.F.createMeshBasicMaterial({ color: 0xffb03d, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false })
          const ring = this.F.createMesh(geo, mat).object
          ring.position.y = 4
          ring.renderOrder = 10
          view.progressRing = ring
          view.group.add(ring)
        }
      }
    }
  }

  // ─── 引导 ───

  private buildTutorial(): void {
    for (const p of [B.map.nodes.moon, B.map.nodes.earth]) {
      const mat = this.trackMat(this.F.createMeshBasicMaterial({ color: 0xff6a3d, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }))
      const ring = this.F.createMesh(this.flatRingGeo, mat).object
      ring.position.set(toWX(p.x), 6, toWZ(p.y))
      ring.renderOrder = 20
      this.tutRings.push(ring)
      this.tutGroup.add(ring)
    }
    const tri = this.F.createBufferGeometry()
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      14, 0, 0, -9, 0, 10, -9, 0, -10,
    ]), 3))
    tri.computeVertexNormals()
    this.trackGeo(tri)
    for (let i = 0; i < 3; i++) {
      const mat = this.trackMat(this.F.createMeshBasicMaterial({ color: 0xff6a3d, transparent: true, side: THREE.DoubleSide, depthWrite: false }))
      const arrow = this.F.createMesh(tri, mat).object
      arrow.position.y = 8
      arrow.renderOrder = 21
      this.tutArrows.push(arrow)
      this.tutGroup.add(arrow)
    }
    this.root3.add(this.tutGroup)
  }

  private syncTutorial(): void {
    const on = this.provider.simState.state.tutorial
    this.tutGroup.visible = on
    if (!on) return
    const t = this.animTime
    const pulse = 1 + Math.sin(t * 4) * 0.12
    this.tutRings[0].position.set(toWX(B.map.nodes.moon.x), 6, toWZ(B.map.nodes.moon.y))
    this.tutRings[0].scale.setScalar((B.map.nodes.moon.r + 12) * pulse)
    this.tutRings[1].position.set(toWX(B.map.nodes.earth.x), 6, toWZ(B.map.nodes.earth.y))
    this.tutRings[1].scale.setScalar((B.map.nodes.earth.r + 12) * pulse)
    const from = B.map.nodes.moon
    const to = B.map.nodes.earth
    const angleY = Math.atan2(-(toWZ(to.y) - toWZ(from.y)), toWX(to.x) - toWX(from.x))
    const dx = to.x - from.x
    const dy = to.y - from.y
    for (let i = 0; i < 3; i++) {
      const tt = ((t * 0.35 + i / 3) % 1)
      const arrow = this.tutArrows[i]
      arrow.position.set(toWX(from.x + dx * tt), 8, toWZ(from.y + dy * tt))
      arrow.rotation.y = angleY
      ;(arrow.material as THREE.MeshBasicMaterial).opacity = Math.sin(tt * Math.PI) * 0.9
    }
  }

  // ─── 任务线 ───

  private buildMissionLine(): void {
    const geo = this.trackGeo(this.F.createBufferGeometry().setFromPoints([
      new THREE.Vector3(toWX(B.map.nodes.earth.x), 1.8, toWZ(B.map.nodes.earth.y)),
      new THREE.Vector3(toWX(B.map.nodes.mars.x), 1.8, toWZ(B.map.nodes.mars.y)),
    ]))
    const mat = this.trackMat(this.F.createLineDashedMaterial({ color: 0xffdc8c, transparent: true, opacity: 0.45, dashSize: 8, gapSize: 12, depthWrite: false }))
    this.missionLine = this.F.createPolyline(geo, mat).object
    this.missionLine.computeLineDistances()
    this.missionLine.renderOrder = 8
    this.missionLine.visible = false
    this.root3.add(this.missionLine)
  }

  private syncMissionLine(): void {
    this.missionLine.visible = this.provider.simState.state.module.state === 'mission'
  }

  // ─── 拖线 ───

  private buildDrag(): void {
    this.dragMat = this.trackMat(this.F.createMeshBasicMaterial({ color: 0x96a5b4, transparent: true, opacity: 0.7, depthWrite: false }))
    this.dragQuad = this.F.createMesh(this.flatQuadGeo, this.dragMat).object
    this.dragQuad.position.y = 18
    this.dragQuad.renderOrder = 24
    this.dragQuad.visible = false
    this.root3.add(this.dragQuad)
    this.dragRing = this.F.createMesh(
      this.flatRingGeo,
      this.trackMat(this.F.createMeshBasicMaterial({ color: 0x96a5b4, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })),
    ).object
    this.dragRing.position.y = 17
    this.dragRing.renderOrder = 25
    this.dragRing.visible = false
    this.root3.add(this.dragRing)
    this.dragLabel = new SpriteLabel(this.F, this.root3, 65)
  }

  private syncDrag(): void {
    const { drag, simState: sim } = this.provider
    if (!drag) {
      this.dragQuad.visible = false
      this.dragRing.visible = false
      this.dragLabel.clear()
      return
    }
    const hoverPos = drag.hoverEp ? endpointPos(sim.state, drag.hoverEp) : null
    let colorHex = 0x96a5b4
    let opacity = 0.7
    if (!drag.valid && drag.hoverEp) { colorHex = 0xe84545; opacity = 0.9 }
    else if (drag.hoverEp) {
      colorHex = drag.hoverEp.kind === 'earth' ? 0x43d17c
        : drag.hoverEp.kind === 'station' ? 0x57c4f0
          : 0x3fa9f5
      opacity = 0.95
    }
    this.dragQuad.visible = true
    const jx = drag.valid ? 0 : (Math.random() - 0.5) * 3
    const jz = drag.valid ? 0 : (Math.random() - 0.5) * 3
    const mx = (drag.fromX + drag.curX) / 2 + jx
    const my = (drag.fromY + drag.curY) / 2 + jz
    const len = Math.hypot(drag.curX - drag.fromX, drag.curY - drag.fromY)
    this.dragQuad.position.set(toWX(mx), 18, toWZ(my))
    this.dragQuad.rotation.y = Math.atan2(-(toWZ(drag.curY) - toWZ(drag.fromY)), toWX(drag.curX) - toWX(drag.fromX))
    this.dragQuad.scale.set(Math.max(0.001, len), 1, drag.valid && drag.hoverEp ? 4 : 3)
    this.dragMat.color.setHex(colorHex)
    this.dragMat.opacity = opacity
    if (hoverPos) {
      this.dragRing.visible = true
      this.dragRing.position.set(toWX(hoverPos.x), 17, toWZ(hoverPos.y))
      this.dragRing.scale.setScalar(36 + Math.sin(this.animTime * 8) * 4)
      ;(this.dragRing.material as THREE.MeshBasicMaterial).color.setHex(colorHex)
    } else {
      this.dragRing.visible = false
    }
    if (drag.label) {
      this.dragLabel.set(drag.label, 17, '#dff0fa')
      this.dragLabel.setPos(Math.min(MAP_W - 160, drag.curX + 120), Math.max(40, drag.curY + 10), 110)
    } else {
      this.dragLabel.clear()
    }
  }

  // ─── 特效 ───

  private buildFxPools(): void {
    for (let i = 0; i < 6; i++) {
      const mat = this.trackMat(this.F.createMeshBasicMaterial({ color: 0xff8c50, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }))
      const mesh = this.F.createMesh(this.flatRingGeo, mat).object
      mesh.position.y = 12
      mesh.renderOrder = 26
      mesh.visible = false
      this.pulsePool.push({ mesh, mat, busy: false })
      this.root3.add(mesh)
    }
    for (let i = 0; i < 8; i++) {
      this.floatPool.push({ label: new SpriteLabel(this.F, this.root3, 62), busy: false })
    }
  }

  private syncFx(): void {
    const { fx } = this.provider
    for (const p of this.pulsePool) p.busy = false
    for (const pulse of fx.pulses) {
      const slot = this.pulsePool.find((s) => !s.busy)
      if (!slot) break
      slot.busy = true
      const a = Math.max(0, 0.8 - pulse.age / 0.6)
      slot.mesh.visible = a > 0
      if (a > 0) {
        slot.mesh.position.set(toWX(pulse.x), 12, toWZ(pulse.y))
        slot.mesh.scale.setScalar(18 + pulse.age * 160)
        slot.mat.opacity = a
      }
    }
    for (const p of this.pulsePool) if (!p.busy) p.mesh.visible = false

    for (const f of this.floatPool) f.busy = false
    let idx = 0
    for (const flt of fx.floats) {
      if (!flt.text) continue
      const slot = this.floatPool.find((s) => !s.busy)
      if (!slot) break
      slot.busy = true
      const a = Math.max(0, 1 - flt.age / 1.4)
      slot.label.set(flt.text, 22, '#ffb03d', true)
      slot.label.sprite.visible = a > 0
      slot.label.sprite.material.opacity = a
      slot.label.setPos(flt.x, flt.y, 24 + idx * 4 - flt.age * 26)
      idx++
    }
    for (const f of this.floatPool) if (!f.busy) f.label.sprite.visible = false
  }

  // ─── 耀斑 ───

  private buildFlare(): void {
    const noiseGeo = this.trackGeo(this.F.createPlaneGeometry(MAP_W + 500, MAP_H + 400))
    noiseGeo.rotateX(-Math.PI / 2)
    this.flareNoiseMat = this.trackMat(this.F.createMeshBasicMaterial({ map: this.tex.noise, transparent: true, opacity: 0, depthWrite: false }))
    this.tex.noise.repeat.set(10, 6)
    const noise = this.F.createMesh(noiseGeo, this.flareNoiseMat).object
    noise.position.y = 420
    noise.renderOrder = 70
    this.flareGroup.add(noise)
    this.flareVigMat = this.trackMat(this.F.createMeshBasicMaterial({ map: this.tex.vignette, transparent: true, opacity: 0, depthWrite: false }))
    const vig = this.F.createMesh(noiseGeo, this.flareVigMat).object
    vig.position.y = 430
    vig.renderOrder = 71
    this.flareGroup.add(vig)
    this.flareGroup.visible = false
    this.root3.add(this.flareGroup)
  }

  private syncFlare(): void {
    const active = this.provider.simState.state.flare.phase === 'active'
    this.flareGroup.visible = active
    if (!active) return
    this.tex.noise.offset.set(Math.random(), Math.random())
    this.flareNoiseMat.opacity = 0.05 + Math.random() * 0.05
    this.flareVigMat.opacity = 0.12 + Math.random() * 0.06
  }

  /** 每帧同步（GameMode.Tick 驱动；dt = 真实时间） */
  render(dt: number): void {
    this.animTime += dt
    this.syncRoutes()
    this.syncShips()
    this.syncNodes()
    this.syncStations()
    this.syncTutorial()
    this.syncMissionLine()
    this.syncDrag()
    this.syncFx()
    this.syncFlare()
  }
}

