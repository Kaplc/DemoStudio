/**
 * SpellCaster — 法术施放器（战斗法术系统核心）
 *
 * 战斗 HUD 法术卡 → selectSpell（落点模式）→ 屏幕点击 castAtScreen：
 *  1. 扣药水（ResourcesComponent，即扣即用；不足则施放失败并提示）
 *  2. 生成落点效果：
 *     - damage：对半径内敌方建筑立即扣血
 *     - heal：对半径内友军兵立即恢复
 *     - rage：生成光环 Actor，持续时间内对半径内友军攻速/移速增益
 *  3. 次数约束由药水扣减天然承载，卡片置灰由 HUD 查询钱包
 *
 * 法术不受防御攻击、不参与兵 AI（doc 边界条件）；落点不限制在战场内。
 */
import * as THREE from 'three'
import { GenericActor, ActorComponent, PhySys, spawnActor, logger } from '@/engine'
import { createMesh, createMeshBasicMaterial, createRingGeometry } from '@/engine/gameflow/ThreeObjectUtils'
import { RageAuraComponent } from './troops/AbilityComponents'
import type { FishLevelGameMode } from '../level/FishLevelGameMode'
import type { FishGameInstance } from '../FishGameInstance'
import type { SpellType } from '../common/types'

/** 地面求交平面（y=0） */
const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

export class SpellCaster {
  /** 当前选择的法术 id（null = 未进入落点模式） */
  selectedSpellId: string | null = null
  /** 战斗 GameMode（施放效果落地） */
  private gm: FishLevelGameMode | null = null
  /** GameInstance（资源扣费 + 法术表 + 统计上报） */
  private inst: FishGameInstance | null = null
  /** 本场已施放次数（调试桥快照用） */
  private castCount = 0

  /** 初始化（战斗 BeginPlay 调用） */
  init(gm: FishLevelGameMode, inst: FishGameInstance | null): void {
    this.gm = gm
    this.inst = inst
    this.selectedSpellId = null
    this.castCount = 0
    logger.info('[SpellCaster] 法术系统已初始化')
  }

  /** 销毁（EndPlay 清引用） */
  dispose(): void {
    this.gm = null
    this.inst = null
    this.selectedSpellId = null
  }

  /** 法术表数据（HUD 卡片渲染；表未加载返回空） */
  getSpellList(): Array<{ id: string, spell: SpellType }> {
    const table = this.inst?.getSpellTable()
    if (!table) return []
    return table.getRowNames().map((id) => ({ id, spell: table.getRow(id)! })).filter((x) => x.spell)
  }

  /** 当前钱包药水（卡片置灰/次数展示） */
  get elixir(): number {
    return this.inst?.resources.get('elixir') ?? 0
  }

  /** 本场已施放次数 */
  get casts(): number {
    return this.castCount
  }

  /** 选择法术卡（再次点击同卡取消） */
  selectSpell(spellId: string): void {
    if (this.selectedSpellId === spellId) {
      this.selectedSpellId = null
      logger.info('[SpellCaster] 取消法术落点模式')
      return
    }
    this.selectedSpellId = spellId
    logger.info(`[SpellCaster] 进入法术落点模式: ${spellId}`)
  }

  /** 屏幕坐标施放（战斗 GameMode.onScreenDown 优先转发） */
  castAtScreen(sx: number, sy: number): boolean {
    if (!this.gm || !this.inst || !this.selectedSpellId) return false
    const raycaster = PhySys.screenToRay(sx, sy)
    if (!raycaster) return false
    const hit = new THREE.Vector3()
    raycaster.ray.intersectPlane(GROUND_PLANE, hit)
    return this.castAtWorld(hit.x, hit.z)
  }

  /** 世界坐标施放（调试桥用） */
  castAtWorld(x: number, z: number): boolean {
    if (!this.gm || !this.inst || !this.selectedSpellId) return false
    const spell = this.inst.getSpell(this.selectedSpellId)
    if (!spell) {
      logger.warn(`[SpellCaster] 施放失败：法术 "${this.selectedSpellId}" 不存在`)
      return false
    }
    // 扣药水（同事务：先校验后扣减，失败不产生任何状态变化）
    if (!this.inst.resources.spend('elixir', spell.cost)) {
      logger.warn(`[SpellCaster] 施放失败：药水不足（需 ${spell.cost}，余 ${this.inst.resources.get('elixir')}）`)
      return false
    }
    const w = this.gm.world
    if (!w) return false
    logger.info(`[SpellCaster] 施放 ${spell.name} @ (${x.toFixed(1)},${z.toFixed(1)})（-${spell.cost} 药水）`)
    switch (spell.effect) {
      case 'damage': this.castDamage(spell, x, z); break
      case 'heal': this.castHeal(spell, x, z); break
      case 'rage': this.castRage(spell, x, z); break
    }
    this.castCount++
    this.inst.progression.report('spellCasts', 1)
    // 施放后退出落点模式（一次性消耗）
    this.selectedSpellId = null
    return true
  }

  /** 火球：范围伤害（作用建筑；法术不受防御攻击，只读 buildings 血表） */
  private castDamage(spell: SpellType, x: number, z: number): void {
    const gm = this.gm!
    for (const b of [...gm.buildings]) {
      const c = gm.buildingCenter(b)
      const d = Math.hypot(c.x - x, c.z - z)
      if (d <= spell.radius) gm.damageBuilding(b, spell.value)
    }
  }

  /** 治疗：范围回复友军（不溢出上限，heal 内部 clamp） */
  private castHeal(spell: SpellType, x: number, z: number): void {
    const gm = this.gm!
    for (const t of gm.troops) {
      if (t.health.isDead) continue
      const d = Math.hypot(t.root.position.x - x, t.root.position.z - z)
      if (d <= spell.radius) t.health.heal(spell.value)
    }
  }

  /** 狂暴：光环 Actor（RingMesh 标记范围 + RageAuraComponent 驱动增益） */
  private castRage(spell: SpellType, x: number, z: number): void {
    const aura = new GenericActor('SpellRageAura')
    const geo = createRingGeometry(spell.radius, spell.radius + 0.15, 32)
    const mat = createMeshBasicMaterial({ color: typeof spell.color === 'number' ? spell.color : 0xff7043, transparent: true, opacity: 0.6 })
    const mesh = createMesh(geo, mat)
    mesh.object.rotation.x = -Math.PI / 2
    mesh.object.position.y = 0.2
    aura.addComponent(RageAuraMarker, mesh.object)
    aura.addComponent(RageAuraComponent, this.gm!, spell.radius, spell.value, spell.duration)
    aura.setPosition(x, 0, z)
    spawnActor(aura)
    logger.info(`[SpellCaster] 狂暴光环: 半径 ${spell.radius}，×${spell.value}，持续 ${spell.duration}s`)
  }
}

/** 光环可视组件（RingMesh 挂载；EndPlay 释放 GPU 资源，对齐"组件 EndPlay 释放"纪律） */
class RageAuraMarker extends ActorComponent {
  constructor(owner: GenericActor, private readonly mesh: THREE.Mesh) {
    super(owner)
    this.name = 'RageAuraMarker'
    owner.root.add(mesh)
  }

  override EndPlay(): void {
    this.mesh.geometry?.dispose()
    const mat = this.mesh.material
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
    else mat?.dispose()
    this.mesh.removeFromParent()
    super.EndPlay()
  }
}
