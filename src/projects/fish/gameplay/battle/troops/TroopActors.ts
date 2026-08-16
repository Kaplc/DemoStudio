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
 */
import { GenericActor, logger, type Actor } from '@/engine'
import type { FishLevelGameMode } from '../../level/FishLevelGameMode'
import type { TroopType } from '../../common/types'
import { TroopHealthComponent } from './TroopHealthComponent'
import { TroopTargetComponent } from './TroopTargetComponent'
import { TroopMoveComponent } from './TroopMoveComponent'
import { TroopAttackComponent } from './TroopAttackComponent'

/** 兵 Actor 公共契约（战斗 GameMode / 防御塔弹丸统一引用；无继承基类） */
export interface TroopActor extends Actor {
  /** 兵种配置（hp/dps/range/speed/preferred/flying/size 单一数据源） */
  readonly troop: TroopType
  /** 生命组件（受击/死亡，takeDamage 入口；装配函数注入） */
  health: TroopHealthComponent
}

/** 兵种 Actor 构造签名（工厂统一实例化） */
type TroopCtor = new (gm: FishLevelGameMode, troop: TroopType, x: number, z: number, modelActor: Actor) => TroopActor

/**
 * 共享装配：所有兵种 Actor 类构造调用 —— 建模型（attachTo 挂树随兵销毁）、
 * 定位（飞行兵悬空）、挂组件组合。装配差异由 troop 配置驱动，无需分叉。
 */
function assembleTroop(
  actor: TroopActor,
  gm: FishLevelGameMode,
  troop: TroopType,
  x: number,
  z: number,
  modelActor: Actor,
): void {
  actor.setPosition(x, troop.flying ? 2 : 0, z)
  // 蓝图模型（GameMode 部署时已 SpawnActorFromBlueprint 实例化）：挂到兵下，随兵销毁释放
  modelActor.attachTo(actor)
  // 功能组件组合：生命（受击/死亡）→ 索敌（目标输出）→ 移动（寻路/阻挡）→ 攻击（节奏/开火）
  actor.health = new TroopHealthComponent(actor, gm, troop)
  ;(actor as GenericActor).addComponent(actor.health)
  ;(actor as GenericActor).addComponent(TroopTargetComponent, gm, troop)
  ;(actor as GenericActor).addComponent(TroopMoveComponent, gm, troop)
  ;(actor as GenericActor).addComponent(TroopAttackComponent, gm, troop)
}

/** 部署日志（BeginPlay 共享输出，class 名标识兵种 Actor 类） */
function logTroopDeployed(actor: TroopActor, className: string): void {
  logger.info(
    `[Battle] 兵部署: ${actor.troop.name} @ (${actor.root.position.x.toFixed(1)}, ${actor.root.position.z.toFixed(1)}) ` +
      `hp=${actor.health.hp} flying=${actor.troop.flying} 模型蓝图=${actor.troop.blueprint}（${className}）`,
  )
}

/** 野蛮人 — 近战肉搏，数量取胜的炮灰（preferred any） */
export class BarbarianActor extends GenericActor implements TroopActor {
  readonly troop: TroopType
  health!: TroopHealthComponent
  constructor(gm: FishLevelGameMode, troop: TroopType, x: number, z: number, modelActor: Actor) {
    super('BattleTroop_barbarian')
    this.troop = troop
    assembleTroop(this, gm, troop, x, z, modelActor)
  }
  override BeginPlay(): void { super.BeginPlay(); logTroopDeployed(this, 'BarbarianActor') }
}

/** 弓箭手 — 远程输出，可攻击空中目标（preferred any） */
export class ArcherActor extends GenericActor implements TroopActor {
  readonly troop: TroopType
  health!: TroopHealthComponent
  constructor(gm: FishLevelGameMode, troop: TroopType, x: number, z: number, modelActor: Actor) {
    super('BattleTroop_archer')
    this.troop = troop
    assembleTroop(this, gm, troop, x, z, modelActor)
  }
  override BeginPlay(): void { super.BeginPlay(); logTroopDeployed(this, 'ArcherActor') }
}

/** 哥布林 — 移速极快，优先攻击资源建筑（preferred resources） */
export class GoblinActor extends GenericActor implements TroopActor {
  readonly troop: TroopType
  health!: TroopHealthComponent
  constructor(gm: FishLevelGameMode, troop: TroopType, x: number, z: number, modelActor: Actor) {
    super('BattleTroop_goblin')
    this.troop = troop
    assembleTroop(this, gm, troop, x, z, modelActor)
  }
  override BeginPlay(): void { super.BeginPlay(); logTroopDeployed(this, 'GoblinActor') }
}

/** 巨人 — 高血量坦克，优先攻击防御建筑（preferred defenses） */
export class GiantActor extends GenericActor implements TroopActor {
  readonly troop: TroopType
  health!: TroopHealthComponent
  constructor(gm: FishLevelGameMode, troop: TroopType, x: number, z: number, modelActor: Actor) {
    super('BattleTroop_giant')
    this.troop = troop
    assembleTroop(this, gm, troop, x, z, modelActor)
  }
  override BeginPlay(): void { super.BeginPlay(); logTroopDeployed(this, 'GiantActor') }
}

/** 炸弹人 — 自爆式破墙单位（preferred walls） */
export class WallBreakerActor extends GenericActor implements TroopActor {
  readonly troop: TroopType
  health!: TroopHealthComponent
  constructor(gm: FishLevelGameMode, troop: TroopType, x: number, z: number, modelActor: Actor) {
    super('BattleTroop_wallBreaker')
    this.troop = troop
    assembleTroop(this, gm, troop, x, z, modelActor)
  }
  override BeginPlay(): void { super.BeginPlay(); logTroopDeployed(this, 'WallBreakerActor') }
}

/** 气球兵 — 飞行投弹，优先攻击防御建筑（flying，preferred defenses） */
export class BalloonActor extends GenericActor implements TroopActor {
  readonly troop: TroopType
  health!: TroopHealthComponent
  constructor(gm: FishLevelGameMode, troop: TroopType, x: number, z: number, modelActor: Actor) {
    super('BattleTroop_balloon')
    this.troop = troop
    assembleTroop(this, gm, troop, x, z, modelActor)
  }
  override BeginPlay(): void { super.BeginPlay(); logTroopDeployed(this, 'BalloonActor') }
}

/** 法师 — 高伤害远程，可攻击空中目标（preferred any） */
export class WizardActor extends GenericActor implements TroopActor {
  readonly troop: TroopType
  health!: TroopHealthComponent
  constructor(gm: FishLevelGameMode, troop: TroopType, x: number, z: number, modelActor: Actor) {
    super('BattleTroop_wizard')
    this.troop = troop
    assembleTroop(this, gm, troop, x, z, modelActor)
  }
  override BeginPlay(): void { super.BeginPlay(); logTroopDeployed(this, 'WizardActor') }
}

/** 治疗师 — 飞行治疗单位（dps=0 不攻击，专属治疗逻辑后续用组件扩展） */
export class HealerActor extends GenericActor implements TroopActor {
  readonly troop: TroopType
  health!: TroopHealthComponent
  constructor(gm: FishLevelGameMode, troop: TroopType, x: number, z: number, modelActor: Actor) {
    super('BattleTroop_healer')
    this.troop = troop
    assembleTroop(this, gm, troop, x, z, modelActor)
  }
  override BeginPlay(): void { super.BeginPlay(); logTroopDeployed(this, 'HealerActor') }
}

/** 飞龙 — 空中重火力，喷吐火焰攻击（flying，preferred any） */
export class DragonActor extends GenericActor implements TroopActor {
  readonly troop: TroopType
  health!: TroopHealthComponent
  constructor(gm: FishLevelGameMode, troop: TroopType, x: number, z: number, modelActor: Actor) {
    super('BattleTroop_dragon')
    this.troop = troop
    assembleTroop(this, gm, troop, x, z, modelActor)
  }
  override BeginPlay(): void { super.BeginPlay(); logTroopDeployed(this, 'DragonActor') }
}

/** 皮卡超人 — 重装近战，剑刃劈砍一切（preferred any） */
export class PekkaActor extends GenericActor implements TroopActor {
  readonly troop: TroopType
  health!: TroopHealthComponent
  constructor(gm: FishLevelGameMode, troop: TroopType, x: number, z: number, modelActor: Actor) {
    super('BattleTroop_pekka')
    this.troop = troop
    assembleTroop(this, gm, troop, x, z, modelActor)
  }
  override BeginPlay(): void { super.BeginPlay(); logTroopDeployed(this, 'PekkaActor') }
}

/** 兵种 id → Actor 类（每兵种一个类；未注册兵种 = 部署被拒） */
export const TROOP_ACTOR_CLASSES: Record<string, TroopCtor> = {
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

/**
 * 兵种工厂：按兵种 id 实例化对应 Actor 类（未注册兵种返回 null）。
 * 替代旧 `new BattleTroopActor(...)` 单一类的部署路径。
 */
export function createTroopActor(
  troopId: string,
  gm: FishLevelGameMode,
  troop: TroopType,
  x: number,
  z: number,
  modelActor: Actor,
): TroopActor | null {
  const ctor = TROOP_ACTOR_CLASSES[troopId]
  if (!ctor) {
    logger.error(`[Battle] 兵种 "${troopId}" 无对应 Actor 类（TROOP_ACTOR_CLASSES 未注册）`)
    return null
  }
  return new ctor(gm, troop, x, z, modelActor)
}
