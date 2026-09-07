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
import { B, MAP_H, MAP_W, toWX, toWZ } from '../core/balance'
import {
  makeStarfieldTileTexture,
  GROUND_W,
  GROUND_H,
  TILE_SIZE,
  STARFIELD_TILE_SEED,
} from './starfieldTile'
import { SphereMeshComponent } from '@/engine'
import {
  endpointPos,
  orbitRadiusPx,
  shipPos,
  starLoad,
  starPosAt,
  stationAnchorPos,
  windowAffected,
  TUTORIAL_TARGETS,
  TUTORIAL_RING_PAD,
} from '../core/helpers'
import type { Endpoint, PlanetId, SimState, SimStation, StarId } from '../core/types'

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
  /** 天体蓝图 Actor（id → 实例；星球 mesh 的属主，渲染组件只读消费 mesh 引用） */
  readonly starActors: Map<string, import('@/engine').Actor>
  simState: { state: SimState }
  drag: DragState | null
  selection: MapSelection
  fx: MapFx
}

/** 星球是否已解锁（对齐 TransportComponent.starUnlocked 语义） */
function starUnlocked(s: SimState, id: StarId): boolean {
  return s.act >= B.stars[id].unlockAct
}

// ─── 地图系 → 世界系（XZ 地面；toWX/toWZ 从 core/balance 导入，相机/GM 共用） ───

// ─── 颜色 ───

const COLORS_ORANGE = 0xff6a3d
const C_ROUTE_FORWARD = 0x78beeb
const C_ROUTE_REVERSE = 0xffb03d
const C_ROUTE_SELECTED = 0xdff3ff
const C_SHIP_OUTBOUND = 0xff6a3d
const C_SHIP_RETURN = 0x96bed6
const C_SHIP_MATERIAL = 0xffb03d
const C_SHIP_MISSION = 0xffe9a8

// ─── 视图分组（星图切换：地球系 / 太阳系；ViewToggle → GameMode.setViewMode → applyViewMode） ───

/** 地球系视图常显天体（星球 mesh 属蓝图 Actor 不在渲染组内，切换走 visible；其余天体表现归 systemGroup） */
const EARTH_VIEW_BODIES = new Set<string>(['earth', 'moon'])
/** 地球系视图特效可见半径（px，距地球）：覆盖地月航线/月球站锚（≤240），排除木卫二/火星站锚 */
const EARTH_VIEW_RADIUS_PX = 260

// ─── 纹理工厂（一次性生成） ───

function configureTexture(tex: THREE.Texture): void {
  tex.generateMipmaps = false
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.colorSpace = THREE.SRGBColorSpace
}

/**
 * 星空背景：可无缝平铺的小 tile（512²）+ RepeatWrapping 重复拼接出超大地面
 * （GROUND_W×GROUND_H = 19456×18432，海王星轨道 7517px 也被星空覆盖）。星点尺度与旧版全图 canvas 一致。
 * 无 canvas 环境（单测）返回 null → 地面退化为纯色。
 */
function makeStarfieldTexture(): THREE.CanvasTexture | null {
  const tex = makeStarfieldTileTexture({ seed: STARFIELD_TILE_SEED })
  if (!tex) return null
  tex.repeat.set(GROUND_W / TILE_SIZE, GROUND_H / TILE_SIZE)
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
  /** 太阳系视图组：太阳系专属表现（其它行星轨道圈/光晕/窗口环/木卫二卫星环），地球系视图整组隐藏 */
  private sunGroup!: THREE.Group
  /** 通用组：地月共有的表现（航线/船/站点/引导/拖线/特效），不参与视图切换 */
  private systemGroup!: THREE.Group
  /** 当前星图视图模式（GameMode.setViewMode → applyViewMode 传导） */
  private viewMode: 'earth' | 'solar' = 'earth'
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
  /** 细轨道圈几何（1.5% 环宽，公转轨道专用；flatRingGeo 太粗） */
  private flatOrbitGeo!: THREE.RingGeometry
  /** 卫星环（月球绕地轨道圈，圆心每帧贴地球实时位置） */
  private moonOrbitRing: THREE.Mesh | null = null
  private starViews: Partial<Record<string, { body: THREE.Mesh; mat: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial; name: SpriteLabel; sub: SpriteLabel; windowRing: THREE.Mesh; radius: number }>> = {}
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
    this.sunGroup = this.F.createGroup().object
    this.systemGroup = this.F.createGroup().object
    this.root3.add(this.sunGroup, this.systemGroup)
    this.flatQuadGeo = this.F.createPlaneGeometry(1, 1)
    this.flatQuadGeo.rotateX(-Math.PI / 2)
    this.flatRingGeo = this.F.createRingGeometry(0.92, 1, 96)
    this.flatRingGeo.rotateX(-Math.PI / 2)
    this.flatOrbitGeo = this.F.createRingGeometry(0.985, 1, 128)
    this.flatOrbitGeo.rotateX(-Math.PI / 2)
    this.unitSphere = this.F.createSphereGeometry(1, 28, 20)

    // ─── 灯光（3D 标准：球体材质需要光照） ───
    this.root3.add(new THREE.AmbientLight(0xcfe3ee, 0.85))
    const dir = new THREE.DirectionalLight(0xfff0dd, 1.15)
    dir.position.set(300, 800, 200)
    this.root3.add(dir)

    // ─── 地面（星空背景：tile 平铺放大地面，只画一次传一次） ───
    const groundGeo = this.trackGeo(this.F.createPlaneGeometry(GROUND_W, GROUND_H))
    groundGeo.rotateX(-Math.PI / 2)
    const starTex = makeStarfieldTexture()
    if (starTex) {
      this.tex.starfield = starTex
    } else {
      logger.warn('[StarMap] 星空 tile 生成失败（无 2D canvas 环境？），地面退化为纯色')
    }
    const groundMat = this.trackMat(
      this.tex.starfield
        ? this.F.createMeshBasicMaterial({ map: this.tex.starfield, depthWrite: false })
        : this.F.createMeshBasicMaterial({ color: 0x000000, depthWrite: false }),
    )
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
    this.flatOrbitGeo.dispose()
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
      this.systemGroup.add(mesh)
    }
  }

  // ─── 节点 ───

  private buildNodes(): void {
    // ─── 太阳（恒星：蓝图 SunActor 提供本体球，此处只建光晕 + 点光源 + 标签；静态） ───
    const sun = B.map.nodes.sun
    const sunWX = toWX(sun.x)
    const sunWZ = toWZ(sun.y)
    const sunGlowMat = this.trackMat(this.F.createMeshBasicMaterial({ color: 0xff8c2e, transparent: true, opacity: 0.18, depthWrite: false }))
    const sunGlow = this.F.createMesh(this.unitSphere, sunGlowMat).object
    sunGlow.scale.setScalar(sun.r * 1.35)
    sunGlow.position.set(sunWX, sun.r * 0.5, sunWZ)
    sunGlow.renderOrder = 11
    this.sunGroup.add(sunGlow)
    const sunLight = new THREE.PointLight(0xffc46b, 1.6, 2200)
    sunLight.position.set(sunWX, 80, sunWZ)
    this.sunGroup.add(sunLight)
    // 太阳标签
    const sunLabel = new SpriteLabel(this.F, this.sunGroup)
    sunLabel.set('太阳', 24, '#ffd9a0')
    sunLabel.setPos(sun.x, sun.y - sun.r - 38, 96)

    // ─── 轨道圈 + 行星视图（地球也公转：布局坐标 = 初相位，开局行星画在原布局位置） ───
    // 星球 mesh 已资产化为蓝图 Actor（provider.starActors，由 GameMode BeginPlay 生成并每帧 syncFrom）；
    // 渲染组件只负责标签 + 事件窗口环等表现附件。蓝图生成失败的天体在此兜底建球（星图不缺星）。
    for (const body of ['mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'europa', 'saturn', 'uranus', 'neptune'] as const) {
      const cfg = B.map.nodes[body]
      const moonCfg = (B.map.moons as Record<string, { parent: PlanetId; radius: number } | undefined>)[body]
      // 行星轨道圈：圆心=太阳，半径=布局距离（布局即初相位，改 star_map 配置即改轨道）；卫星走 moons 环单独建
      if (!moonCfg) {
        const orbitMat = this.trackMat(this.F.createMeshBasicMaterial({ color: 0x7896af, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }))
        const orbit = this.F.createMesh(this.flatOrbitGeo, orbitMat).object
        orbit.position.set(sunWX, 2.5, sunWZ)
        orbit.scale.setScalar(orbitRadiusPx(body))
        orbit.renderOrder = 9
        // 绕日轨道圈（圆心=太阳）属太阳系全景信息：地球系视图以地球为中心自成小系，一律归太阳系视图
        this.sunGroup.add(orbit)
      }
      const bpActor = this.provider.starActors?.get(body)
      let mesh: THREE.Mesh
      if (bpActor) {
        const comp = bpActor.getComponent(SphereMeshComponent)
        if (comp) {
          mesh = comp.obj.object
        } else {
          logger.error(`[StarMap] ${body} 蓝图缺少 SphereMeshComponent，兜底代码建球`)
          mesh = this.makeFallbackSphere(body, cfg.r)
        }
      } else {
        logger.warn(`[StarMap] ${body} 无蓝图 Actor，兜底代码建球`)
        mesh = this.makeFallbackSphere(body, cfg.r)
      }
      // 标签名：资源星读 B.stars（含满载副标），装饰行星读 planetNames
      const labelName = B.stars[body as StarId]?.name ?? B.map.planetNames[body as PlanetId] ?? body
      const labelParent = EARTH_VIEW_BODIES.has(body) ? this.systemGroup : this.sunGroup
      const name = new SpriteLabel(this.F, labelParent)
      name.set(labelName, 22, '#dff0fa')
      const sub = new SpriteLabel(this.F, labelParent)
      const ringMat = this.trackMat(this.F.createMeshBasicMaterial({ color: 0xffb03d, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }))
      const windowRing = this.F.createMesh(this.flatRingGeo, ringMat).object
      windowRing.position.y = 4
      windowRing.renderOrder = 11
      windowRing.visible = false
      labelParent.add(windowRing)
      this.starViews[body] = { body: mesh, mat: (mesh.material as THREE.MeshStandardMaterial | THREE.MeshLambertMaterial), name, sub, windowRing, radius: cfg.r }
      // 土星环（表现附件，only saturn；贴地压平的斜置薄环）
      if (body === 'saturn') {
        const saturnRingMat = this.trackMat(this.F.createMeshBasicMaterial({ color: 0xcbb890, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }))
        const saturnRingGeo = this.trackGeo(this.F.createRingGeometry(1.45, 2.05, 96))
        saturnRingGeo.rotateX(-Math.PI / 2 + 0.35)
        const saturnRing = this.F.createMesh(saturnRingGeo, saturnRingMat).object
        saturnRing.scale.setScalar(cfg.r)
        saturnRing.renderOrder = 10
        mesh.add(saturnRing)
      }
    }
    // 卫星环：moons 配置驱动（月球绕地 + 木卫二绕木；半径=配置值，圆心每帧贴 parent 实时位置）
    this.moonOrbitRing = null
    for (const [mid, mc] of Object.entries(B.map.moons)) {
      const moonOrbitMat = this.trackMat(this.F.createMeshBasicMaterial({ color: 0x8fa8bd, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }))
      const moonOrbit = this.F.createMesh(this.flatOrbitGeo, moonOrbitMat).object
      moonOrbit.position.y = 2.5
      moonOrbit.scale.setScalar(mc.radius)
      moonOrbit.renderOrder = 9
      // 月球绕地环 = 地球系核心表现（圆心每帧贴地球）；木卫二环属木星系全景（圆心每帧贴木星）
      if (mid === 'moon') {
        this.moonOrbitRing = moonOrbit
        this.systemGroup.add(moonOrbit)
      } else {
        moonOrbit.name = `moonOrbit_${mid}`
        this.sunGroup.add(moonOrbit)
      }
    }
    // 地球标签（锚在太阳下缘：聚能环的属主标注，随弧归太阳系视图）
    const earthLabel = new SpriteLabel(this.F, this.sunGroup)
    earthLabel.set('地球', 22, '#cfe8f5')
    earthLabel.setPos(sun.x, sun.y + sun.r + 26, 96)
  }

  /** 兜底建球（无蓝图/蓝图缺 SphereMesh 时保星图不缺星；Lambert 纯色） */
  private makeFallbackSphere(body: 'mercury' | 'venus' | 'earth' | 'moon' | 'mars' | 'jupiter' | 'europa' | 'saturn' | 'uranus' | 'neptune', r: number): THREE.Mesh {
    const colors: Record<string, number> = {
      mercury: 0x9a8f84, venus: 0xd9b06c, earth: 0x3f83a8, moon: 0xc9d4de, mars: 0xe8926f,
      jupiter: 0xc9a678, europa: 0x8fd0f0, saturn: 0xd8c08c, uranus: 0x9fd8dd, neptune: 0x5a8fd8,
    }
    const fallbackMat = this.trackMat(this.F.createMeshLambertMaterial({ color: colors[body] ?? 0xaaaaaa, transparent: true, opacity: 1 }))
    const mesh = this.F.createMesh(this.unitSphere, fallbackMat).object
    mesh.scale.setScalar(r)
    mesh.renderOrder = 12
    // 与蓝图星球同口径：归通用组由视图切换按 EARTH_VIEW_BODIES 显隐（root3 常显会泄漏太阳系全景）
    this.systemGroup.add(mesh)
    return mesh
  }

  // ─── 航线 ───

  private makeRouteQuad(): { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial } {
    const mat = this.trackMat(this.F.createMeshBasicMaterial({ transparent: true, depthWrite: false }))
    const mesh = this.F.createMesh(this.flatQuadGeo, mat).object
    mesh.position.y = 1.5
    mesh.renderOrder = 10
    this.systemGroup.add(mesh)
    return { mesh, mat }
  }

  private syncRoutes(): void {
    const { simState: sim, selection } = this.provider
    const sig = sim.state.routes.map((r) => `${r.id}:${r.direction}`).join('|')
    if (sig !== this.routeSig) {
      this.routeSig = sig
      for (const q of this.routeQuads.values()) {
        this.systemGroup.remove(q.mesh)
        q.mat.dispose()
        q.dashTex?.dispose()
      }
      this.routeQuads.clear()
      // 每条航线共用一条运输线（多船同线，不再按船数画平行线）
      for (const route of sim.state.routes) {
        this.routeQuads.set(`${route.id}:0`, this.makeRouteQuad())
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
      const q = this.routeQuads.get(`${route.id}:0`)
      if (!q) continue
      q.mesh.position.set(toWX((from.x + to.x) / 2), 1.5, toWZ((from.y + to.y) / 2))
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

  // ─── 飞船 ───

  private syncShips(): void {
    const { simState: sim } = this.provider
    const flareActive = sim.state.flare.phase === 'active'
    // 视图过滤（口径与航线过滤一致：地球系只显示地月归属的船，太阳系全显）
    const solar = this.viewMode === 'solar'
    const e = starPosAt(sim.state, 'earth')
    const inView = (x: number, y: number): boolean => solar || Math.hypot(x - e.x, y - e.y) <= EARTH_VIEW_RADIUS_PX
    let n = 0
    const place = (mx: number, my: number, color: number, glowScale: number) => {
      if (n >= this.SHIP_CAP) return
      if (!inView(mx, my)) return
      const slot = this.shipPool[n++]
      slot.mesh.visible = true
      slot.mesh.position.set(toWX(mx), 9, toWZ(my))
      slot.mat.color.setHex(color)
      slot.glowMat.color.setHex(color)
      slot.glow.scale.setScalar(glowScale)
    }
    for (const route of sim.state.routes) {
      route.shipIds.forEach((shipId) => {
        const ship = sim.state.ships.find((s) => s.id === shipId)
        if (!ship || ship.state === 'frozen') return
        const pos = shipPos(sim.state, ship)
        // 多船共用一条运输线：不做 lane 横向偏移，全部沿航线中轴线行进
        let color = C_SHIP_OUTBOUND
        if (ship.state === 'flying' && ship.leg === 'return') color = C_SHIP_RETURN
        else if (ship.materials > 0) color = C_SHIP_MATERIAL
        place(pos.x, pos.y, color, flareActive ? 24 + Math.random() * 10 : 30)
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
      const arcRadius = orbitRadiusPx('earth')
      const arcGeo = this.F.createRingGeometry(arcRadius - 7, arcRadius, 96, 1, -Math.PI / 2, coverage * Math.PI * 2)
      arcGeo.rotateX(-Math.PI / 2)
      const arcMat = this.F.createMeshBasicMaterial({ color: COLORS_ORANGE, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false })
      this.earthArc = this.F.createMesh(arcGeo, arcMat).object
      this.earthArc.position.set(toWX(B.map.nodes.sun.x), 3.5, toWZ(B.map.nodes.sun.y))
      this.earthArc.renderOrder = 11
      // 聚能弧画在地球公转轨道上（圆心=太阳）＝太阳系全景信息，地球系视图不显示
      this.sunGroup.add(this.earthArc)
    }
    if (this.earthArc) {
      const pulse = sim.state.ring === 'decaying' ? 0.5 + 0.5 * Math.sin(this.animTime * 6) : 0
      ;(this.earthArc.material as THREE.MeshBasicMaterial).color.setHex(
        sim.state.ring === 'decaying' ? (pulse > 0.5 ? 0xe84545 : 0xbfe9ff) : COLORS_ORANGE)
    }
    // 星球状态（位置由蓝图 StarActor.syncFrom 唯一驱动；此处只写标签/窗口环/解锁透明度）
    for (const star of Object.values(B.stars)) {
      const view = this.starViews[star.id]!
      const unlocked = starUnlocked(sim.state, star.id)
      view.mat.opacity = unlocked ? 1 : 0.25
      view.mat.transparent = !unlocked
      const pos = starPosAt(sim.state, star.id)
      view.name.set(star.name, 22, unlocked ? '#dff0fa' : '#5a707f')
      view.name.setPos(pos.x, pos.y - view.radius - 34, 96)
      const sub = unlocked ? `满载 ${Math.round(starLoad(sim.state.mods, star.id))}/船` : `第${star.unlockAct}幕解锁`
      view.sub.set(sub, 16, unlocked ? '#8fb2c6' : '#48606f')
      view.sub.setPos(pos.x, pos.y + view.radius + 30, 82)
      if (star.id === 'europa' && sim.state.gravity.phase !== 'idle') {
        const active = sim.state.gravity.phase === 'active'
        view.windowRing.visible = true
        view.windowRing.position.set(toWX(pos.x), 4, toWZ(pos.y))
        const s = (view.radius + 12) * (1 + Math.sin(this.animTime * 5) * 0.05)
        view.windowRing.scale.setScalar(s)
        ;(view.windowRing.material as THREE.MeshBasicMaterial).color.setHex(active ? 0xffb03d : 0x8a6a3a)
        ;(view.windowRing.material as THREE.MeshBasicMaterial).opacity = active ? 0.8 : 0.45
      } else {
        view.windowRing.visible = false
      }
    }
    // 卫星环贴 parent 实时位置（moons 配置驱动：月球环随地球、木卫二环随木星，各自跟随）
    for (const [mid, mc] of Object.entries(B.map.moons)) {
      const ring = mid === 'moon' ? this.moonOrbitRing : this.sunGroup.getObjectByName(`moonOrbit_${mid}`)
      if (!ring) continue
      const pp = starPosAt(sim.state, mc.parent)
      ring.position.x = toWX(pp.x)
      ring.position.z = toWZ(pp.y)
    }
    // 装饰行星标签跟随（资源星标签在上方 B.stars 循环内已同步；非资源行星只有主标签）
    for (const body of ['mercury', 'venus', 'jupiter', 'saturn', 'uranus', 'neptune'] as const) {
      const view = this.starViews[body]
      if (!view) continue
      const pos = starPosAt(sim.state, body)
      view.name.setPos(pos.x, pos.y - view.radius - 34, 96)
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
    this.systemGroup.add(group)
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
        this.systemGroup.remove(view.group)
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
      // 站台随轨吸附（锚点=依附星与地球连线中点，实时漂移；st.x/y 为建站时锚定值）
      const anchor = stationAnchorPos(sim.state, st)
      view.group.position.set(toWX(anchor.x), 0, toWZ(anchor.y))
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
    for (const body of TUTORIAL_TARGETS) {
      const p = B.map.nodes[body]
      const mat = this.trackMat(this.F.createMeshBasicMaterial({ color: 0xff6a3d, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }))
      const ring = this.F.createMesh(this.flatRingGeo, mat).object
      ring.position.set(toWX(p.x), 6, toWZ(p.y))
      ring.renderOrder = 20
      this.tutRings.push(ring)
      this.systemGroup.add(ring)
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
      this.systemGroup.add(arrow)
    }
    this.root3.add(this.tutGroup)
  }

  private syncTutorial(): void {
    const on = this.provider.simState.state.tutorial
    this.tutGroup.visible = on
    if (!on) return
    const t = this.animTime
    const pulse = 1 + Math.sin(t * 4) * 0.12
    const sim = this.provider.simState.state
    // 引导端点取 core 单一数据源（TUTORIAL_TARGETS = 月球 → 地球）：
    // 规则权威在 TransportComponent.tryCreateRoute，此处只消费不重定义（避免改引导要改多处）
    const [moonId, earthId] = TUTORIAL_TARGETS
    const moon = starPosAt(sim, moonId)
    const earth = starPosAt(sim, earthId)
    // 回退口径统一为「配置显示半径 + 边距」（曾：moon 硬编码 36 而实际 r=17，缺视图时环大一倍）
    const moonR = this.starViews[moonId]?.radius ?? B.map.nodes[moonId].r
    const earthR = this.starViews[earthId]?.radius ?? B.map.nodes[earthId].r
    this.tutRings[0].position.set(toWX(moon.x), 6, toWZ(moon.y))
    this.tutRings[0].scale.setScalar((moonR + TUTORIAL_RING_PAD) * pulse)
    this.tutRings[1].position.set(toWX(earth.x), 6, toWZ(earth.y))
    this.tutRings[1].scale.setScalar((earthR + TUTORIAL_RING_PAD) * pulse)
    const angleY = Math.atan2(-(toWZ(earth.y) - toWZ(moon.y)), toWX(earth.x) - toWX(moon.x))
    const dx = earth.x - moon.x
    const dy = earth.y - moon.y
    for (let i = 0; i < 3; i++) {
      const tt = ((t * 0.35 + i / 3) % 1)
      const arrow = this.tutArrows[i]
      arrow.position.set(toWX(moon.x + dx * tt), 8, toWZ(moon.y + dy * tt))
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
    this.sunGroup.add(this.missionLine)
  }

  private syncMissionLine(): void {
    const sim = this.provider.simState.state
    this.missionLine.visible = sim.module.state === 'mission'
    if (!this.missionLine.visible) return
    const a = starPosAt(sim, 'earth')
    const b = starPosAt(sim, 'mars')
    const pos = this.missionLine.geometry.getAttribute('position') as THREE.BufferAttribute
    pos.setXYZ(0, toWX(a.x), 1.8, toWZ(a.y))
    pos.setXYZ(1, toWX(b.x), 1.8, toWZ(b.y))
    pos.needsUpdate = true
    this.missionLine.computeLineDistances()
  }

  // ─── 拖线 ───

  private buildDrag(): void {
    this.dragMat = this.trackMat(this.F.createMeshBasicMaterial({ color: 0x96a5b4, transparent: true, opacity: 0.7, depthWrite: false }))
    this.dragQuad = this.F.createMesh(this.flatQuadGeo, this.dragMat).object
    this.dragQuad.position.y = 18
    this.dragQuad.renderOrder = 24
    this.dragQuad.visible = false
    this.systemGroup.add(this.dragQuad)
    this.dragRing = this.F.createMesh(
      this.flatRingGeo,
      this.trackMat(this.F.createMeshBasicMaterial({ color: 0x96a5b4, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })),
    ).object
    this.dragRing.position.y = 17
    this.dragRing.renderOrder = 25
    this.dragRing.visible = false
    this.systemGroup.add(this.dragRing)
    this.dragLabel = new SpriteLabel(this.F, this.systemGroup, 65)
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
      this.systemGroup.add(mesh)
    }
    for (let i = 0; i < 8; i++) {
      this.floatPool.push({ label: new SpriteLabel(this.F, this.systemGroup, 62), busy: false })
    }
  }

  private syncFx(): void {
    const { fx } = this.provider
    // 视图过滤（地球系视图只显示地月范围特效）
    const solar = this.viewMode === 'solar'
    const e = starPosAt(this.provider.simState.state, 'earth')
    const inView = (x: number, y: number): boolean => solar || Math.hypot(x - e.x, y - e.y) <= EARTH_VIEW_RADIUS_PX
    for (const p of this.pulsePool) p.busy = false
    for (const pulse of fx.pulses) {
      if (!inView(pulse.x, pulse.y)) continue
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
      if (!flt.text || !inView(flt.x, flt.y)) continue
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
    this.sunGroup.add(this.flareGroup)
  }

  private syncFlare(): void {
    const active = this.provider.simState.state.flare.phase === 'active'
    this.flareGroup.visible = active
    if (!active) return
    this.tex.noise.offset.set(Math.random(), Math.random())
    this.flareNoiseMat.opacity = 0.05 + Math.random() * 0.05
    this.flareVigMat.opacity = 0.12 + Math.random() * 0.06
  }

  // ─── 标注 LOD（群星式）：拉近显示全标注，拉远折叠为纯星点 ───

  /** 依相机高度衰减标注透明度（垂直俯视下相机 y = 观察距离） */
  private syncLabelLod(cam: THREE.Camera | null): void {
    if (!cam) return
    const dist = cam.position.y
    const nameA = THREE.MathUtils.clamp((820 - dist) / 160, 0, 1)
    const subA = THREE.MathUtils.clamp((580 - dist) / 160, 0, 1)
    for (const sv of Object.values(this.starViews)) {
      if (!sv) continue
      sv.name.sprite.material.opacity = nameA
      sv.name.sprite.visible = nameA > 0.02
      sv.sub.sprite.material.opacity = subA
      sv.sub.sprite.visible = subA > 0.02
    }
  }

  // ─── 视图分组切换（地球系 / 太阳系；ViewToggle → GameMode.setViewMode） ───

  /** 切换星图视图模式（由 GameMode.setViewMode 调用） */
  setViewMode(mode: 'earth' | 'solar'): void {
    if (this.viewMode === mode) return
    this.viewMode = mode
    this.applyViewMode()
  }

  /** 应用视图分组：太阳系专属表现整组显隐 + 蓝图星球 mesh 显隐 + 站点过滤 */
  private applyViewMode(): void {
    const solar = this.viewMode === 'solar'
    this.sunGroup.visible = solar
    for (const [body, view] of Object.entries(this.starViews)) {
      if (!view) continue
      view.body.visible = solar || EARTH_VIEW_BODIES.has(body)
    }
    // 站点视图过滤（站点 group 归 systemGroup 常显，此处只做显隐）；
    // 锚点用 stationAnchorPos 实时值（站点随轨漂移，与 syncStations 定位同源，不用建站锚定值）
    for (const [id, view] of this.stationViews) {
      const st = this.provider.simState.state.stations.find((s) => s.id === id)
      if (!st) continue
      const e = starPosAt(this.provider.simState.state, 'earth')
      const anchor = stationAnchorPos(this.provider.simState.state, st)
      const d = Math.hypot(anchor.x - e.x, anchor.y - e.y)
      view.group.visible = solar || d <= EARTH_VIEW_RADIUS_PX
    }
    if (solar) {
      // 太阳系全显：复位被地球系过滤隐藏的航线 quad / 飞船 mesh / 浮字标签
      for (const q of this.routeQuads.values()) q.mesh.visible = true
      for (const s of this.shipPool) s.mesh.visible = false // 交由 syncShips 每帧重建可见性
      for (const f of this.floatPool) f.label.sprite.visible = false
    }
    logger.info(`[StarMap] 视图切换 → ${solar ? '太阳系' : '地球系'}`)
  }

  /** 每帧过滤：航线/飞船/站点按当前视图归属显隐（位置更新照常，只裁可见性） */
  private syncViewFilter(): void {
    const solar = this.viewMode === 'solar'
    if (solar) {
      // 太阳系全景：恢复全部航线可见（地球系模式曾按地月归属隐藏）
      for (const q of this.routeQuads.values()) q.mesh.visible = true
      return
    }
    // 地球系视图：只显示两端都入画的地月航线（长跨系航线如地球→木卫二整条隐藏，不穿屏）
    const e = starPosAt(this.provider.simState.state, 'earth')
    const inEarthView = (x: number, y: number): boolean => Math.hypot(x - e.x, y - e.y) <= EARTH_VIEW_RADIUS_PX
    for (const [key, q] of this.routeQuads) {
      const id = Number(key.split(':')[0])
      const route = this.provider.simState.state.routes.find((r) => r.id === id)
      if (!route) continue
      const from = endpointPos(this.provider.simState.state, route.from)
      const to = endpointPos(this.provider.simState.state, route.to)
      q.mesh.visible = inEarthView(from.x, from.y) && inEarthView(to.x, to.y)
    }
    for (const [id, view] of this.stationViews) {
      const st = this.provider.simState.state.stations.find((s) => s.id === id)
      if (!st) continue
      const anchor = stationAnchorPos(this.provider.simState.state, st)
      view.group.visible = inEarthView(anchor.x, anchor.y)
    }
  }

  /** 每帧同步（GameMode.Tick 驱动；dt = 真实时间；cam = 太阳系相机，用于标注 LOD） */
  render(dt: number, cam?: THREE.Camera | null): void {
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
    this.syncLabelLod(cam ?? null)
    this.syncViewFilter()
  }
}

