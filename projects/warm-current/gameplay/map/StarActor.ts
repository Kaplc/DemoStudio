/**
 * StarActor — 星图天体蓝图 Actor（blueprint baseClass）
 *
 * 每个天体一个类（fish 建筑同构：类名 = ActorRegistry key = 蓝图 baseClass），
 * 蓝图负责外观（SphereMeshComponent + 贴图），本类只负责两件事：
 *  1. 位置自驱动：syncFrom(simState, dt, viewMode, focus) —— 位置 = hiddenActorIsolated
 *     纯函数（太阳系全景正常公转；行星系视角非本系天体 Actor 移到远景隔离点，
 *     与渲染层 visibleBodySet 隐藏口径一致，点击判定收口真实 Actor 位置）
 *  2. 自转：mesh.rotation.y 累计（dt 直接累加，1 rad/s）
 *
 * 渲染组件（StarMapRenderComponent）仍持有 starViews 的标签/窗口环/选中态等
 * 表现层，星球 mesh 的位置更新让位给本类（每帧 syncFrom）。
 *
 * 工厂语义：SpriteLabel/windowRing 等表现附件由渲染组件创建；Actor 本体只带
 * Transform + SphereMesh（蓝图），GameMode BeginPlay 经 BlueprintAsset.Instantiate
 * 生成。位置/半径不写在蓝图（半径在 star_map 配置，位置每帧算），蓝图只定外观。
 */
import * as THREE from 'three'
import { Actor, SphereMeshComponent, logger } from '@/engine'
import { makeEarthBumpTexture, applyEarthOceanRoughness } from './starTextures'
import { B } from '../core/balance'
import { hiddenActorIsolated } from '../core/helpers'
import type { PlanetId } from '../core/types'
import type { SimState } from '../core/types'

export abstract class StarActor extends Actor {
  /** 自转速率（rad/s 表现值，非仿真数值，不进 balance） */
  private static readonly SPIN_RATE = 1
  /** 轴倾角（rad，~23° 地球倾角；俯视相机不再正对极轴——特写看到中纬度而非云图极区浓带） */
  private static readonly AXIAL_TILT = 0.4
  /** 自转累计（rad） */
  private spin = 0

  constructor(name: string) {
    super(name)
    // 倾角挂在 Actor root：本体 mesh / 云层壳 / 大气壳都是 root 子节点，整体倾斜后
    // 各自的 rotation.y 自转仍是绕（倾斜后的）自身极轴
    this.root.rotation.x = StarActor.AXIAL_TILT
    // Actor 默认不参与 World Tick 循环（_bTickEnabled=false）——不开 Tick 的话
    // 云层壳的自转/UV 漂移（CloudLayerComponent.Tick）永远不会执行（实测坑：云静止）
    this.enableTick()
  }

  /** 特写增强装配点（子类覆写）：BeginPlay 时挂大气/bump 等，通用天体默认无 */
  protected setupCloseup(): void {}

  override BeginPlay(): void {
    super.BeginPlay()
    this.setupCloseup()
  }

  /**
   * 位置自驱动（GameMode 每帧调用）：位置 = hiddenActorIsolated 隔离点纯函数。
   * 太阳系（solar）= starPosAt 实时公转位置；行星系（earth）视角下聚焦行星 + 其卫星
   * 正常跟随舞台，其余天体 Actor 本体移到远景隔离点（布局锚方位 × 12000，远超相机
   * panLimit 9000 → 物理不可点）。viewMode/focus 由 GameMode 决策层传入，
   * 本类只忠实执行（隐藏 = 谁 Actor 被甩远景）。
   * sync 跳过重置跳变：sim.restart 时位置可能大角度跳变，
   * 直接按 teleport 处理（无补间，重开一局跳变符合预期）。
   */
  syncFrom(sim: SimState, dt: number, viewMode: 'solar' | 'earth' = 'solar', focus: PlanetId = 'earth'): void {
    const iso = hiddenActorIsolated(sim, this.body, viewMode, focus)
    const r = B.map.nodes[this.body as 'sun'].r
    this.setPosition(iso.x, r * 0.55, iso.z)
    this.spin += dt * StarActor.SPIN_RATE
    const mesh = this.getComponent(SphereMeshComponent)
    if (mesh) mesh.obj.object.rotation.y = this.spin
    else logger.warn(`[StarActor] ${this.name} 缺少 SphereMeshComponent（蓝图未声明？）`)
  }

  /** 天体 id（子类实现） */
  protected abstract get body(): keyof typeof B.map.nodes

  /** 测试口：取 mesh（无则 null） */
  get meshForTest(): THREE.Mesh | null {
    return this.getComponent(SphereMeshComponent)?.obj.object ?? null
  }
}

export class SunActor extends StarActor {
  constructor() { super('Sun') }
  protected get body(): keyof typeof B.map.nodes { return 'sun' }
}

export class EarthActor extends StarActor {
  constructor() { super('Earth') }
  protected get body(): keyof typeof B.map.nodes { return 'earth' }

  /**
   * 地球特写增强装配点（观察模式观感）：地形 bumpMap + 海洋 PBR 高光。
   * 大气辉光壳与云层壳均为蓝图资产声明（资产挂组件，2026-09-10 大气 / 2026-09-12 云层）：
   * earth.blueprint.json 显式挂 AtmosphereComponent + CloudLayerComponent（参数在
   * Inspector 调整后随资产保存），运行时不再硬编码挂载——运行时挂载与蓝图保存的
   * 全量写回撞车会双实例叠光（组件重复告警）。其他天体未声明 = 无大气/云层。
   * 夜面城市灯光已按用户要求移除（2026-09-10）：emissive 灯点在游戏环境光下不随昼夜
   * 变暗，观察视角总读作脏点。
   * 海洋高光（2026-09-12）：applyEarthOceanRoughness 从真实 albedo 派生海洋/陆地
   * 粗糙度分区——向阳海面出 GGX 镜面高光，陆地保持哑光（异步解码后挂材质）。
   */
  protected override setupCloseup(): void {
    const mesh = this.getComponent(SphereMeshComponent)
    if (!mesh) {
      logger.warn('[StarActor] Earth 缺少 SphereMeshComponent，bump 贴图跳过')
      return
    }
    const bump = makeEarthBumpTexture()
    if (bump) {
      mesh.setBumpMap(bump)
      mesh.bumpScale = 0.06
    }
    applyEarthOceanRoughness(mesh)
    logger.info('[StarActor] Earth 特写增强装配完成（bump + 海洋粗糙度；大气/云层由蓝图声明）')
  }
}

export class MoonActor extends StarActor {
  constructor() { super('Moon') }
  protected get body(): keyof typeof B.map.nodes { return 'moon' }
}

export class EuropaActor extends StarActor {
  constructor() { super('Europa') }
  protected get body(): keyof typeof B.map.nodes { return 'europa' }
}

export class MarsActor extends StarActor {
  constructor() { super('Mars') }
  protected get body(): keyof typeof B.map.nodes { return 'mars' }
}

export class MercuryActor extends StarActor {
  constructor() { super('Mercury') }
  protected get body(): keyof typeof B.map.nodes { return 'mercury' }
}

export class VenusActor extends StarActor {
  constructor() { super('Venus') }
  protected get body(): keyof typeof B.map.nodes { return 'venus' }
}

export class JupiterActor extends StarActor {
  constructor() { super('Jupiter') }
  protected get body(): keyof typeof B.map.nodes { return 'jupiter' }
}

export class SaturnActor extends StarActor {
  constructor() { super('Saturn') }
  protected get body(): keyof typeof B.map.nodes { return 'saturn' }
}

export class UranusActor extends StarActor {
  constructor() { super('Uranus') }
  protected get body(): keyof typeof B.map.nodes { return 'uranus' }
}

export class NeptuneActor extends StarActor {
  constructor() { super('Neptune') }
  protected get body(): keyof typeof B.map.nodes { return 'neptune' }
}

/** 天体 → 蓝图资产路径（GameMode BeginPlay 生成用；新增天体 = 新蓝图 + 本表一行） */
export const STAR_BLUEPRINTS = {
  sun: 'asset/blueprints/stars/sun.blueprint.json',
  mercury: 'asset/blueprints/stars/mercury.blueprint.json',
  venus: 'asset/blueprints/stars/venus.blueprint.json',
  earth: 'asset/blueprints/stars/earth.blueprint.json',
  moon: 'asset/blueprints/stars/moon.blueprint.json',
  mars: 'asset/blueprints/stars/mars.blueprint.json',
  jupiter: 'asset/blueprints/stars/jupiter.blueprint.json',
  europa: 'asset/blueprints/stars/europa.blueprint.json',
  saturn: 'asset/blueprints/stars/saturn.blueprint.json',
  uranus: 'asset/blueprints/stars/uranus.blueprint.json',
  neptune: 'asset/blueprints/stars/neptune.blueprint.json',
} as const

/** 天体 id（STAR_BLUEPRINTS 键） */
export type StarBodyId = keyof typeof STAR_BLUEPRINTS
