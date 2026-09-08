/**
 * StarActor — 星图天体蓝图 Actor（blueprint baseClass）
 *
 * 每个天体一个类（fish 建筑同构：类名 = ActorRegistry key = 蓝图 baseClass），
 * 蓝图负责外观（SphereMeshComponent + 贴图），本类只负责两件事：
 *  1. 位置自驱动：syncFrom(simState, dt) —— 位置 = starPosAt 纯函数（行星绕太阳，
 *     月球绕地球），地图系 → 世界系换算 + 半球嵌入地面（y = r*0.55，与旧渲染一致）
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
import { B, MAP_H, MAP_W } from '../core/balance'
import { starPosAt } from '../core/helpers'
import type { SimState } from '../core/types'

export abstract class StarActor extends Actor {
  /** 自转速率（rad/s 表现值，非仿真数值，不进 balance） */
  private static readonly SPIN_RATE = 1
  /** 自转累计（rad） */
  private spin = 0

  constructor(name: string) {
    super(name)
  }

  /**
   * 位置自驱动（GameMode 每帧调用）：位置 = starPosAt(state, body)，
   * 半径与 y 偏移读 star_map 配置（r 变化 → 视觉实时跟随）。
   * ox/oz = 行星系舞台偏移（舞台 = 太阳位/世界原点；行星系视图非零：聚焦行星钉在舞台中心，
   * 其余天体按与它的真实相对位置贴放；太阳系视图恒 0）。
   * sync 跳过重置跳变：sim.restart 时 starPosAt 可能大角度跳变，
   * 直接按 teleport 处理（无补间，重开一局跳变符合预期）。
   */
  syncFrom(sim: SimState, dt: number, ox = 0, oz = 0): void {
    const pos = starPosAt(sim, this.body)
    const r = B.map.nodes[this.body as 'sun'].r
    this.setPosition(pos.x - MAP_W / 2 + ox, r * 0.55, pos.y - MAP_H / 2 + oz)
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
