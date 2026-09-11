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
import type { ThreeFactoryComponent, ThreeObject } from '@/engine'
import type { Actor } from '@/engine'
import type { AnchoredWidgetHandle } from '@/engine'
import { UITextComponent } from '@/engine'
import { B, MAP_H, MAP_W, toWX, toWZ } from '../core/balance'
import {
  makeStarfieldTileTexture,
  GROUND_W,
  GROUND_H,
  TILE_SIZE,
  STARFIELD_TILE_SEED,
} from './starfieldTile'
import { SphereMeshComponent } from '@/engine'
import { orbitBuildingDefOf } from '../systems/OrbitBuildComponent'
import {
  endpointPos,
  buildingDefOf,
  buildingPos,
  orbitBuildingPos,
  orbitRadiusPx,
  shipPos,
  starLoad,
  starPosAt,
  windowAffected,
  TUTORIAL_TARGETS,
  TUTORIAL_RING_PAD,
} from '../core/helpers'
import type { Endpoint, OrbitBuilding, PlanetId, SimBuilding, SimState, StarId } from '../core/types'
import type { SolarBodyId } from '../core/helpers'

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

export type MapSelection = { type: 'route' | 'building'; id: number } | null

/** 建筑模式光标（GameMode 维护，渲染只读；坐标 = 星图画布系，已网格吸附） */
export interface BuildCursor {
  x: number
  y: number
  valid: boolean
  /** 光标旁浮层（建筑名+造价 / 不可放置原因） */
  label: string
}

export interface MapFx {
  pulses: Array<{ x: number; y: number; age: number }>
  floats: Array<{ text: string; x: number; y: number; age: number }>
}

/** GameMode 侧数据源（避免渲染组件反向依赖具体 GameMode 类） */
export interface MapViewProvider {
  /** 天体蓝图 Actor（id → 实例；星球 mesh 的属主，渲染组件只读消费 mesh 引用） */
  readonly starActors: Map<string, import('@/engine').Actor>
  /** 行星系视角当前聚焦的行星（viewMode = earth 时生效；太阳系全景忽略） */
  readonly planetFocusBody: SolarBodyId
  simState: { state: SimState }
  drag: DragState | null
  selection: MapSelection
  fx: MapFx
  /** 建筑模式（非空 = 星图铺网格线 + 吸附放置预览） */
  buildMode: { typeId: string } | null
  /** 建筑模式光标（网格吸附坐标 + 合法性） */
  buildCursor: BuildCursor | null
  /** 耀斑预警框选矩形（非空 = 画选框；落点结算在 GameMode） */
  boxDrag: { x0: number; y0: number; x1: number; y1: number } | null
  /** 框选中的船 id 集（光点高亮圈） */
  selectedShips: number[]
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
const C_SHIP_SHELTER = 0x7dffb0
const C_SHIP_HOLD = 0xbfe9ff

// ─── 视图分组（星图切换：地球系 / 太阳系；ViewToggle → GameMode.setViewMode → applyViewMode） ───

// ─── 视图分组（星图切换：太阳系 / 行星系；ViewToggle/双击行星 → GameMode → applyViewMode） ───

/** 地球系视图特效可见半径（px，距聚焦行星）：覆盖地月航线/月球站锚（≤2400），排除他系站锚 */
const EARTH_VIEW_RADIUS_PX = 2600

/** 卫星归属母星（B.map.moons 反查；卫星与卫星环 = 行星系内容，太阳系全景不显示） */
function satelliteParentOf(body: string): PlanetId | null {
  const mc = (B.map.moons as Record<string, { parent: PlanetId } | undefined>)[body]
  return mc ? mc.parent : null
}

/** 网格步长（span 内单向线数 ≤ maxLines 的最小 g 整数倍） */
function spanStep(min: number, max: number, g: number, maxLines: number): number {
  const span = Math.max(g, max - min)
  const mult = Math.max(1, Math.ceil(span / g / maxLines))
  return g * mult
}

/** 母星的全部卫星 id */
function satellitesOf(parent: PlanetId): string[] {
  return Object.entries(B.map.moons).filter(([, mc]) => mc.parent === parent).map(([mid]) => mid)
}

/**
 * 行星系"舞台"锚点：行星系内容复用太阳的位置（世界原点）。
 * 进入行星系时其它行星（含标签）整组隐藏，聚焦行星被钉在太阳位上，
 * 其卫星像行星绕日一样绕它公转、卫星环按配置半径（真实比例）展开；
 * 切回太阳系时舞台位移归零，各行星归位。所有行星系共用原点，无需错开。
 * 锚点读太阳节点配置（画布中心 → 世界原点；配置被覆盖时跟随）。
 * GameMode 的相机取景/天体 Actor 定位/指针拾取共用同一函数。
 */
export function planetStageOffset(_body: PlanetId): { x: number; z: number } {
  return { x: toWX(B.map.nodes.sun.x), z: toWZ(B.map.nodes.sun.y) }
}

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

  constructor(private factory: ThreeFactoryComponent, owner: Actor, parent: THREE.Object3D, renderOrder = 60) {
    this.mat = factory.createSpriteMaterial({ transparent: true, depthWrite: false, depthTest: false })
    const spriteObj = factory.createSprite(this.mat)
    spriteObj.owner = owner
    this.sprite = spriteObj.object
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

// ─── 建筑视图（类型分支外观：中转站=琥珀色仓库环 / 护盾发生器=面朝太阳的半球磁场罩） ───

interface BuildingView {
  group: THREE.Group
  /** 功能气泡组（护盾建筑：半球罩+罩底缘环，整体按太阳方向定向；无半径建筑为 null） */
  bubble: THREE.Group | null
  dome: THREE.Mesh | null
  rim: THREE.Mesh | null
  core: THREE.Mesh
  /** 标题/副标文本组件（世界空间 UI widget 子节点，titleHandles 差分持有） */
  title: UITextComponent | null
  sub: UITextComponent | null
  /** 缓存类型（表改动/重建视图判定） */
  type: string
  /** 轨道建筑标记（null = 地图建筑；轨道建筑走 orbitBuildingPos 定位 + 建造进度环） */
  orbit: { obId: number } | null
  /** 轨道建筑建造进度环（在建时显示，满格消失；地图建筑恒 null） */
  progressRing: THREE.Mesh | null
}

/** 半球罩极轴（罩体朝背日侧弯曲），定向用单位向量 */
const DOME_AXIS = new THREE.Vector3(0, 1, 0)
/** 朝向解算复用向量（避免逐帧分配） */
const domeDir = new THREE.Vector3()

export class StarMapRenderComponent extends ActorComponent<Actor> {
  private provider: MapViewProvider
  private root3!: THREE.Group
  /** 太阳系视图组：太阳系专属表现（其它行星轨道圈/光晕/窗口环/木卫二卫星环），地球系视图整组隐藏 */
  private sunGroup!: THREE.Group
  /** 通用组：地月共有的表现（航线/船/站点/引导/拖线/特效），不参与视图切换 */
  private systemGroup!: THREE.Group
  /** 舞台组：行星系 gameplay 内容（systemGroup），逐帧平移把聚焦行星钉在舞台中心（太阳位）；星空地面不在此组（恒世界系） */
  private stageGroup!: THREE.Group
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
  /** 单位半球罩（护盾气泡：+Y = 罩体极轴，罩底开口朝 -Y） */
  private unitDome!: THREE.SphereGeometry

  private routeQuads = new Map<string, { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; dashTex?: THREE.Texture }>()
  private routeSig = ''

  private shipPool: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; glow: THREE.Sprite; glowMat: THREE.SpriteMaterial }> = []
  private readonly SHIP_CAP = 64

  private earthArc: THREE.Mesh | null = null
  private lastArcKey = ''
  /** 25 段环段弧池（槽位化：逐段点亮；每段 = 贴地弧 mesh，已装段附小型建筑标记） */
  private slotArcs: THREE.Mesh[] = []
  private slotMarkers: THREE.Mesh[] = []
  /** 框选矩形（耀斑预警框选手势；半透明面片） */
  private boxQuad: THREE.Mesh | null = null
  /** 细轨道圈几何（1.5% 环宽，公转轨道专用；flatRingGeo 太粗） */
  private flatOrbitGeo!: THREE.RingGeometry
  /** 卫星环（卫星绕母星轨道圈，圆心每帧贴母星实时位置；id → mesh） */
  private moonRings = new Map<string, THREE.Mesh>()
  private starViews: Partial<Record<string, { body: THREE.Mesh; mat: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial; sub: SpriteLabel; windowRing: THREE.Mesh; radius: number }>> = {}
  /** 建筑视图池（键 = `b<id>` 地图建筑 / `ob<id>` 轨道建筑；类型变更重建视图） */
  private buildingViews = new Map<string, BuildingView>()
  /** 建筑标签（世界空间 UI widget）句柄差分表（键同 buildingViews；拆建筑/重建视图 release 回收） */
  private labelHandles = new Map<string, AnchoredWidgetHandle>()
  /** 建筑标签 widget 资产（世界空间 UI：UIWorldAnchor mode=world + faceCamera + UIText 文本节点） */
  private static readonly BUILDING_LABEL_WIDGET = 'asset/blueprints/ui/building_label.widget.json'
  /** 轨道环装饰（锚天体 id → 环 mesh；有轨道建筑的天体显示，行星系视角可见） */
  private orbitRings = new Map<string, ThreeObject>()

  /** 建筑模式组（网格线 + 放置 ghost；挂 systemGroup 保持贴地图坐标系） */
  private buildGroup!: THREE.Group
  private gridLines: THREE.LineSegments | null = null
  /** 网格当前覆盖的世界系矩形（相机视野超出即重建） */
  private gridRect: { x0: number; z0: number; x1: number; z1: number } | null = null
  private gridMat!: THREE.LineBasicMaterial
  private ghostRing!: THREE.Mesh
  private ghostMat!: THREE.MeshBasicMaterial
  private ghostLabel!: SpriteLabel

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

  /** 当前帧相机（render 入口缓存；建筑标签距离 LOD 消费，无相机不裁剪） */
  private lastCam: THREE.Camera | null = null

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

  /** 工厂对象认领归属 Actor：批量渲染基础设施不走 ThreeObjectComponent 逐个挂载，World 销毁的孤儿诊断按 owner 豁免 */
  private own<T extends ThreeObject>(o: T): T {
    o.owner = this.owner
    return o
  }

  override BeginPlay(): void {
    this.factory = this.owner.world?.factory ?? null
    if (!this.factory) {
      logger.error('[StarMap] World 工厂不可用，星图将无法创建渲染对象')
      return
    }
    this.root3 = this.own(this.F.createGroup()).object
    this.tutGroup = this.own(this.F.createGroup()).object
    this.flareGroup = this.own(this.F.createGroup()).object
    this.sunGroup = this.own(this.F.createGroup()).object
    this.systemGroup = this.own(this.F.createGroup()).object
    // 舞台分组：只有行星系 gameplay 内容（systemGroup）挂这里，进入行星系时迁到
    // 太阳位（planetStageOffset 锚点 = 世界原点），聚焦行星钉在原点、其余行星隐藏；
    // 星空地面恒挂世界系（不随舞台走，行星系背景静止）；太阳系全景时舞台回原点、sunGroup 全显
    this.stageGroup = this.own(this.F.createGroup()).object
    this.root3.add(this.sunGroup, this.stageGroup)
    this.stageGroup.add(this.systemGroup)
    this.flatQuadGeo = this.F.createPlaneGeometry(1, 1)
    this.flatQuadGeo.rotateX(-Math.PI / 2)
    this.flatRingGeo = this.F.createRingGeometry(0.92, 1, 96)
    this.flatRingGeo.rotateX(-Math.PI / 2)
    this.flatOrbitGeo = this.F.createRingGeometry(0.985, 1, 128)
    this.flatOrbitGeo.rotateX(-Math.PI / 2)
    this.unitSphere = this.F.createSphereGeometry(1, 28, 20)
    // 半球罩：工厂球不带半球参数，按索引丢弃 y<0 的三角形裁出上半壳（罩底开放）
    this.unitDome = this.F.createSphereGeometry(1, 32, 16)
    {
      const pos = this.unitDome.attributes.position
      const idx = this.unitDome.index
      if (idx) {
        const keep: number[] = []
        for (let t = 0; t < idx.count; t += 3) {
          let above = true
          for (let k = 0; k < 3; k++) {
            if (pos.getY(idx.getX(t + k)) < -1e-4) { above = false; break }
          }
          if (above) keep.push(idx.getX(t), idx.getX(t + 1), idx.getX(t + 2))
        }
        this.unitDome.setIndex(keep)
      }
    }

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
    const ground = this.own(this.F.createMesh(groundGeo, groundMat)).object
    ground.position.y = -0.5
    ground.renderOrder = 0
    // 星空地面恒挂世界系（不进舞台组）：行星系视图下舞台每帧平移补偿聚焦行星的公转位移，
    // 星空若随舞台走，背景会跟着漂移（看起来"还是原来太阳系在动"）；固定后背景静止，
    // 行星系读作"行星种在舞台中心的定场小星系"
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
    this.buildBuildMode()

    this.owner.root.add(this.root3)
    // 开局即地球系视图（GameMode.focusSolarSystem 在 starMap 就绪前已跑过）：补应用一次视图分组，太阳本体球不漏显
    this.applyViewMode()
    logger.info('[WarmCurrent] 星图渲染就绪（3D：XZ 地面 + 球体 + 俯视透视）')
  }

  override EndPlay(): void {
    this.owner.root.remove(this.root3)
    for (const m of this.mats) m.dispose()
    for (const g of this.geos) g.dispose()
    for (const t of Object.values(this.tex)) t?.dispose()
    for (const [bvKey, bv] of this.buildingViews) this.disposeBuilding(bv, bvKey)
    this.buildingViews.clear()
    this.labelHandles.clear()
    this.unitSphere.dispose()
    this.unitDome.dispose()
    this.flatQuadGeo.dispose()
    this.flatRingGeo.dispose()
    this.flatOrbitGeo.dispose()
  }

  // ─── 飞船池 ───

  private buildShips(): void {
    const geo = this.trackGeo(this.F.createSphereGeometry(4.5, 12, 10))
    for (let i = 0; i < this.SHIP_CAP; i++) {
      const mat = this.trackMat(this.F.createMeshBasicMaterial({ color: C_SHIP_OUTBOUND }))
      const mesh = this.own(this.F.createMesh(geo, mat)).object
      mesh.position.y = 9
      mesh.renderOrder = 14
      mesh.visible = false
      const glowMat = this.trackMat(this.F.createSpriteMaterial({
        map: this.tex.glow, color: C_SHIP_OUTBOUND, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }))
      const glow = this.own(this.F.createSprite(glowMat)).object
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
    const sunGlow = this.own(this.F.createMesh(this.unitSphere, sunGlowMat)).object
    sunGlow.scale.setScalar(sun.r * 1.35)
    sunGlow.position.set(sunWX, sun.r * 0.5, sunWZ)
    sunGlow.renderOrder = 11
    this.sunGroup.add(sunGlow)
    const sunLight = new THREE.PointLight(0xffc46b, 1.6, 2200)
    sunLight.position.set(sunWX, 80, sunWZ)
    this.sunGroup.add(sunLight)
    // 太阳标签
    const sunLabel = new SpriteLabel(this.F, this.owner, this.sunGroup)
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
        const orbit = this.own(this.F.createMesh(this.flatOrbitGeo, orbitMat)).object
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
      // 副标（满载/解锁提示）全归 systemGroup（随舞台迁移）；显隐由视图天体集（visibleBodySet）每帧仲裁
      const labelParent = this.systemGroup
      const sub = new SpriteLabel(this.F, this.owner, labelParent)
      const ringMat = this.trackMat(this.F.createMeshBasicMaterial({ color: 0xffb03d, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }))
      const windowRing = this.own(this.F.createMesh(this.flatRingGeo, ringMat)).object
      windowRing.position.y = 4
      windowRing.renderOrder = 11
      windowRing.visible = false
      labelParent.add(windowRing)
      this.starViews[body] = { body: mesh, mat: (mesh.material as THREE.MeshStandardMaterial | THREE.MeshLambertMaterial), sub, windowRing, radius: cfg.r }
      // 土星环（表现附件，only saturn；贴地压平的斜置薄环）
      if (body === 'saturn') {
        const saturnRingMat = this.trackMat(this.F.createMeshBasicMaterial({ color: 0xcbb890, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }))
        const saturnRingGeo = this.trackGeo(this.F.createRingGeometry(1.45, 2.05, 96))
        saturnRingGeo.rotateX(-Math.PI / 2 + 0.35)
        const saturnRing = this.own(this.F.createMesh(saturnRingGeo, saturnRingMat)).object
        saturnRing.scale.setScalar(cfg.r)
        saturnRing.renderOrder = 10
        mesh.add(saturnRing)
      }
    }
    // 卫星环：moons 配置驱动（月球绕地 + 木卫二绕木；半径=配置值，圆心每帧贴 parent 实时位置）
    // 全部归 systemGroup：卫星环=行星系内容，太阳系全景隐藏、仅对应行星系视角显示（applyViewMode）
    this.moonRings.clear()
    for (const [mid, mc] of Object.entries(B.map.moons)) {
      const moonOrbitMat = this.trackMat(this.F.createMeshBasicMaterial({ color: 0x8fa8bd, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }))
      const moonOrbit = this.own(this.F.createMesh(this.flatOrbitGeo, moonOrbitMat)).object
      moonOrbit.position.y = 2.5
      moonOrbit.scale.setScalar(mc.radius)
      moonOrbit.renderOrder = 9
      moonOrbit.visible = false
      this.moonRings.set(mid, moonOrbit)
      this.systemGroup.add(moonOrbit)
    }
    // 地球标签（锚在太阳下缘：聚能环的属主标注，随弧归太阳系视图）
    const earthLabel = new SpriteLabel(this.F, this.owner, this.sunGroup)
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
    const mesh = this.own(this.F.createMesh(this.unitSphere, fallbackMat)).object
    mesh.scale.setScalar(r)
    mesh.renderOrder = 12
    // 与蓝图星球同口径：归通用组由视图切换按 EARTH_VIEW_BODIES 显隐（root3 常显会泄漏太阳系全景）
    this.systemGroup.add(mesh)
    return mesh
  }

  // ─── 航线 ───

  private makeRouteQuad(): { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial } {
    const mat = this.trackMat(this.F.createMeshBasicMaterial({ transparent: true, depthWrite: false }))
    const mesh = this.own(this.F.createMesh(this.flatQuadGeo, mat)).object
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
      q.mesh.scale.set(len, 1, selected ? 2 : windowed ? 1.8 : 1)
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
        q.mat.opacity = 0.7
      } else {
        q.mat.color.setHex(route.direction === 'reverse' ? C_ROUTE_REVERSE : C_ROUTE_FORWARD)
        q.mat.opacity = 0.28
      }
    }
  }

  // ─── 飞船 ───

  private syncShips(): void {
    const { simState: sim } = this.provider
    const flareActive = sim.state.flare.phase === 'active'
    // 视图过滤（口径与航线过滤一致：行星系只显示本地归属的船，太阳系全显）
    const solar = this.viewMode === 'solar'
    const c = starPosAt(sim.state, this.provider.planetFocusBody)
    const inView = (x: number, y: number): boolean => solar || Math.hypot(x - c.x, y - c.y) <= EARTH_VIEW_RADIUS_PX
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
        // 耀斑决策视觉（玩家设计权）：框选 = 白亮 / 靠站 = 绿 / 待命 = 冰蓝
        if (this.provider.selectedShips.includes(ship.id)) color = 0xffffff
        else if (ship.order === 'shelter') color = C_SHIP_SHELTER
        else if (ship.order === 'hold') color = C_SHIP_HOLD
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
    // 25 段环段弧（槽位化：逐段点亮；已建成槽位段亮、已装段附建筑标记；段数/装入签名变化才重建）
    const totalSlots = Math.max(1, B.ringSlots)
    const installedSig = (sim.state.ringBuildings ?? []).map((x) => x ?? '-').join('').slice(0, totalSlots)
    const arcKey = `${sim.state.ringSlots}/${totalSlots}/${installedSig}`
    if (arcKey !== this.lastArcKey) {
      this.lastArcKey = arcKey
      if (this.earthArc) {
        this.root3.remove(this.earthArc)
        this.earthArc.geometry.dispose()
        ;(this.earthArc.material as THREE.Material).dispose()
        this.earthArc = null
      }
      for (const m of this.slotArcs) {
        this.root3.remove(m)
        m.geometry.dispose()
        ;(m.material as THREE.Material).dispose()
      }
      this.slotArcs = []
      for (const m of this.slotMarkers) {
        this.root3.remove(m)
        m.geometry.dispose()
        ;(m.material as THREE.Material).dispose()
      }
      this.slotMarkers = []
      // 每段 = 独立弧几何（2π/25 扇区留 12% 缺口显分段感），圆心 = 太阳、半径 = 地球轨道
      const arcRadius = orbitRadiusPx('earth')
      const sector = (Math.PI * 2) / totalSlots
      const gap = sector * 0.12
      for (let i = 0; i < totalSlots; i++) {
        if (i >= sim.state.ringSlots) break
        const a0 = -Math.PI / 2 + i * sector + gap / 2
        const geo = this.F.createRingGeometry(arcRadius - 7, arcRadius, 24, 1, a0, sector - gap)
        geo.rotateX(-Math.PI / 2)
        const installed = !!(sim.state.ringBuildings ?? [])[i]
        const mat = this.F.createMeshBasicMaterial({
          color: installed ? 0xffd98a : COLORS_ORANGE,
          transparent: true,
          opacity: installed ? 1 : 0.95,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
        const mesh = this.own(this.F.createMesh(geo, mat)).object
        mesh.position.set(toWX(B.map.nodes.sun.x), 3.5, toWZ(B.map.nodes.sun.y))
        mesh.renderOrder = 11
        this.slotArcs.push(mesh)
        // 聚能弧画在地球公转轨道上（圆心=太阳）＝太阳系全景信息，地球系视图不显示
        this.sunGroup.add(mesh)
        if (installed) {
          // 已装格小型建筑标记（段中线小球，视觉 = 环上小建筑）
          const mid = a0 + (sector - gap) / 2
          const markerGeo = this.trackGeo(this.F.createSphereGeometry(4.5, 8, 8))
          const markerMat = this.F.createMeshBasicMaterial({ color: 0xffe9a8 })
          const marker = this.own(this.F.createMesh(markerGeo, markerMat)).object
          marker.position.set(
            toWX(B.map.nodes.sun.x) + Math.cos(mid) * (arcRadius - 3.5),
            7,
            toWZ(B.map.nodes.sun.y) + Math.sin(mid) * (arcRadius - 3.5),
          )
          marker.renderOrder = 12
          this.slotMarkers.push(marker)
          this.sunGroup.add(marker)
        }
      }
    }
    // 断环脉冲着色（运转 = 橙；衰减 = 红蓝交替闪烁，与旧覆盖弧同语言）
    if (this.slotArcs.length > 0) {
      const decaying = sim.state.ring === 'decaying'
      const pulse = decaying ? 0.5 + 0.5 * Math.sin(this.animTime * 6) : 0
      const color = decaying ? (pulse > 0.5 ? 0xe84545 : 0xbfe9ff) : COLORS_ORANGE
      for (const seg of this.slotArcs) (seg.material as THREE.MeshBasicMaterial).color.setHex(color)
    }
    // 星球状态（位置由蓝图 StarActor.syncFrom 唯一驱动；此处只写标签/窗口环/解锁透明度）
    for (const star of Object.values(B.stars)) {
      const sv = this.starViews[star.id]!
      const unlocked = starUnlocked(sim.state, star.id)
      sv.mat.opacity = unlocked ? 1 : 0.25
      sv.mat.transparent = !unlocked
      const pos = starPosAt(sim.state, star.id)
      const sub = unlocked ? `满载 ${Math.round(starLoad(sim.state.mods, star.id))}/船` : `第${star.unlockAct}幕解锁`
      sv.sub.set(sub, 16, unlocked ? '#8fb2c6' : '#48606f')
      // 注意：此标签父级 = systemGroup（组自身零位移），世界坐标 setPos 语义成立；
      // 与建筑视图标签（父级 = 已定位的视图组，须写本地偏移）不同，勿混用两种口径
      sv.sub.setPos(pos.x, pos.y + sv.radius + 30, 82)
      if (star.id === 'europa' && sim.state.gravity.phase !== 'idle') {
        const active = sim.state.gravity.phase === 'active'
        sv.windowRing.visible = true
        sv.windowRing.position.set(toWX(pos.x), 4, toWZ(pos.y))
        const s = (sv.radius + 12) * (1 + Math.sin(this.animTime * 5) * 0.05)
        sv.windowRing.scale.setScalar(s)
        ;(sv.windowRing.material as THREE.MeshBasicMaterial).color.setHex(active ? 0xffb03d : 0x8a6a3a)
        ;(sv.windowRing.material as THREE.MeshBasicMaterial).opacity = active ? 0.8 : 0.45
      } else {
        sv.windowRing.visible = false
      }
    }
    // 卫星环贴 parent 实时位置（moons 配置驱动：月球环随地球、木卫二环随木星，各自跟随）
    for (const [mid, mc] of Object.entries(B.map.moons)) {
      const ring = this.moonRings.get(mid)
      if (!ring) continue
      const pp = starPosAt(sim.state, mc.parent)
      ring.position.x = toWX(pp.x)
      ring.position.z = toWZ(pp.y)
    }
  }

  // ─── 地图建筑 ───

  /** 建筑外观色（表行键 → 主色；未列类型回退冰蓝） */
  private static readonly BUILDING_COLORS: Record<string, number> = {
    relay: 0xffb03d,
    shield: 0x5ac8ff,
    dock: 0x7dffb0,
  }

  private buildBuildingView(b: SimBuilding): BuildingView {
    const def = buildingDefOf(b.type)
    const color = StarMapRenderComponent.BUILDING_COLORS[b.type] ?? 0x9fdcff
    const group = this.own(this.F.createGroup()).object
    const radius = def?.radius ?? 0
    // 功能气泡（护盾建筑）：面朝太阳的半球磁场罩（罩体在背日侧弯曲）+ 罩底朝阳缘环
    let bubble: THREE.Group | null = null
    let dome: THREE.Mesh | null = null
    let rim: THREE.Mesh | null = null
    if (radius > 0) {
      bubble = this.own(this.F.createGroup()).object
      bubble.position.y = 2
      const domeMat = this.trackMat(this.F.createMeshBasicMaterial({ color, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }))
      dome = this.own(this.F.createMesh(this.unitDome, domeMat)).object
      dome.renderOrder = 9
      const rimMat = this.trackMat(this.F.createMeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }))
      rim = this.own(this.F.createMesh(this.flatRingGeo, rimMat)).object
      rim.renderOrder = 9
      bubble.add(dome, rim)
      group.add(bubble)
    }
    const coreMat = this.trackMat(this.F.createMeshBasicMaterial({ color }))
    const core = this.own(this.F.createMesh(this.unitSphere, coreMat)).object
    core.scale.setScalar(9)
    core.position.y = 9
    core.renderOrder = 12
    group.add(core)
    const title = null
    const sub = null
    const p0 = buildingPos(this.provider.simState.state, b)
    group.position.set(toWX(p0.x), 0, toWZ(p0.y))
    this.systemGroup.add(group)
    return { group, bubble, dome, rim, core, title, sub, type: b.type, orbit: null, progressRing: null }
  }

  /** 轨道建筑视图（近地轨道建设 2026-09-09）：核心球 + 建造进度环，定位走 orbitBuildingPos */
  private buildOrbitView(ob: OrbitBuilding): BuildingView {
    const def = orbitBuildingDefOf(ob.type)
    const color = StarMapRenderComponent.BUILDING_COLORS[ob.type] ?? 0x7dffb0
    const group = this.own(this.F.createGroup()).object
    const coreMat = this.trackMat(this.F.createMeshBasicMaterial({ color }))
    const core = this.own(this.F.createMesh(this.unitSphere, coreMat)).object
    core.scale.setScalar(8)
    core.position.y = 8
    core.renderOrder = 12
    group.add(core)
    // 建造进度环（在建显示：按 progress 扫弧；满格建成移除）
    let progressRing: THREE.Mesh | null = null
    if (!ob.built) {
      const ringMat = this.trackMat(this.F.createMeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }))
      progressRing = this.own(this.F.createMesh(this.flatRingGeo, ringMat)).object
      progressRing.scale.setScalar(16)
      progressRing.renderOrder = 11
      group.add(progressRing)
    }
    const title = null
    const sub = null
    const p0 = orbitBuildingPos(this.provider.simState.state, ob)
    group.position.set(toWX(p0.x), 0, toWZ(p0.y))
    this.systemGroup.add(group)
    return { group, bubble: null, dome: null, rim: null, core, title, sub, type: ob.type, orbit: { obId: ob.id }, progressRing }
  }

  private disposeBuilding(v: BuildingView, key: string): void {
    const h = this.labelHandles.get(key)
    if (h) {
      h.release()
      this.labelHandles.delete(key)
    }
  }

  private syncBuildings(): void {
    const { simState: sim, selection } = this.provider
    // 轨道环装饰差分：有轨道设施（含在建）的锚天体画一圈细环（半径 = ringRadius，世界系跟锚公转）
    const needRings = new Set<string>(sim.state.orbitBuildings.map((x) => x.anchor))
    for (const [anchor, ring] of this.orbitRings) {
      if (!needRings.has(anchor)) {
        this.systemGroup.remove(ring.object)
        this.orbitRings.delete(anchor)
      }
    }
    for (const anchor of needRings) {
      if (this.orbitRings.has(anchor)) continue
      const mat = this.trackMat(this.F.createMeshBasicMaterial({ color: 0x7dffb0, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }))
      const ring = this.own(this.F.createMesh(this.flatRingGeo, mat))
      ring.object.renderOrder = 5
      this.orbitRings.set(anchor, ring)
      this.systemGroup.add(ring.object)
    }
    for (const [anchor, ring] of this.orbitRings) {
      const ap = starPosAt(sim.state, anchor as PlanetId)
      ring.object.position.set(toWX(ap.x), 1, toWZ(ap.y))
      ring.object.scale.setScalar(B.orbitBuild.ringRadius)
    }
    // 拆除 → 视图回收
    for (const [id, view] of this.buildingViews) {
      const isOrbit = view.orbit !== null
      const alive = isOrbit
        ? sim.state.orbitBuildings.some((x) => `ob${x.id}` === id)
        : sim.state.buildings.some((b) => `b${b.id}` === id)
      if (!alive) {
        this.systemGroup.remove(view.group)
        this.disposeBuilding(view, id)
        this.buildingViews.delete(id)
      }
    }
    // 轨道建筑（近地轨道建设）：绕锚行星均布公转，视图键 ob<id>
    for (const ob of sim.state.orbitBuildings) {
      const key = `ob${ob.id}`
      let view = this.buildingViews.get(key)
      if (!view || view.type !== ob.type) {
        if (view) {
          this.systemGroup.remove(view.group)
          this.disposeBuilding(view, key)
        }
        view = this.buildOrbitView(ob)
        this.buildingViews.set(key, view)
      }
      const def = orbitBuildingDefOf(ob.type)
      const color = StarMapRenderComponent.BUILDING_COLORS[ob.type] ?? 0x7dffb0
      const op = orbitBuildingPos(sim.state, ob)
      view.group.position.set(toWX(op.x), 0, toWZ(op.y))
      ;(view.core.material as THREE.MeshBasicMaterial).color.setHex(ob.built ? color : 0x6a8496)
      if (view.progressRing) {
        // 建造进度环：随 progress 缩放（0 → 收缩点，1 → 满环后随建成移除）
        view.progressRing.scale.setScalar(4 + ob.progress * 14)
        ;(view.progressRing.material as THREE.MeshBasicMaterial).opacity = ob.built ? 0 : 0.85
      }
      const name = def?.name ?? ob.type
      this.ensureBuildingLabel(
        key,
        view,
        toWX(op.x),
        toWZ(op.y),
        ob.built ? `${name} ${ob.id}` : `${name} ${ob.id} · 建造中 ${Math.round(ob.progress * 100)}%`,
        ob.built ? '近地轨道设施' : '',
      )
    }
    for (const b of sim.state.buildings) {
      const key = `b${b.id}`
      let view = this.buildingViews.get(key)
      if (!view || view.type !== b.type) {
        if (view) {
          this.systemGroup.remove(view.group)
          this.disposeBuilding(view, key)
        }
        view = this.buildBuildingView(b)
        this.buildingViews.set(key, view)
      }
      const def = buildingDefOf(b.type)
      const selected = selection?.type === 'building' && selection.id === b.id
      const color = StarMapRenderComponent.BUILDING_COLORS[b.type] ?? 0x9fdcff
      // 入轨建筑跟随锚行星公转（buildingPos 实时位置；未入轨 = 静态落点）
      const bp = buildingPos(sim.state, b)
      view.group.position.set(toWX(bp.x), 0, toWZ(bp.y))
      if (view.bubble && view.dome && view.rim && def && def.radius > 0) {
        view.bubble.scale.setScalar(def.radius)
        // 罩体面朝太阳：半球极轴指向背日侧（磁场罩形，罩底缘环竖立朝阳）；
        // 口径 = 画布系 (bp - sun) 映射世界 XZ（toWX/toWZ 纯平移，向量同向），
        // 与 HazardsComponent 免伤半圆判定共用同一方向约定
        const sx = bp.x - B.map.nodes.sun.x
        const sz = bp.y - B.map.nodes.sun.y
        const sl = Math.hypot(sx, sz) || 1
        domeDir.set(sx / sl, 0, sz / sl)
        view.bubble.quaternion.setFromUnitVectors(DOME_AXIS, domeDir)
        ;(view.rim.material as THREE.MeshBasicMaterial).color.setHex(color)
        ;(view.rim.material as THREE.MeshBasicMaterial).opacity = selected ? 0.7 : 0.35
        ;(view.dome.material as THREE.MeshBasicMaterial).opacity = selected ? 0.12 : 0.07
      }
      ;(view.core.material as THREE.MeshBasicMaterial).color.setHex(color)
      view.core.scale.setScalar(selected ? 11 : 9)
      const name = def?.name ?? b.type
      const isRelay = (def?.bufferCap ?? 0) > 0
      this.ensureBuildingLabel(
        key,
        view,
        toWX(bp.x),
        toWZ(bp.y),
        isRelay && def ? `${name} ${b.id} · 缓存 ${Math.floor(b.stock)}/${def.bufferCap}` : `${name} ${b.id}`,
        isRelay && def ? (def.linkable ? '航线可链接' : '') : `护盾半径 ${def?.radius ?? 0} · 保全 ${def?.shipCap ?? 0} 艘`,
      )
    }
  }

  // ─── 建筑模式（网格线 + 放置 ghost） ───

  private buildBuildMode(): void {
    this.buildGroup = this.own(this.F.createGroup()).object
    this.systemGroup.add(this.buildGroup)
    this.gridMat = this.trackMat(this.F.createLineBasicMaterial({ color: 0x3fa9f5, transparent: true, opacity: 0.16, depthWrite: false }))
    this.ghostMat = this.trackMat(this.F.createMeshBasicMaterial({ color: 0x43d17c, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }))
    this.ghostRing = this.own(this.F.createMesh(this.flatRingGeo, this.ghostMat)).object
    this.ghostRing.position.y = 8
    this.ghostRing.renderOrder = 30
    this.ghostRing.visible = false
    this.buildGroup.add(this.ghostRing)
    this.ghostLabel = new SpriteLabel(this.F, this.owner, this.buildGroup, 66)
    this.buildGroup.visible = false
  }

  /** 网格线覆盖当前相机视野（世界系，原点锚定 step=build.grid；视野超出已有覆盖即重建） */
  private ensureGridCoverage(cam: THREE.Camera | null): void {
    if (!cam) return
    const g = Math.max(1, B.build.grid)
    const perspective = cam as THREE.PerspectiveCamera
    const distY = Math.max(g * 2, cam.position.y)
    const halfH = Math.tan(((perspective.fov ?? 50) * Math.PI) / 360) * distY
    const halfW = halfH * Math.max(0.4, perspective.aspect || 1.6)
    const PAD = g * 6
    const need = {
      x0: Math.max(-16000, cam.position.x - halfW - PAD),
      x1: Math.min(16000, cam.position.x + halfW + PAD),
      z0: Math.max(-16000, cam.position.z - halfH - PAD),
      z1: Math.min(16000, cam.position.z + halfH + PAD),
    }
    const cur = this.gridRect
    if (cur && cur.x0 <= need.x0 && cur.x1 >= need.x1 && cur.z0 <= need.z0 && cur.z1 >= need.z1) return
    // 单向线数上限（拉太远时加倍步长，防几何爆炸）
    const MAX_LINES = 240
    const stepX = spanStep(need.x0, need.x1, g, MAX_LINES)
    const stepZ = spanStep(need.z0, need.z1, g, MAX_LINES)
    const pts: number[] = []
    const y = 1.2
    for (let x = Math.ceil(need.x0 / stepX) * stepX; x <= need.x1; x += stepX) {
      pts.push(x, y, need.z0, x, y, need.z1)
    }
    for (let z = Math.ceil(need.z0 / stepZ) * stepZ; z <= need.z1; z += stepZ) {
      pts.push(need.x0, y, z, need.x1, y, z)
    }
    const geo = this.trackGeo(this.F.createBufferGeometry())
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3))
    if (this.gridLines) {
      this.buildGroup.remove(this.gridLines)
      this.gridLines.geometry.dispose()
    }
    this.gridLines = this.own(this.F.createLineSegments(geo, this.gridMat)).object
    this.gridLines.renderOrder = 7
    this.buildGroup.add(this.gridLines)
    this.gridRect = need
    logger.info(`[StarMap] 建筑网格重建（世界系 x ${Math.round(need.x0)}~${Math.round(need.x1)} / z ${Math.round(need.z0)}~${Math.round(need.z1)}）`)
  }

  private syncBuildMode(cam: THREE.Camera | null): void {
    const on = !!this.provider.buildMode
    this.buildGroup.visible = on
    if (!on) {
      this.ghostRing.visible = false
      this.ghostLabel.clear()
      return
    }
    this.ensureGridCoverage(cam)
    const cur = this.provider.buildCursor
    if (!cur) {
      this.ghostRing.visible = false
      this.ghostLabel.clear()
      return
    }
    this.ghostRing.visible = true
    this.ghostRing.position.set(toWX(cur.x), 8, toWZ(cur.y))
    this.ghostRing.scale.setScalar(24 + Math.sin(this.animTime * 6) * 2)
    this.ghostMat.color.setHex(cur.valid ? 0x43d17c : 0xe84545)
    this.ghostMat.opacity = cur.valid ? 0.55 : 0.8
    if (cur.label) {
      this.ghostLabel.set(cur.label, 16, cur.valid ? '#c8f5d8' : '#ffc0b8')
      this.ghostLabel.setPos(cur.x + 30, cur.y + 26, 60)
    } else {
      this.ghostLabel.clear()
    }
  }


  // ─── 引导 ───

  private buildTutorial(): void {
    for (const body of TUTORIAL_TARGETS) {
      const p = B.map.nodes[body]
      const mat = this.trackMat(this.F.createMeshBasicMaterial({ color: 0xff6a3d, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }))
      const ring = this.own(this.F.createMesh(this.flatRingGeo, mat)).object
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
      const arrow = this.own(this.F.createMesh(tri, mat)).object
      arrow.position.y = 8
      arrow.renderOrder = 21
      this.tutArrows.push(arrow)
      this.systemGroup.add(arrow)
    }
    this.root3.add(this.tutGroup)
  }

  private syncTutorial(): void {
    // 引导双环锚在地月之间：只在地月系视角显示（其它行星系舞台/太阳系全景不显示，防止环漂在错误区域）
    const on = this.provider.simState.state.tutorial
      && this.viewMode === 'earth'
      && this.provider.planetFocusBody === 'earth'
    this.tutGroup.visible = on
    for (const ring of this.tutRings) ring.visible = on
    for (const arrow of this.tutArrows) arrow.visible = on
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
    this.missionLine = this.own(this.F.createPolyline(geo, mat)).object
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
    this.dragQuad = this.own(this.F.createMesh(this.flatQuadGeo, this.dragMat)).object
    this.dragQuad.position.y = 18
    this.dragQuad.renderOrder = 24
    this.dragQuad.visible = false
    this.systemGroup.add(this.dragQuad)
    this.dragRing = this.own(this.F.createMesh(
      this.flatRingGeo,
      this.trackMat(this.F.createMeshBasicMaterial({ color: 0x96a5b4, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })),
    )).object
    this.dragRing.position.y = 17
    this.dragRing.renderOrder = 25
    this.dragRing.visible = false
    this.systemGroup.add(this.dragRing)
    this.dragLabel = new SpriteLabel(this.F, this.owner, this.systemGroup, 65)
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
        : drag.hoverEp.kind === 'building' ? 0x57c4f0
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
      const mesh = this.own(this.F.createMesh(this.flatRingGeo, mat)).object
      mesh.position.y = 12
      mesh.renderOrder = 26
      mesh.visible = false
      this.pulsePool.push({ mesh, mat, busy: false })
      this.systemGroup.add(mesh)
    }
    for (let i = 0; i < 8; i++) {
      this.floatPool.push({ label: new SpriteLabel(this.F, this.owner, this.systemGroup, 62), busy: false })
    }
  }

  private syncFx(): void {
    const { fx } = this.provider
    // 视图过滤（行星系视图只显示本地范围特效）
    const solar = this.viewMode === 'solar'
    const e = starPosAt(this.provider.simState.state, this.provider.planetFocusBody)
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
    const noise = this.own(this.F.createMesh(noiseGeo, this.flareNoiseMat)).object
    noise.position.y = 420
    noise.renderOrder = 70
    this.flareGroup.add(noise)
    this.flareVigMat = this.trackMat(this.F.createMeshBasicMaterial({ map: this.tex.vignette, transparent: true, opacity: 0, depthWrite: false }))
    const vig = this.own(this.F.createMesh(noiseGeo, this.flareVigMat)).object
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

  /** 依相机高度衰减标注透明度（垂直俯视下相机 y = 观察距离）；视图外天体（他系行星/卫星）标签一并隐藏 */
  private syncLabelLod(cam: THREE.Camera | null): void {
    if (!cam) return
    const dist = cam.position.y
    const subA = THREE.MathUtils.clamp((580 - dist) / 160, 0, 1)
    const inView = this.visibleBodySet()
    for (const [body, sv] of Object.entries(this.starViews)) {
      if (!sv) continue
      const show = inView.has(body)
      sv.sub.sprite.material.opacity = subA
      sv.sub.sprite.visible = show && subA > 0.02
    }
  }

  // ─── 视图分组切换（地球系 / 太阳系；ViewToggle → GameMode.setViewMode） ───

  /** 切换星图视图模式（由 GameMode.setViewMode 调用） */
  setViewMode(mode: 'earth' | 'solar'): void {
    if (this.viewMode === mode) return
    this.viewMode = mode
    this.applyViewMode()
  }

  /** 当前视图应显示的天体集合：太阳系=行星（卫星/卫星环属行星系细节，不显示）；行星系=聚焦行星 + 其卫星 */
  private visibleBodySet(): Set<string> {
    if (this.viewMode === 'solar') {
      const out = new Set<string>(Object.keys(B.map.nodes))
      for (const mid of Object.keys(B.map.moons)) out.delete(mid)
      return out
    }
    // 行星系视角聚焦的必是行星（太阳走 solar 分支）；类型上 SolarBodyId 含 sun，此处收窄
    const f = this.provider.planetFocusBody as PlanetId
    return new Set([f, ...satellitesOf(f)])
  }

  /** 应用视图分组：舞台平移（行星系搬到星空远处）+ 太阳系专属表现整组显隐 + 天体/卫星环按视图集显隐 + 站点过滤 */
  private applyViewMode(): void {
    const solar = this.viewMode === 'solar'
    const focus = this.provider.planetFocusBody as PlanetId
    // 舞台初始位移（每帧由 syncStage 按聚焦行星实时位置精调：行星钉在舞台中心，本地内容按相对几何贴放）
    const stage = solar ? { x: 0, z: 0 } : planetStageOffset(focus)
    this.stageGroup.position.set(stage.x, 0, stage.z)
    this.sunGroup.visible = solar
    // 太阳本体球是蓝图 Actor（不在 sunGroup，也不在 starViews——buildNodes 只建行星视图），行星系须单独隐藏
    const sunActor = this.provider.starActors?.get('sun')
    if (sunActor) {
      const sunMesh = sunActor.getComponent(SphereMeshComponent)
      if (sunMesh) sunMesh.obj.object.visible = solar
    }
    const inView = this.visibleBodySet()
    for (const [body, view] of Object.entries(this.starViews)) {
      if (!view) continue
      view.body.visible = inView.has(body)
    }
    // 卫星环 = 行星系内容：太阳系全景一律隐藏；行星系视角只显示聚焦行星的卫星环
    for (const [mid, mc] of Object.entries(B.map.moons)) {
      const ring = this.moonRings.get(mid)
      if (ring) ring.visible = !solar && focus === mc.parent
    }
    // 建筑视图过滤（建筑 group 归 systemGroup 常显，此处只做显隐）；
    // 入轨建筑按实时位置判定（跟随锚行星公转，落点静态坐标会漂出画幅口径）
    for (const [id, view] of this.buildingViews) {
      const ob = id.startsWith('ob') ? this.provider.simState.state.orbitBuildings.find((x) => `ob${x.id}` === id) : null
      if (ob) {
        // 轨道建筑：锚在聚焦天体系内才显示（锚 = 聚焦行星或其卫星）
        const mc = (B.map.moons as Record<string, { parent: PlanetId } | undefined>)[ob.anchor]
        view.group.visible = !solar && (ob.anchor === focus || mc?.parent === focus)
        continue
      }
      const b = this.provider.simState.state.buildings.find((x) => `b${x.id}` === id)
      if (!b) continue
      const c = starPosAt(this.provider.simState.state, focus)
      const bp = buildingPos(this.provider.simState.state, b)
      const d = Math.hypot(bp.x - c.x, bp.y - c.y)
      view.group.visible = solar || d <= EARTH_VIEW_RADIUS_PX
    }
    if (solar) {
      // 太阳系全显：复位被行星系过滤隐藏的航线 quad / 飞船 mesh / 浮字标签
      for (const q of this.routeQuads.values()) q.mesh.visible = true
      for (const s of this.shipPool) s.mesh.visible = false // 交由 syncShips 每帧重建可见性
      for (const f of this.floatPool) f.label.sprite.visible = false
    }
    logger.info(`[StarMap] 视图切换 → ${solar ? '太阳系' : `${focus} 行星系`}`)
  }

  /** 每帧过滤：航线/飞船/站点按当前视图归属显隐（位置更新照常，只裁可见性） */
  private syncViewFilter(): void {
    const solar = this.viewMode === 'solar'
    if (solar) {
      // 太阳系全景：恢复全部航线可见（地球系模式曾按地月归属隐藏）
      for (const q of this.routeQuads.values()) q.mesh.visible = true
      return
    }
    // 行星系视图：只显示两端都入画的本地航线（长跨系航线整条隐藏，不穿屏）
    const c = starPosAt(this.provider.simState.state, this.provider.planetFocusBody)
    const inEarthView = (x: number, y: number): boolean => Math.hypot(x - c.x, y - c.y) <= EARTH_VIEW_RADIUS_PX
    for (const [key, q] of this.routeQuads) {
      const id = Number(key.split(':')[0])
      const route = this.provider.simState.state.routes.find((r) => r.id === id)
      if (!route) continue
      const from = endpointPos(this.provider.simState.state, route.from)
      const to = endpointPos(this.provider.simState.state, route.to)
      q.mesh.visible = inEarthView(from.x, from.y) && inEarthView(to.x, to.y)
    }
    for (const [id, view] of this.buildingViews) {
      const ob = id.startsWith('ob') ? this.provider.simState.state.orbitBuildings.find((x) => `ob${x.id}` === id) : null
      if (ob) {
        const op = orbitBuildingPos(this.provider.simState.state, ob)
        view.group.visible = inEarthView(op.x, op.y)
        continue
      }
      const b = this.provider.simState.state.buildings.find((x) => `b${x.id}` === id)
      if (!b) continue
      const bp = buildingPos(this.provider.simState.state, b)
      view.group.visible = inEarthView(bp.x, bp.y)
    }
  }

  /**
   * 每帧舞台位移（行星系视角）：舞台 = 专属远景坐标 - 聚焦行星实时地图位置。
   * 效果 = 聚焦行星被钉在舞台中心（像太阳一样固定不公转），航线/飞船/站点/卫星环
   * 按与它的真实相对几何贴放（卫星像行星一样绕它转）；纯显示变换，仿真数据不动。
   */
  private syncStage(): void {
    if (this.viewMode === 'solar') return // 太阳系全景：舞台恒在原点（applyViewMode 已复位）
    const f = this.provider.planetFocusBody as PlanetId
    const fp = starPosAt(this.provider.simState.state, f)
    const stage = planetStageOffset(f)
    this.stageGroup.position.set(stage.x - toWX(fp.x), 0, stage.z - toWZ(fp.y))
  }

  /**
   * 建筑 → 世界 UI 标签差分（键 = 差分键 ob<id>/b<id>；拆建筑/重建视图经 disposeBuilding(同名键) release）。
   * 标签 = building_label.widget.json（UIWorldAnchor mode=world + faceCamera）：位置逐帧贴建筑世界坐标（悬浮高度 B.orbitBuild.labelHeight），billboard 朝相机。
   * 舞台补偿（2026-09-09）：世界 UI 根挂主场景、不随 stageGroup 平移，而建筑视图在 stageGroup 里 ——
   * 行星系舞台每帧平移补偿聚焦行星公转位移，标签位置必须叠加同一偏移，否则与建筑分离漂出屏。
   * 距离 LOD：相机距标签超过 B.orbitBuild.labelLodDist 整树隐藏（bActive 级联，句柄保留可恢复）。
   * 文本差分：Title 常驻，Sub 空串即清空（世界 UI Actor 复用，不反复生成销毁）。
   */
  private ensureBuildingLabel(viewKey: string, view: BuildingView, wx: number, wz: number, titleText: string, subText: string): void {
    let h: AnchoredWidgetHandle | undefined = this.labelHandles.get(viewKey)
    if (!h) {
      const spawned = this.owner.world?.ui.spawnAnchoredWidget(StarMapRenderComponent.BUILDING_LABEL_WIDGET, null, { mode: 'world', faceCamera: true })
      if (!spawned) {
        logger.warn('[StarMap] 建筑标签 widget 生成失败（building_label），本轮跳过')
        return
      }
      h = spawned
      this.labelHandles.set(viewKey, h)
    }
    const root = h.actor
    if (!root) return
    // 位置 = 建筑世界坐标 + 舞台偏移（sg 不为零时建筑真实渲染位 = 坐标 + 偏移；世界 UI 不在舞台组内须自带）
    const sg = this.stageGroup.position
    const lh = B.orbitBuild.labelHeight
    h.transform?.setPosition(wx + sg.x, lh, wz + sg.z)
    // 距离 LOD：相机与标签三维距离超过阈值隐藏整树（bActive 级联子树，差分防每帧重算祖先链）；
    // 且与建筑组可见性同源（applyViewMode/syncViewFilter 隐藏建筑组时标签一并隐藏，防孤儿悬浮标签）。
    // 距离必须含 Y：本作是垂直俯视相机，XZ 恒 ≈ 焦点半径（不随缩放变），缩放改变的只有相机高度
    const cam = this.lastCam
    if (cam) {
      const dx = cam.position.x - (wx + sg.x)
      const dy = cam.position.y - lh
      const dz = cam.position.z - (wz + sg.z)
      const want = view.group.visible && dx * dx + dy * dy + dz * dz <= B.orbitBuild.labelLodDist * B.orbitBuild.labelLodDist
      if (root.bActive !== want) root.bActive = want
    }
    const title = root.getChildren().find((c) => c.root.name === 'Title')?.getComponent(UITextComponent) ?? null
    const sub = root.getChildren().find((c) => c.root.name === 'Sub')?.getComponent(UITextComponent) ?? null
    if (title && title.text !== titleText) title.text = titleText
    if (sub) {
      if (subText) {
        if (sub.text !== subText) sub.text = subText
      } else if (sub.text) {
        sub.text = ''
      }
    }
    view.title = title
    view.sub = sub
  }

  /** 每帧同步（GameMode.Tick 驱动；dt = 真实时间；cam = 太阳系相机，用于标注 LOD / 建筑网格覆盖 / 标签距离裁剪） */
  render(dt: number, cam?: THREE.Camera | null): void {
    this.animTime += dt
    this.lastCam = cam ?? null
    this.syncStage()
    this.syncRoutes()
    this.syncShips()
    this.syncNodes()
    this.syncBuildings()
    this.syncTutorial()
    this.syncMissionLine()
    this.syncDrag()
    this.syncBoxDrag()
    this.syncBuildMode(cam ?? null)
    this.syncFx()
    this.syncFlare()
    this.syncLabelLod(cam ?? null)
    this.syncViewFilter()
  }

  /** 耀斑预警框选矩形（半透明冰蓝面片；GameMode.boxDrag 驱动，懒建常驻显隐） */
  private syncBoxDrag(): void {
    const box = this.provider.boxDrag
    if (!box) {
      if (this.boxQuad) this.boxQuad.visible = false
      return
    }
    if (!this.boxQuad) {
      const mat = this.trackMat(this.F.createMeshBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }))
      this.boxQuad = this.own(this.F.createMesh(this.flatQuadGeo, mat)).object
      this.boxQuad.position.y = 6
      this.boxQuad.renderOrder = 13
      this.systemGroup.add(this.boxQuad)
    }
    const w = Math.abs(box.x1 - box.x0)
    const h = Math.abs(box.y1 - box.y0)
    this.boxQuad.visible = w > 2 && h > 2
    this.boxQuad.position.x = toWX((box.x0 + box.x1) / 2)
    this.boxQuad.position.z = toWZ((box.y0 + box.y1) / 2)
    this.boxQuad.scale.set(w, 1, h)
  }
}

