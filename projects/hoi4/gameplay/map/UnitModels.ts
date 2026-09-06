/**
 * UnitModels — 地图 3D 兵模渲染（unit_model 图层）
 *
 * 每个师一个低多边形模型组（士兵/卡车/火炮/坦克，类型由编制主导兵种决定，
 * 见 unitModelType.ts），国家色着色，摆在师所在省中心；行军中沿省间线段
 * 按 moveProgress 插值并朝向行军方向；玩家选中的师脚下显示光环。
 *
 * 资源策略：几何体全类型共享（工厂创建一次），材质按 (国家, 部位) 缓存；
 * 实体只持有 Group 引用，销毁仅摘子树，无逐实体 GPU 资源。
 * sync() 做增量 diff（增删师/换编制），tick(dt) 每帧只更新变换。
 */
import * as THREE from 'three'
import { GenericActor, logger } from '@/engine'
import type { ThreeFactoryComponent } from '@/engine'
import type { Hoi4GameMode } from '../base/Hoi4GameMode'
import type { Division, TemplateDef } from '../core/types'
import type { MapData } from '../core/MapData'
import { divisionModelType, type UnitModelType } from './unitModelType'

/** 选中光环色（与省高亮 0xffe082 同色系） */
const RING_COLOR = 0xffe082
/** 同省多师环形散布：黄金角，id 决定槽位（确定性，diff 后不跳位） */
const GOLDEN_ANGLE = 2.399963
const STACK_RADIUS = 1.5
/** 行军纵向错开半径（避免同段行军的多师完全重叠） */
const MARCH_RADIUS = 0.55
/** 变换平滑系数（帧率无关阻尼） */
const SMOOTH = 6

interface ModelEntity {
  group: THREE.Group
  type: UnitModelType
  tag: string
}

export class UnitModels {
  private mode: Hoi4GameMode
  private entities = new Map<number, ModelEntity>()
  /** 场景根（自带锚点 Actor，EndPlay 统一销毁） */
  private anchor: GenericActor | null = null
  private root: THREE.Group | null = null
  /** 共享几何体（按部位名；工厂创建，随 World 释放） */
  private geo = new Map<string, THREE.BufferGeometry>()
  /** 材质缓存：'tag|body' / 'tag|hi'；dark 全局共享 */
  private mats = new Map<string, THREE.MeshStandardMaterial>()
  private darkMat: THREE.MeshStandardMaterial | null = null
  private ringMat: THREE.MeshBasicMaterial | null = null

  constructor(mode: Hoi4GameMode) {
    this.mode = mode
  }

  destroyAll(): void {
    const world = this.mode.world
    for (const e of this.entities.values()) e.group.removeFromParent()
    this.entities.clear()
    this.root = null
    for (const m of this.mats.values()) m.dispose()
    this.mats.clear()
    this.darkMat?.dispose()
    this.darkMat = null
    this.ringMat?.dispose()
    this.ringMat = null
    this.geo.clear()
    if (this.anchor) {
      world?.actorMgr.DestroyActor(this.anchor)
      this.anchor = null
    }
  }

  // ═══════════════ 增量同步 ═══════════════

  /** 师集合 diff（小时 tick / 命令后 / 读档后调用） */
  sync(): void {
    const state = this.mode.coreState
    if (!state || !this.ensureRoot()) return
    const battalions = this.mode.getTables().battalions
    const seen = new Set<number>()
    for (const d of Object.values(state.divisions)) {
      seen.add(d.id)
      const type = divisionModelType(this.resolveTemplate(d), battalions)
      let e = this.entities.get(d.id)
      if (e && (e.tag !== d.owner || e.type !== type)) {
        e.group.removeFromParent()
        this.entities.delete(d.id)
        e = undefined
      }
      if (!e) e = this.createEntity(d, type)
    }
    for (const [id, e] of [...this.entities]) {
      if (!seen.has(id)) {
        e.group.removeFromParent()
        this.entities.delete(id)
      }
    }
  }

  /** 每帧：行军插值 + 朝向 + 选中光环（只动变换，不动资源） */
  tick(dt: number): void {
    if (this.entities.size === 0 || !this.mode.coreState) return
    const map = this.mode.map
    const selected = this.mode.selectedDivisions
    const k = 1 - Math.exp(-SMOOTH * dt)
    for (const [id, e] of this.entities) {
      const d = this.mode.coreState.divisions[String(id)]
      if (!d) continue
      const target = this.divisionPos(map, d)
      e.group.position.lerp(target, k)
      const rot = this.divisionRotY(map, d)
      e.group.rotation.y = stepAngle(e.group.rotation.y, rot, k)
      const ring = e.group.getObjectByName('sel_ring')
      if (ring) ring.visible = selected.has(String(id))
    }
  }

  // ═══════════════ 位置与朝向 ═══════════════

  /** 师当前世界坐标：行军中沿省间线段按 moveProgress 插值，否则省中心环形散布 */
  private divisionPos(map: MapData, d: Division): THREE.Vector3 {
    const cur = map.provinceWorldPos(d.province)
    if (!cur) return new THREE.Vector3()
    const out = new THREE.Vector3(cur.x, 0, cur.z)
    if (d.path.length > 0 && d.battle === 0) {
      const next = map.provinceWorldPos(d.path[0])
      if (next) {
        const need = map.moveHours(d.path[0])
        const f = need > 0 ? Math.min(1, d.moveProgress / need) : 0
        out.x += (next.x - cur.x) * f
        out.z += (next.z - cur.z) * f
        // 行军横向错开（垂直于行进方向）
        const len = Math.hypot(next.x - cur.x, next.z - cur.z)
        if (len > 0.001) {
          const px = (-(next.z - cur.z) / len) * MARCH_RADIUS
          const pz = ((next.x - cur.x) / len) * MARCH_RADIUS
          const s = slotOffset(d.id)
          out.x += px * s
          out.z += pz * s
        }
        return out
      }
    }
    const a = d.id * GOLDEN_ANGLE
    out.x += Math.cos(a) * STACK_RADIUS
    out.z += Math.sin(a) * STACK_RADIUS
    return out
  }

  /** 朝向：行军中面向下一省，静止面向地图下方（+z） */
  private divisionRotY(map: MapData, d: Division): number {
    if (d.path.length > 0 && d.battle === 0) {
      const cur = map.provinceWorldPos(d.province)
      const next = map.provinceWorldPos(d.path[0])
      if (cur && next && (next.x !== cur.x || next.z !== cur.z)) {
        return Math.atan2(next.x - cur.x, next.z - cur.z)
      }
    }
    return 0
  }

  // ═══════════════ 实体构建 ═══════════════

  /** 师模板解析：出厂表优先，自定义编制（设计器保存）按属主国回查 */
  private resolveTemplate(d: Division): TemplateDef {
    const tables = this.mode.getTables()
    return tables.templates[d.template]
      ?? this.mode.coreState?.countries[d.owner]?.customTemplates[d.template]
      ?? { name: d.template, battalions: { infantry: 1 }, supports: [] }
  }

  private createEntity(d: Division, type: UnitModelType): ModelEntity {
    const factory = this.mode.world!.factory
    const groupObj = factory.createGroup()
    const group = groupObj.object
    this.buildModel(group, type, d.owner)
    const scale = type === 'medium_armor' ? 1.12 : type === 'light_armor' ? 0.92 : 1
    group.scale.setScalar(scale)
    // 选中光环（每实体一个 mesh，共享几何/材质；默认隐藏）
    const ring = factory.createMesh(this.geoGet('ring'), this.ringMaterial())
    ring.object.name = 'sel_ring'
    ring.object.rotation.x = -Math.PI / 2
    ring.object.position.y = 0.06
    ring.object.visible = false
    group.add(ring.object)
    this.root!.add(group)
    const e: ModelEntity = { group, type, tag: d.owner }
    this.entities.set(d.id, e)
    return e
  }

  /** 组装各兵种模型（局部 +z 为前进方向） */
  private buildModel(group: THREE.Group, type: UnitModelType, tag: string): void {
    const factory = this.mode.world!.factory
    const body = this.tagMaterial(tag, 'body')
    const hi = this.tagMaterial(tag, 'hi')
    const dark = this.darkMaterial()
    const add = (geoName: string, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = factory.createMesh(this.geoGet(geoName), mat)
      m.object.position.set(x, y, z)
      group.add(m.object)
    }
    if (type === 'infantry') {
      add('base', dark, 0, 0.05, 0)
      add('soldierBody', body, 0, 0.72, 0)
      add('soldierHead', hi, 0, 1.42, 0)
      add('rifle', dark, 0.26, 0.85, 0.18)
    } else if (type === 'motorized') {
      add('truckBed', body, 0, 0.62, -0.3)
      add('truckCab', hi, 0, 0.66, 0.72)
      add('wheel', dark, 0.52, 0.22, 0.68)
      add('wheel', dark, -0.52, 0.22, 0.68)
      add('wheel', dark, 0.52, 0.22, -0.62)
      add('wheel', dark, -0.52, 0.22, -0.62)
    } else if (type === 'artillery') {
      add('base', dark, 0, 0.05, 0)
      add('atTrail', dark, 0, 0.26, -0.68)
      add('atWheel', dark, 0.56, 0.3, 0.16)
      add('atWheel', dark, -0.56, 0.3, 0.16)
      add('atShield', body, 0, 0.78, 0.3)
      add('atBarrel', dark, 0, 0.88, 0.98)
    } else {
      // light/medium_armor 共用坦克形体，靠组缩放区分大小
      add('tankTrack', dark, 0.6, 0.28, 0)
      add('tankTrack', dark, -0.6, 0.28, 0)
      add('tankHull', body, 0, 0.66, 0)
      add('tankTurret', hi, 0, 1.06, -0.12)
      add('tankBarrel', dark, 0, 1.1, 0.82)
    }
  }

  // ═══════════════ 资源（懒建共享） ═══════════════

  private ensureRoot(): boolean {
    if (this.root) return true
    const world = this.mode.world
    const factory = world?.factory
    if (!world || !factory) return false
    this.anchor = new GenericActor('Hoi4UnitModelRoot')
    world.actorMgr.SpawnActor(this.anchor)
    this.root = factory.createGroup().object
    this.anchor.root.add(this.root)
    this.buildSharedGeometries(factory)
    logger.info('[UnitModels] 兵模图层就绪')
    return true
  }

  private buildSharedGeometries(factory: ThreeFactoryComponent): void {
    this.geo.set('base', factory.createBoxGeometry(1.05, 0.1, 1.05))
    this.geo.set('soldierBody', factory.createCapsuleGeometry(0.26, 0.55, 4, 10))
    this.geo.set('soldierHead', factory.createSphereGeometry(0.2, 10, 8))
    this.geo.set('rifle', factory.createBoxGeometry(0.08, 0.08, 1.15))
    this.geo.set('truckBed', factory.createBoxGeometry(0.95, 0.5, 1.35))
    this.geo.set('truckCab', factory.createBoxGeometry(0.9, 0.56, 0.6))
    this.geo.set('wheel', factory.createBoxGeometry(0.16, 0.36, 0.36))
    this.geo.set('atTrail', factory.createBoxGeometry(0.18, 0.16, 1.5))
    this.geo.set('atWheel', factory.createBoxGeometry(0.14, 0.52, 0.52))
    this.geo.set('atShield', factory.createBoxGeometry(0.95, 0.62, 0.12))
    this.geo.set('atBarrel', factory.createBoxGeometry(0.12, 0.12, 1.5))
    this.geo.set('tankTrack', factory.createBoxGeometry(0.36, 0.42, 2.25))
    this.geo.set('tankHull', factory.createBoxGeometry(1.0, 0.44, 2.05))
    this.geo.set('tankTurret', factory.createBoxGeometry(0.68, 0.38, 0.95))
    this.geo.set('tankBarrel', factory.createBoxGeometry(0.14, 0.14, 1.35))
    this.geo.set('ring', factory.createRingGeometry(0.62, 0.92, 28))
  }

  private geoGet(name: string): THREE.BufferGeometry {
    const g = this.geo.get(name)
    if (!g) throw new Error(`[UnitModels] 未知几何体: ${name}`)
    return g
  }

  private tagMaterial(tag: string, role: 'body' | 'hi'): THREE.MeshStandardMaterial {
    const key = `${tag}|${role}`
    let m = this.mats.get(key)
    if (m) return m
    const def = this.mode.getTables().countries[tag]
    const color = new THREE.Color(def?.color ?? '#888888')
    if (role === 'hi') color.multiplyScalar(1.25)
    else color.multiplyScalar(0.85)
    m = this.mode.world!.factory.createMeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05 })
    this.mats.set(key, m)
    return m
  }

  private darkMaterial(): THREE.MeshStandardMaterial {
    if (!this.darkMat) {
      this.darkMat = this.mode.world!.factory.createMeshStandardMaterial({ color: 0x2b2e35, roughness: 0.95 })
    }
    return this.darkMat
  }

  private ringMaterial(): THREE.MeshBasicMaterial {
    if (!this.ringMat) {
      this.ringMat = this.mode.world!.factory.createMeshBasicMaterial({ color: RING_COLOR, transparent: true, opacity: 0.95, side: THREE.DoubleSide })
    }
    return this.ringMat
  }
}

/** 黄金角槽位：id → -1/1 侧偏（行军错开用） */
function slotOffset(id: number): number {
  return (id % 2 === 0 ? 1 : -1) * (0.6 + ((id * 7) % 10) / 10 * 0.4)
}

/** 角度插值（最短弧） */
function stepAngle(cur: number, target: number, k: number): number {
  let diff = (target - cur) % (Math.PI * 2)
  if (diff > Math.PI) diff -= Math.PI * 2
  if (diff < -Math.PI) diff += Math.PI * 2
  return cur + diff * k
}
