/**
 * ActorManagerComponent — World 的 Actor 生成与管理组件
 *
 * 承载 World 的 Actor 注册、生成（SpawnActor / SpawnPawn / SpawnActorFromBlueprint /
 * spawnInlineActor）、销毁（pendingDestroy 队列）、查询（FindActor / FindActors /
 * GetAllActors / getAllActorComponents）与批量清理（DestroyAllActors）全部逻辑。
 *
 * 游戏代码请用 spawnActor(actor) / BlueprintAsset.Instantiate(path)，
 * 编辑器内部用 World.Spawn(actor) / World.Instantiate(path)。
 *
 * 生命周期职责划分：
 *  - 本组件：Actor 集合 + 待生成/待销毁队列 + 生成工厂 + 查询/销毁
 *  - World：Tick 循环（调用本组件 commitSpawn/commitDestroy + 遍历 Tick）、
 *           GameMode 管理、场景切换、Gizmos 绘制
 */
import * as THREE from 'three'
import { Actor } from '../entity/Actor'
import { TransformComponent } from '../entity/TransformComponent'
import { GameInstance } from './GameInstance'
import { GenericActor } from '../entity/GenericActor'
import { AObjectComponent } from '../entity/AObjectComponent'
import { BlueprintRegistry } from '../asset/BlueprintRegistry'
import { ActorRegistry } from '../tools/ActorRegistry'
import { ComponentRegistry } from '../tools/ComponentRegistry'
import { ensureTransformForActor } from '../ui/UITransformComponent'
import { logger } from '../Logger'
import type { World } from './World'
import type { Pawn } from '../entity/Pawn'
import type { PropertyPatch } from '../tools/deepMerge'
import type { Component } from '../entity/Component'
import type { BlueprintComponentDef } from '../asset/BlueprintAsset'

/**
 * 严格模式校验子节点 transform 数据（组件优先）：
 * 顶层 position/rotation/scale 字段已废弃（无论是否声明变换组件）—— 存在即报错，不应用顶层值；
 * 位置/旋转/缩放一律由 transform/uitransform 组件的 properties 承载。
 */
function childTransformViolation(child: {
  name?: string
  components?: Array<{ baseClass?: string }>
  position?: unknown
  rotation?: unknown
  scale?: unknown
} | null | undefined): string | null {
  if (!child) return null
  const hasTop = ['position', 'rotation', 'scale'].some((k) => (child as Record<string, unknown>)[k] !== undefined)
  if (hasTop) {
    return `节点 "${child.name ?? '-'}" 声明了废弃的顶层 position/rotation/scale：位置必须写在 transform/uitransform 组件（组件优先约定）`
  }
  return null
}

export class ActorManagerComponent extends AObjectComponent<World> {
  private allActors = new Set<Actor>()
  private pendingSpawn: Actor[] = []
  private pendingDestroy: Actor[] = []
  /** Pawn 生成完成回调（commitSpawn 时触发，用于 GameMode 通知 Controller Possess） */
  private _pawnSpawnCallbacks: Array<{ pawn: Pawn; cb: (pawn: Pawn) => void }> = []
  /** Actor 列表自上次通知后是否有变化（commitSpawn/commitDestroy/DestroyAllActors 标记，World 消费后通知大纲） */
  private _actorListDirty = false

  // ═══════════════════════════════════
  //  Spawn / Destroy
  // ═══════════════════════════════════

  /**
   * 静态生成入口：将已有 Actor 实例注册到世界。
   * 等价于 `actorMgr.SpawnActor(actor)`，供 spawnActor 转发。
   */
  static Spawn<T extends Actor>(actor: T): T {
    const world = GameInstance.current?.getWorld()
    if (!world) throw new Error('[ActorManagerComponent] 当前没有活跃 GameInstance 或未关联 World')
    return world.actorMgr.SpawnActor(actor)
  }

  /**
   * 静态 Blueprint 实例化入口（编辑器内部用）：在指定 World 中生成 Actor。
   * 不依赖 GameInstance.current。
   */
  static Instantiate(
    path: string,
    world: World,
    overrides?: PropertyPatch,
    componentOverrides?: BlueprintComponentDef[],
  ): Actor | null {
    return world.actorMgr.SpawnActorFromBlueprint(path, overrides, componentOverrides)
  }

  SpawnActor<T extends Actor>(actor: T): T {
    actor.world = this.owner
    this.pendingSpawn.push(actor)
    return actor
  }

  /**
   * 按类型生成 Actor：组件内自动 new + 入队（spawnActor 内部使用）。
   */
  SpawnActorOfType<T extends Actor, A extends unknown[]>(
    type: new (name: string, ...args: A) => T,
    name: string,
    ...args: A
  ): T {
    const actor = new type(name, ...args)
    return this.SpawnActor(actor)
  }

  /** 提交待生成队列（由 World.tick / BeginPlay 调用） */
  commitSpawn() {
    if (this.pendingSpawn.length > 0) this._actorListDirty = true
    for (const actor of this.pendingSpawn) {
      // UI Actor 交给 UIManager 独立管理（不进 allActors）
      if (this.owner.ui.isUIActor(actor)) {
        this.owner.ui.addUIActor(actor)
      } else {
        this.allActors.add(actor)
        // 仅顶层 3D Actor 加到场景；已 attachTo 父的子 Actor 已在父 root 下
        if (!actor.parent) {
          this.owner.scene.add(actor.root)
        }
        // 所有 Actor 刷新可见性（syncVisibility 内部自动处理：无父即根，仅 walk 自身）
        actor.syncVisibility()
        if (this.owner.running) {
          actor.BeginPlay()
          // 组件属性覆盖（ref 节点 components）：BeginPlay 完成后应用（代码组件此刻已挂载）
          actor.flushPendingComponentOverrides()
        }
      }
    }
    this.pendingSpawn = []
    // Pawn 生成完成回调（生成进世界后经 GameMode 通知 Controller Possess）
    if (this._pawnSpawnCallbacks.length > 0) {
      const callbacks = this._pawnSpawnCallbacks
      this._pawnSpawnCallbacks = []
      for (const { pawn, cb } of callbacks) {
        cb(pawn)
      }
    }
  }

  /**
   * 生成 Pawn 到世界：进入待生成队列，commitSpawn 实际生成后调用 onSpawned 回调。
   * 用于 GameMode.SpawnPlayer → World 生成 → 通知 Controller（Possess）的完整链路。
   */
  SpawnPawn(pawn: Pawn, onSpawned?: (pawn: Pawn) => void): Pawn {
    this.SpawnActor(pawn)
    if (onSpawned) {
      this._pawnSpawnCallbacks.push({ pawn, cb: onSpawned })
    }
    return pawn
  }

  DestroyActor(actor: Actor) {
    if (actor.bPendingDestroy) return
    // UI Actor 交给 UIManager 独立销毁
    if (this.owner.ui.isUIActor(actor)) {
      this.owner.ui.destroyUIActor(actor)
      return
    }
    // 尚未提交生成（pendingSpawn 中）：直接取消生成，避免生成一个已请求销毁的对象
    const spawnIdx = this.pendingSpawn.indexOf(actor)
    if (spawnIdx >= 0) {
      this.pendingSpawn.splice(spawnIdx, 1)
      actor.bPendingDestroy = true
      // 从未进入世界，仍需释放资源（EndPlay → markDestroyed → 注册表注销）
      actor.EndPlay()
      return
    }
    // 不在 allActors 的 attachTo 子树节点（父链 EndPlay 递归 destroy() 到达这里）：
    // 不能入队（commitDestroy 只处理 allActors 成员，入队会被丢弃 → 永久泄漏）。
    // 直接本地递归 EndPlay（EndPlay 递归子树，bPendingDestroy 短路防重）。
    if (!this.allActors.has(actor)) {
      actor.bPendingDestroy = true
      actor.EndPlay()
      return
    }
    actor.bPendingDestroy = true
    this.pendingDestroy.push(actor)
  }

  /**
   * 通用对象销毁入口（Object.destroy 调用）。
   * 场景对象（Actor）走 pendingDestroy 队列（tick 时提交清理）；
   * 非场景对象（GameMode/GameState/Controller 等）立即 EndPlay。
   */
  DestroyObject(obj: import('../entity/BObject').BObject): void {
    if (obj instanceof Actor) {
      this.DestroyActor(obj)
      return
    }
    if (obj.bPendingDestroy) return
    obj.bPendingDestroy = true
    obj.EndPlay()
  }

  /** 提交待销毁队列（由 World.tick 调用） */
  commitDestroy() {
    if (this.pendingDestroy.length > 0) this._actorListDirty = true
    for (const actor of this.pendingDestroy) {
      if (this.allActors.has(actor)) {
        actor.EndPlay()
        this.owner.scene.remove(actor.root)
        this.allActors.delete(actor)
      }
    }
    this.pendingDestroy = []
  }

  // ═══════════════════════════════════
  //  查询
  // ═══════════════════════════════════

  FindActor<T extends Actor>(type: new (...args: any[]) => T): T | null {
    for (const actor of this.allActors) {
      if (actor instanceof type) return actor
    }
    for (const actor of this.pendingSpawn) {
      if (actor instanceof type) return actor
    }
    return null
  }

  FindActors<T extends Actor>(type: new (...args: any[]) => T): T[] {
    const result: T[] = []
    for (const actor of this.allActors) {
      if (actor instanceof type) result.push(actor)
    }
    return result
  }

  GetAllActors(): Actor[] {
    return [...this.allActors]
  }

  /** 在世界中查找所有挂载了指定 Component 类型的 Actor 及其实例 */
  getAllActorComponents<T extends Component>(
    type: new (...args: any[]) => T,
  ): T[] {
    const result: T[] = []
    for (const actor of this.allActors) {
      const comps = actor.getComponents(type)
      result.push(...comps)
    }
    return result
  }

  // ═══════════════════════════════════
  //  统计
  // ═══════════════════════════════════

  /** 当前等待生成和已生成的 Actor 总数（用于日志/调试） */
  get actorCount(): number { return this.allActors.size }
  get pendingSpawnCount(): number { return this.pendingSpawn.length }
  get pendingDestroyCount(): number { return this.pendingDestroy.length }

  // ═══════════════════════════════════
  //  诊断：孤儿 THREE 对象
  // ═══════════════════════════════════

  /** 已知的编辑器/引擎基础设施根对象名（共享场景常驻，非游戏内容，诊断时排除） */
  private static readonly KNOWN_INFRA_ROOTS = new Set(['Default', 'TransformGizmo'])

  /**
   * 遍历所有场景（主场景 + UI 场景），找出未被任何 Actor 跟踪的 THREE 对象（孤儿对象）。
   * 判定规则：对象的祖先链上没有任何 Actor 的 root —— 即不在任何 Actor 子树内。
   * 已知编辑器基础设施（Default 默认内容 / TransformGizmo / Gizmos 线）自动排除。
   * 用于排查资源泄漏 / 对象创建后未正确生成进世界的问题（销毁游戏时调用）。
   *
   * @returns 孤儿对象数组（obj + 所在场景 + 祖先链描述），供日志输出定位来源
   */
  findOrphanObjects(): Array<{ obj: THREE.Object3D; sceneName: string; chain: string }> {
    // 收集所有被 Actor 跟踪的根节点（3D Actor + UI Actor）
    const tracked = new Set<THREE.Object3D>()
    for (const actor of this.allActors) tracked.add(actor.root)
    for (const actor of this.owner.ui.getAllUIActors()) tracked.add(actor.root)

    const orphans: Array<{ obj: THREE.Object3D; sceneName: string; chain: string }> = []
    const checkScene = (scene: THREE.Scene | null, sceneName: string) => {
      if (!scene) return
      scene.traverse((obj) => {
        if (obj === scene) return
        // 沿祖先链查找：任一祖先是被跟踪的 root → 属于 Actor 子树，跳过
        let p: THREE.Object3D | null = obj
        while (p) {
          if (tracked.has(p)) return
          p = p.parent
        }
        // 排除已知编辑器基础设施（其子树一并跳过）
        for (const infra of ActorManagerComponent.KNOWN_INFRA_ROOTS) {
          let q: THREE.Object3D | null = obj
          while (q) {
            if (q.name === infra) return
            q = q.parent
          }
        }
        // 排除 Gizmos 调试线（每帧绘制，属编辑器调试层）
        if (obj.type === 'LineSegments') return
        // 记录：祖先链（root 显示为 scene 名）
        const names: string[] = []
        let n: THREE.Object3D | null = obj
        while (n && n !== scene) {
          names.unshift(n.name || '(无名)')
          n = n.parent
        }
        orphans.push({
          obj,
          sceneName,
          chain: names.join(' → '),
        })
      })
    }
    checkScene(this.owner.scene, '主场景')
    checkScene(this.owner.ui.scene, 'UI 场景')
    return orphans
  }

  // ═══════════════════════════════════
  //  批量清理
  // ═══════════════════════════════════

  /** 销毁所有 3D Actor 与 UI Actor（Controller 由 GameMode.EndPlay 负责） */
  DestroyAllActors() {
    let count = this.allActors.size + this.pendingSpawn.length
    // 先清 UI 子系统
    const uiCount = this.owner.ui.actorCount + this.owner.ui.pendingSpawnCount
    this.owner.ui.destroyAll()
    count += uiCount
    // 清理已提交的 3D Actor
    for (const actor of [...this.allActors]) {
      actor.EndPlay()
      this.owner.scene.remove(actor.root)
    }
    this.allActors.clear()
    this.pendingDestroy = []
    // 清理等待生成的 Actor（从未进入场景，仍需释放 GPU 资源）
    for (const actor of this.pendingSpawn) {
      actor.EndPlay()
    }
    this.pendingSpawn = []
    // 清理未触发的 Pawn 生成回调（世界已销毁，不再通知 Controller）
    this._pawnSpawnCallbacks = []
    if (count > 0) this._actorListDirty = true
    logger.debug(`[ActorManagerComponent] DestroyAllActors: 销毁 ${count} 个 Actor`)
  }

  /** 读取并清除 Actor 列表变化标记（由 World 在每帧提交后消费，触发 onActorListChanged 通知） */
  consumeActorListDirty(): boolean {
    const dirty = this._actorListDirty
    this._actorListDirty = false
    return dirty
  }

  // ═══════════════════════════════════
  //  Blueprint 实例化
  // ═══════════════════════════════════

  /**
   * 从 Blueprint 实例化一个 Actor 到世界（统一 Unity Prefab / UE Blueprint Class）。
   *
   * 注入时序（关键，全部在 SpawnActor / BeginPlay 之前完成）：
   *   1. resolve(id) → 扁平 CDO（继承链已合并）
   *   2. ActorRegistry.create(baseClass) 构造
   *   3. 应用继承链合并后的 position/rotation/scale
   *   4. 挂 Component（ComponentRegistry.create + addComponent）
   *   5. 递归子 Actor（各自 SpawnActorFromBlueprint 或 ActorRegistry.create + attachTo）
   *   6. applyPatch(overrides) 应用调用方覆盖
   *   7. 设 blueprintRef 元数据
   *   8. SpawnActor（进 pendingSpawn，后续 commitSpawn → BeginPlay）
   *
   * @param path      Blueprint id
   * @param overrides 实例级覆盖（position/rotation/scale/自定义参数）
   * @param componentOverrides 实例级组件属性覆盖（场景 ref 节点 components：按 baseClass
   *                   找到已挂组件后用 editable setter 回写属性，如改 MeshComponent.size）；
   *                   在 applyPatch 之后应用（组件属性优先于自定义参数路径）
   * @returns 生成的 Actor；解析或构造失败返回 null
   */
  SpawnActorFromBlueprint(path: string, overrides?: PropertyPatch, componentOverrides?: BlueprintComponentDef[]): Actor | null {
    logger.info(`[ActorManagerComponent] SpawnActorFromBlueprint: 实例化 "${path}"`)
    let resolved
    try {
      resolved = BlueprintRegistry.resolve(path)
    } catch (e) {
      logger.error(`[ActorManagerComponent] SpawnActorFromBlueprint("${path}") 解析失败: ${(e as Error).message}`)
      return null
    }

    const actor = ActorRegistry.create(resolved.baseClass)
    if (!actor) {
      logger.error(`[ActorManagerComponent] SpawnActorFromBlueprint("${path}"): baseClass "${resolved.baseClass}" 未在 ActorRegistry 注册`)
      return null
    }
    logger.info(`[ActorManagerComponent] SpawnActorFromBlueprint("${path}"): baseClass="${resolved.baseClass}"，组件数=${resolved.components.length}，子节点数=${resolved.children.length}`)

    // 严格模式（组件优先）：蓝图根位置必须写在 transform/uitransform 组件。
    // 根级顶层 position/rotation/scale 是旧格式兜底，已废弃 —— 存在即报错
    const rootViolation = childTransformViolation({
      name: resolved.name,
      components: resolved.components,
      position: resolved.position,
      rotation: resolved.rotation,
      scale: resolved.scale,
    })
    if (rootViolation) {
      logger.error(`[ActorManagerComponent] SpawnActorFromBlueprint("${path}"): 根节点${rootViolation.slice(rootViolation.indexOf('：'))}`)
    }

    // 1. Transform（仅当蓝图根声明了变换组件时应用其 properties 值）
    const rootTsf = resolved.components.find((c) => c.baseClass === 'TransformComponent' || c.baseClass === 'UITransformComponent')
    if (rootTsf) {
      const p = rootTsf.properties ?? {}
      logger.info(`[SpawnPos] "${actor.name}" 蓝图根 transform: pos=[${p.position?.join(',') ?? 'none'}]`)
      if (Array.isArray(p.position)) actor.setPosition(p.position[0], p.position[1], p.position[2])
      if (Array.isArray(p.rotation)) actor.setRotation(p.rotation[0], p.rotation[1], p.rotation[2])
      if (Array.isArray(p.scale)) actor.setScale(p.scale[0], p.scale[1], p.scale[2])
      logger.info(`[SpawnPos] "${actor.name}" 蓝图根 transform 后: root.pos=[${actor.root.position.x.toFixed(2)}, ${actor.root.position.y.toFixed(2)}, ${actor.root.position.z.toFixed(2)}]`)
    }

    // 2. Component
    for (const cdef of resolved.components) {
      // TransformComponent 复用：Actor 构造已自带（UE RootComponent 语义），
      // 蓝图再声明时对已有实例应用属性即可，避免重复挂载（同名组件警告 + 双重组件）
      const existingTf = cdef.baseClass === 'TransformComponent' ? actor.getComponent(TransformComponent) : null
      if (existingTf) {
        ComponentRegistry.configure(existingTf, cdef.baseClass, cdef.properties)
        logger.info(`[ActorManagerComponent]   └ 组件: "${cdef.baseClass}" name="${existingTf.name}"（复用已有实例）`)
        continue
      }
      const comp = ComponentRegistry.create(actor, cdef.baseClass, cdef.properties)
      if (comp) {
        if (cdef.name) comp.name = cdef.name
        actor.addComponent(comp)
        logger.info(`[ActorManagerComponent]   └ 组件: "${cdef.baseClass}" name="${comp.name}"`)
      } else {
        logger.error(`[ActorManagerComponent] SpawnActorFromBlueprint("${path}"): Component 类型 "${cdef.baseClass}" 未注册，已跳过`)
      }
    }

    // 2.5 Transform 组件化约定：数据未显式配置时自动补挂（UI Actor 挂 UITransformComponent 含锚点能力）
    ensureTransformForActor(actor)

    // 3. 子 Actor
    const spawnChildObjects = (
      childDefs: typeof resolved.children,
      parentActor: Actor,
    ) => {
      for (let i = 0; i < childDefs.length; i++) {
        const child = childDefs[i]
        let childActor: Actor | null = null
        let isRefChild = false
        if (child.ref) {
          isRefChild = true
          // ref 引用：作为独立子 Actor 生成（类似 Unity 预制体）。
          // 严格模式（组件优先）：位置只写在被引用蓝图的 transform/uitransform 组件，
          // 子节点顶层 position/rotation/scale 不再注入 overrides（旧格式兜底已废弃，直接报错）
          const violation = childTransformViolation(child)
          if (violation) {
            logger.error(`[ActorManagerComponent] SpawnActorFromBlueprint("${path}"): ${violation}（ref 子节点）`)
          }
          const refOverrides: PropertyPatch = { ...(child.overrides ?? {}) }
          childActor = this.SpawnActorFromBlueprint(child.ref, refOverrides)
          if (childActor) childActor.isRefInstance = true
        } else if (child.baseClass) {
          childActor = ActorRegistry.create(child.baseClass)
          if (childActor) {
            if (child.overrides && Object.keys(child.overrides).length > 0) {
              childActor.applyPatch(child.overrides)
            }
            if (child.components) {
              const childName = child.name ?? `<inline#${i}>`
              for (const cdef of child.components) {
                // TransformComponent 复用：子 Actor 构造已自带，避免重复挂载
                const existingTf = cdef.baseClass === 'TransformComponent' ? childActor.getComponent(TransformComponent) : null
                if (existingTf) {
                  ComponentRegistry.configure(existingTf, cdef.baseClass, cdef.properties)
                  continue
                }
                const comp = ComponentRegistry.create(childActor, cdef.baseClass, cdef.properties)
                if (comp) {
                  if (cdef.name) comp.name = cdef.name
                  childActor.addComponent(comp)
                } else {
                  logger.warn(`[ActorManagerComponent] SpawnActorFromBlueprint("${path}"): 子节点组件 "${cdef.baseClass}" 未注册，已跳过`)
                }
              }
            }
            // Transform 组件化约定：内联子 Actor 未显式配置时自动补挂
            ensureTransformForActor(childActor)
          }
        }
        // 纯容器节点（仅用来承载嵌套 children）
        if (!childActor && child.children?.length) {
          childActor = new GenericActor(child.name ?? `Container_${parentActor.name}`)
        }
        if (!childActor) {
          logger.warn(
            `[ActorManagerComponent] SpawnActorFromBlueprint("${path}"): 子节点生成失败 (baseClass=${child.baseClass ?? '-'})`,
          )
          continue
        }

        // Transform 组件化约定：容器节点也补挂变换组件
        ensureTransformForActor(childActor)

        childActor.attachTo(parentActor)

        // ref 子节点的 transform 已由被引用蓝图的 transform 组件负责。
        // 严格模式（组件优先）：内联子节点不再应用顶层 position/rotation/scale，
        // 缺组件却声明顶层字段的节点已在上方报错
        if (!isRefChild) {
          const violation = childTransformViolation(child)
          if (violation) {
            logger.error(`[ActorManagerComponent] SpawnActorFromBlueprint("${path}"): ${violation}`)
          }
        }

        if (child.name) {
          childActor.root.name = child.name
        }

        if (child.children && child.children.length > 0) {
          spawnChildObjects(child.children, childActor)
        }
      }
    }

    if (resolved.children.length > 0) {
      spawnChildObjects(resolved.children, actor)
    }

    // 4. 调用方实例覆盖
    if (overrides && Object.keys(overrides).length > 0) {
      logger.info(`[SpawnPos] "${actor.name}" applyPatch 前: root.pos=[${actor.root.position.x.toFixed(2)}, ${actor.root.position.y.toFixed(2)}, ${actor.root.position.z.toFixed(2)}], overrides.pos=[${(overrides.position as number[]|undefined)?.join(',') ?? 'none'}]`)
      actor.applyPatch(overrides)
      logger.info(`[SpawnPos] "${actor.name}" applyPatch 后: root.pos=[${actor.root.position.x.toFixed(2)}, ${actor.root.position.y.toFixed(2)}, ${actor.root.position.z.toFixed(2)}]`)
    }

    // 4.2 实例级组件属性覆盖（场景 ref 节点 components）暂存到 Actor：
    // 代码生成的组件（如建筑 MeshComponent）在 BeginPlay 才挂载，此时解析不到——
    // 由 commitSpawn / World.BeginPlay 在 BeginPlay 完成后统一 flush 应用
    if (componentOverrides && componentOverrides.length > 0) {
      actor.pendingComponentOverrides = componentOverrides.map((c) => ({
        baseClass: c.baseClass,
        properties: c.properties,
      }))
    }

    // 4.5 应用蓝图根节点 name（子节点已在 spawnChildObjects 应用 child.name，
    // 根节点遗漏会导致大纲等显示 baseClass 默认名如 'Actor' 而非资产名）
    if (resolved.name) {
      actor.root.name = resolved.name
    }

    // 5. 蓝图元数据
    actor.blueprintRef = { id: path, overrides }

    // 6. 进 World
    this.SpawnActor(actor)
    logger.info(`[ActorManagerComponent] SpawnActorFromBlueprint("${path}"): Actor "${actor.name}" 已生成（uid=${actor.uid}）`)
    return actor
  }

  /**
   * 从 ActorNode spawn 一个内联 Actor（含递归子节点）。
   * 与 SpawnActorFromBlueprint 的子节点逻辑一致。
   * 供外部调用（ScenePreviewManager 等）。
   */
  spawnInlineActor(
    node: import('../asset/SceneAsset').ActorNode,
    onSpawn?: (child: import('../asset/BlueprintAsset').BlueprintChildDef, actor: Actor, depth: number) => void,
  ): Actor | null {
    const actor = ActorRegistry.create(node.baseClass)
    if (!actor) {
      logger.warn(`[ActorManagerComponent] spawnInlineActor: baseClass "${node.baseClass}" 未注册`)
      return null
    }

    if (node.name) actor.root.name = node.name

    // 严格模式（组件优先）：内联 Actor 位置只写在 transform/uitransform 组件，
    // 顶层 position/rotation/scale 是旧格式兜底，存在即报错
    const violation = childTransformViolation({
      name: node.name,
      components: node.components,
      position: node.position,
      rotation: node.rotation,
      scale: node.scale,
    })
    if (violation) {
      logger.error(`[ActorManagerComponent] spawnInlineActor: ${violation}`)
    }

    // 挂 Component
    for (const cdef of (node.components ?? [])) {
      // TransformComponent 复用：Actor 构造已自带，避免重复挂载
      const existingTf = cdef.baseClass === 'TransformComponent' ? actor.getComponent(TransformComponent) : null
      if (existingTf) {
        ComponentRegistry.configure(existingTf, cdef.baseClass, cdef.properties)
        continue
      }
      const comp = ComponentRegistry.create(actor, cdef.baseClass, cdef.properties)
      if (comp) {
        if (cdef.name) comp.name = cdef.name
        actor.addComponent(comp)
      } else {
        logger.warn(`[ActorManagerComponent] spawnInlineActor: Component "${cdef.baseClass}" 未注册，已跳过`)
      }
    }

    // Transform 组件化约定：内联 Actor 未显式配置时自动补挂
    ensureTransformForActor(actor)

    // 递归子节点（onSpawn 透传供编辑器构建 JSON 映射）
    this.spawnInlineChildren(node.children ?? [], actor, onSpawn, 0)

    this.SpawnActor(actor)
    return actor
  }

  /**
   * 递归 spawn 内联子节点（BlueprintChildDef 风格，供场景 ActorNode/RefNode 的 children 复用）。
   * 返回按 JSON 顺序排列的直接子 Actor 列表（供编辑器构建 Actor→JSON 映射）。
   * @param onSpawn 每生成一个子节点时回调（depth 从 0 起，深度优先先序，供调用方维护路径栈）
   */
  spawnInlineChildren(
    children: import('../asset/BlueprintAsset').BlueprintChildDef[],
    parentActor: Actor,
    onSpawn?: (child: import('../asset/BlueprintAsset').BlueprintChildDef, actor: Actor, depth: number) => void,
    depth = 0,
  ): Actor[] {
    const spawned: Actor[] = []
    for (const child of children) {
      let childActor: Actor | null = null
      let isRefChild = false

      if (child.ref) {
        // ref 引用 → 递归 SpawnActorFromBlueprint。
        // 严格模式（组件优先）：位置只写在被引用蓝图的 transform 组件，顶层字段不再注入 overrides
        isRefChild = true
        const violation = childTransformViolation(child)
        if (violation) {
          logger.error(`[ActorManagerComponent] spawnInlineChildren: ${violation}（ref 子节点）`)
        }
        const refOverrides: PropertyPatch = { ...(child.overrides ?? {}) }
        childActor = this.SpawnActorFromBlueprint(child.ref, refOverrides)
        if (childActor) childActor.isRefInstance = true
      } else if (child.baseClass) {
        // 内联 baseClass → 直接创建（位置由子节点 transform 组件负责，不再应用顶层字段）
        const violation = childTransformViolation(child)
        if (violation) {
          logger.error(`[ActorManagerComponent] spawnInlineChildren: ${violation}`)
        }
        childActor = ActorRegistry.create(child.baseClass)
        if (childActor) {
          if (child.overrides && Object.keys(child.overrides).length > 0) {
            childActor.applyPatch(child.overrides)
          }
          if (child.name) childActor.root.name = child.name
          // 挂组件
          for (const cdef of (child.components ?? [])) {
            // TransformComponent 复用：子 Actor 构造已自带，避免重复挂载
            const existingTf = cdef.baseClass === 'TransformComponent' ? childActor.getComponent(TransformComponent) : null
            if (existingTf) {
              ComponentRegistry.configure(existingTf, cdef.baseClass, cdef.properties)
              continue
            }
            const comp = ComponentRegistry.create(childActor, cdef.baseClass, cdef.properties)
            if (comp) {
              if (cdef.name) comp.name = cdef.name
              childActor.addComponent(comp)
            }
          }
          // Transform 组件化约定：内联子 Actor 未显式配置时自动补挂
          ensureTransformForActor(childActor)
        }
      }

      // 纯容器节点（只有 children，没有 baseClass / ref）
      if (!childActor && (child.children?.length ?? 0) > 0) {
        childActor = new GenericActor(child.name ?? `Container_${parentActor.name}`)
      }

      if (!childActor) {
        logger.warn(`[ActorManagerComponent] spawnInlineChildren: 子节点生成失败 (ref=${child.ref ?? '-'}, baseClass=${child.baseClass ?? '-'})`)
        continue
      }

      // Transform 组件化约定：容器节点也补挂变换组件
      ensureTransformForActor(childActor)

      childActor.attachTo(parentActor)
      spawned.push(childActor)
      onSpawn?.(child, childActor, depth)
      if (child.children?.length) {
        this.spawnInlineChildren(child.children, childActor, onSpawn, depth + 1)
      }
    }
    return spawned
  }
}
