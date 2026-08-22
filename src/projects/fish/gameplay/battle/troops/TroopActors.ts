/**
 * TroopActors — 兵种 Actor 集合（每个兵种一个 Actor 类，功能全部组件组合）
 *
 * 设计原则（组件优先 / 非必要不放基类）：
 *  - 每个兵种独立 Actor 类（extends GenericActor，显式具名），无共同基类；
 *  - 战斗功能全部由组件承载（TroopHealthComponent / TroopTargetComponent /
 *    TroopMoveComponent / TroopAttackComponent），Actor 类只做薄装配；
 *  - 兵种差异（近战/远程/飞行/偏好/数值）由 troop 配置表 + 组件内部分支表达，
 *    未来兵种专属能力（如炸弹人破墙倍伤、治疗师治疗）用专属组件扩展。
 *
 * TroopActor 接口 = 战斗 GameMode / 弹丸对兵的统一视图（类型契约，非基类）。
 * 工厂：createTroopActor(troopId, ...) 按兵种 id 实例化对应 Actor 类。
 *
 * 对象池化（完整子树复用）：
 *  - 每个兵种一个 ObjectPool（不同兵种体型/能力差异大，不共享池）；
 *  - 池对象包含完整 actor 树（mesh + collider + 战斗组件），deactivate 时只
 *    detach 脱离场景树、cleanup 物理资源、隐藏可见性，不销毁；
 *    activate 时 re-attach + restore + 显示；
 *  - mesh 从蓝图 CDO 克隆（BlueprintRegistry.resolve 取模板，不走 SpawnActor），
 *    collider 从 troop 配置表重建。
 */
import { CircleColliderComponent, GenericActor, type Actor, BlueprintRegistry } from '@/engine'
import type { ResolvedComponentDef } from '@/engine/asset/BlueprintAsset'
import { ComponentRegistry } from '@/engine/tools/ComponentRegistry'
import { ThreeObjectFactory } from '@/engine/gameflow/ThreeObjectFactory'
import type { IPoolable, ObjectPool } from '@/engine'
import type { FishLevelGameMode } from '../../level/FishLevelGameMode'
import type { TroopType } from '../../common/types'
import { TroopHealthComponent } from './TroopHealthComponent'
import { TroopTargetComponent } from './TroopTargetComponent'
import { TroopMoveComponent } from './TroopMoveComponent'
import { TroopAttackComponent } from './TroopAttackComponent'
import { TroopHealthBarComponent } from '../../common/comp/TroopHealthBarComponent'

/** 兵部署参数（acquire 时传入） */
export interface TroopDeployOptions {
  troopId: string
  gm: FishLevelGameMode
  troop: TroopType
  x: number
  z: number
}

/** 兵 Actor 公共契约（战斗 GameMode / 防御塔弹丸统一引用；无继承基类） */
export interface TroopActor extends Actor {
  /** 兵种配置（hp/dps/range/speed/preferred/flying/size 单一数据源） */
  readonly troop: TroopType
  /** 生命组件（受击/死亡，takeDamage 入口；装配函数注入） */
  health: TroopHealthComponent
}

/** 兵 Actor 基类（实现 IPoolable + TroopActor 接口，供所有兵种继承） */
export abstract class PoolableTroopActor extends GenericActor implements TroopActor, IPoolable {
  readonly troop: TroopType = null as unknown as TroopType
  abstract health: TroopHealthComponent

  pool: ObjectPool<PoolableTroopActor> | null = null
  active = false
  /** mesh 组件引用（激活时创建，复用时只 re-attach） */
  private _mesh: import('@/engine').CapsuleMeshComponent | null = null
  /** collider 组件引用（激活时创建，复用时 restore） */
  private _collider: CircleColliderComponent | null = null
  /** 是否已完成首次 assemble（复用时跳过组件创建，只 re-attach） */
  private _assembled = false

  // IPoolable
  abstract activate(opts?: TroopDeployOptions): void
  abstract deactivate(): void

  /**
   * 共享装配逻辑：
   * - 首次激活：克隆 mesh（应用蓝图 TransformComponent 偏移）+ 重建 collider + 挂战斗组件
   * - 复用激活：重置位置 + restore collider
   */
  protected _assemble(opts: TroopDeployOptions): void {
    const { gm, troop, x, z } = opts
    this.setPosition(x, troop.flying ? 2 : 0, z)

    // 首次激活：从蓝图 CDO 克隆 mesh（应用 transform 偏移）
    if (!this._assembled) {
      const cdo = BlueprintRegistry.resolve(troop.blueprint)
      const cdoTf = cdo?.components?.find(
        (c: ResolvedComponentDef) => c.baseClass === 'TransformComponent',
      )
      const cdoMesh = cdo?.components?.find(
        (c: ResolvedComponentDef) => c.baseClass === 'CapsuleMeshComponent',
      )

      if (cdoMesh) {
        const meshComp = ComponentRegistry.create(this, 'CapsuleMeshComponent', cdoMesh.properties) as import('@/engine').CapsuleMeshComponent
        if (meshComp) {
          // 应用蓝图 transform 偏移（mesh 相对 troopActor 的本地位置）
          if (cdoTf?.properties?.position) {
            const p = cdoTf.properties.position as number[]
            meshComp.mesh.position.set(p[0], p[1], p[2])
          }
          this._mesh = meshComp
          this.addComponent(meshComp)
        }
      }

      // 重建 collider（非飞行兵）
      if (!troop.flying) {
        const colliderProps: Record<string, unknown> = {
          radius: troop.size[0] / 2,
          height: 1.1,
          bodyType: 'dynamic',
          mass: 1,
          group: 'troop',
          mask: ['troop', 'building'],
        }
        const col = ComponentRegistry.create(this, 'CircleColliderComponent', colliderProps) as CircleColliderComponent
        if (col) {
          this._collider = col
          this.addComponent(col)
        }
      }

      // 战斗组件只挂一次
      this.addComponent(this.health)
      this.addComponent(TroopHealthBarComponent, troop)
      this.addComponent(TroopTargetComponent, gm, troop)
      this.addComponent(TroopMoveComponent, gm, troop)
      this.addComponent(TroopAttackComponent, gm, troop)
      this._assembled = true
    }

    // collider restore（首次激活在 addComponent 后，复用激活只做 restore）
    if (this._collider) {
      this._collider.restore()
    }

    // 复用时重置血量（首次激活时 health 已从 troop.hp 初始化，无需重置）
    this.health.resetHp()
    this.getComponent(TroopHealthBarComponent)?.onDamaged(1)

    this.enableTick()
  }

  /**
   * 共享拆卸逻辑：
   * - disableTick：停止每帧更新
   * - cleanup 战斗组件：取消订阅、停止定时器
   * - cleanup collider：注销物理、断开变换监听（组件不移除，保留在 actor 上）
   * - detach：从场景树脱离（mesh/collider 随 root 一起脱离）
   * 不销毁任何对象，下次 activate 重新 attach + restore。
   */
  protected _teardown(): void {
    this.disableTick()
    for (const comp of [...this.getAllComponents()]) {
      if ('cleanup' in comp) (comp as unknown as { cleanup: () => void }).cleanup()
    }
    // collider cleanup 已由上面循环处理，这里只 detach
    this.detach()
  }
}

// ─── 兵种 Actor 子类（每个兵种一个类）──────────────────────────────────────

/** 工厂：创建池化兵种 Actor 子类 */
function makeTroopClass(): new () => PoolableTroopActor {
  return class extends PoolableTroopActor {
    declare health: TroopHealthComponent

    activate(opts?: TroopDeployOptions): void {
      this.active = true
      ;(this as unknown as { troop: TroopType }).troop = opts!.troop
      this.health = new TroopHealthComponent(this, opts!.gm, opts!.troop)
      this._assemble(opts!)
    }

    deactivate(): void {
      this.active = false
      this._teardown()
    }
  }
}

/** 野蛮人 — 近战肉搏，数量取胜的炮灰（preferred any） */
export const BarbarianActor = makeTroopClass()
/** 弓箭手 — 远程输出，可攻击空中目标（preferred any） */
export const ArcherActor = makeTroopClass()
/** 哥布林 — 移速极快，优先攻击资源建筑（preferred resources） */
export const GoblinActor = makeTroopClass()
/** 巨人 — 高血量坦克，优先攻击防御建筑（preferred defenses） */
export const GiantActor = makeTroopClass()
/** 炸弹人 — 自爆式破墙单位（preferred walls） */
export const WallBreakerActor = makeTroopClass()
/** 气球兵 — 飞行投弹，优先攻击防御建筑（flying，preferred defenses） */
export const BalloonActor = makeTroopClass()
/** 法师 — 高伤害远程，可攻击空中目标（preferred any） */
export const WizardActor = makeTroopClass()
/** 治疗师 — 飞行治疗单位（dps=0 不攻击，专属治疗逻辑后续用组件扩展） */
export const HealerActor = makeTroopClass()
/** 飞龙 — 空中重火力，喷吐火焰攻击（flying，preferred any） */
export const DragonActor = makeTroopClass()
/** 皮卡超人 — 重装近战，剑刃劈砍一切（preferred any） */
export const PekkaActor = makeTroopClass()

/** 兵种 id → Actor 类 */
export const TROOP_ACTOR_CLASSES: Record<string, new () => PoolableTroopActor> = {
  barbarian: BarbarianActor,
  archer: ArcherActor,
  goblin: GoblinActor,
  giant: GiantActor,
  wallBreaker: WallBreakerActor,
  balloon: BalloonActor,
  wizard: WizardActor,
  healer: HealerActor,
  dragon: DragonActor,
  pekka: PekkaActor,
}
