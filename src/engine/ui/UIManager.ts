/**
 * UIManager — 世界 UI 统一管理器
 *
 * 由 World 持有，专门负责 UI 对象的创建与管理：
 *  - 生成 UI Actor（从蓝图实例化）—— 生成逻辑自持，不依赖 World.SpawnActorFromBlueprint
 *  - 创建/销毁 HUD（模仿 UE GameMode.HUDClass → 场景切换时创建）
 *  - 维护当前 HUD 引用
 *  - 独立管理 UI Actor 生命周期（与 3D Actor 分离，不受 World.allActors 管控）
 *
 * 职责划分：
 *  - UIManager：UI 对象的"生成/挂载/清空"（含完整蓝图解析与实例化流程）+ UI 场景（uiScene）持有与 Actor 归类
 *  - HUD：纯容器（Actor），承载 UI 树，不参与生成逻辑
 *  - World：3D Actor 的生命周期管理，UI Actor 委托给 UIManager
 *
 * 用法：
 *   // World 内部（SwitchScene）：
 *   this.ui.destroyAll()
 *   if (newMode.HUDClass) this.ui.createHUD(newMode.HUDClass)
 *
 *   // 代码动态生成 UI（挂到当前 HUD）：
 *   const panel = world.ui.spawnUIActor('asset/blueprints/ui/some_panel.blueprint.json')
 */
import * as THREE from 'three'
import { Actor } from '../entity/Actor'
import { GenericActor } from '../entity/GenericActor'
import { AObjectComponent } from '../entity/AObjectComponent'
import { ensureUITransformComponent } from './UITransformComponent'
import { HUD } from './HUD'
import { CanvasUIComponent } from '../rendering/CanvasUIComponent'
import { BlueprintRegistry } from '../asset/BlueprintRegistry'
import { ActorRegistry } from '../tools/ActorRegistry'
import { ComponentRegistry } from '../tools/ComponentRegistry'
import { logger } from '../Logger'
import type { World } from '../gameflow/World'
import type { ResolvedChildDef } from '../asset/BlueprintAsset'

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

export class UIManager extends AObjectComponent<World> {
  private _hud: HUD | null = null

  /** UI 独立场景：UI Actor（widget/HUD）挂载于此，与 3D 场景分离，由渲染层叠加渲染（UI 永远在顶层） */
  public readonly scene: THREE.Scene

  // ─── UI Actor 独立生命周期管理 ───
  /** UI Actor 集合（与 World.allActors 完全分离） */
  private _uiActors = new Set<Actor>()
  /** 待生成的 UI Actor */ 
  private _pendingSpawn: Actor[] = []
  /** 待销毁的 UI Actor */
  private _pendingDestroy: Actor[] = []
  /** UI 是否正在运行 */
  private _running = false

  constructor(owner: World) {
    super(owner)
    // UI 场景：独立于主场景（透明背景，叠加渲染时保留主画面）
    this.scene = new THREE.Scene()
  }

  /** 当前 HUD（可空） */
  get hud(): HUD | null { return this._hud }

  /**
   * 判断 Actor 是否属于 UI：自身或子树含 CanvasUIComponent，或是 HUD 容器。
   * 返回 true 的 Actor 由 add() 挂到独立 UI 场景（与 3D 场景分离，叠加渲染）。
   */
  isUIActor(actor: Actor): boolean {
    if (actor instanceof HUD) return true
    const walk = (a: Actor): boolean => {
      if (a.getComponent(CanvasUIComponent)) return true
      for (const c of a.getChildren()) {
        if (walk(c)) return true
      }
      return false
    }
    return walk(actor)
  }

  /** 将 Actor 挂到 UI 场景（仅当属于 UI） */
  add(actor: Actor): void {
    if (this.isUIActor(actor)) this.scene.add(actor.root)
  }

  /** 将 Actor 从 UI 场景移除 */
  remove(actor: Actor): void {
    this.scene.remove(actor.root)
  }

  /**
   * 从蓝图生成一个 UI Actor，并挂到指定父 Actor（默认当前 HUD）。
   * 完整复刻 World.SpawnActorFromBlueprint 的实例化流程（resolve → 构造 → transform
   * → 组件 → 递归子 Actor → overrides → blueprintRef），生成后经 world.SpawnActor 进入
   * World 统一生命周期管理。所有 UI Actor 的生成统一走此方法。
   * @param path    蓝图路径
   * @param parent  父 Actor（默认当前 HUD；无 HUD 时生成为独立顶层 Actor）
   * @returns 生成的 UI Actor；失败返回 null
   */
  spawnUIActor(path: string, parent?: Actor): Actor | null {
    let resolved
    try {
      resolved = BlueprintRegistry.resolve(path)
    } catch (e) {
      logger.error(`[UIManager] 蓝图 "${path}" 解析失败: ${(e as Error).message}`)
      return null
    }

    const actor = ActorRegistry.create(resolved.baseClass)
    if (!actor) {
      logger.error(`[UIManager] baseClass "${resolved.baseClass}" 未在 ActorRegistry 注册 (${path})`)
      return null
    }
    logger.info(`[UIManager] 生成 UI: "${path}" baseClass="${resolved.baseClass}" 组件=${resolved.components.length} 子节点=${resolved.children.length}`)

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
      logger.error(`[UIManager] spawnUIActor("${path}"): 根节点${rootViolation.slice(rootViolation.indexOf('：'))}`)
    }

    // 1. Transform（仅当蓝图根声明了变换组件时应用其 properties 值）
    const rootTsf = resolved.components.find((c) => c.baseClass === 'TransformComponent' || c.baseClass === 'UITransformComponent')
    if (rootTsf) {
      const p = rootTsf.properties ?? {}
      if (Array.isArray(p.position)) actor.setPosition(p.position[0], p.position[1], p.position[2])
      if (Array.isArray(p.rotation)) actor.setRotation(p.rotation[0], p.rotation[1], p.rotation[2])
      if (Array.isArray(p.scale)) actor.setScale(p.scale[0], p.scale[1], p.scale[2])
    }

    // 2. Component
    for (const cdef of resolved.components) {
      const comp = ComponentRegistry.create(actor, cdef.baseClass, cdef.properties)
      if (comp) {
        if (cdef.name) comp.name = cdef.name
        actor.addComponent(comp)
      } else {
        logger.warn(`[UIManager] 组件 "${cdef.baseClass}" 未注册，已跳过 (${path})`)
      }
    }

    // 2.5 Transform 组件化约定：数据未显式配置时自动补挂 UI 专用变换组件（含锚点能力）
    ensureUITransformComponent(actor)

    // 3. 递归子 Actor
    const spawnChildObjects = (childDefs: ResolvedChildDef[], parentActor: Actor) => {
      for (const child of childDefs) {
        let childActor: Actor | null = null
        let isRefChild = false

        if (child.ref) {
          // ref 引用：作为独立子 Actor 生成。
          // 严格模式（组件优先）：位置只写在被引用蓝图的 transform/uitransform 组件，
          // 子节点顶层 position/rotation/scale 不再注入 overrides（旧格式兜底已废弃，直接报错）
          isRefChild = true
          const violation = childTransformViolation(child)
          if (violation) {
            logger.error(`[UIManager] spawnUIActor: ${violation}（ref 子节点）`)
          }
          childActor = this.spawnUIActor(child.ref)
          if (childActor) childActor.isRefInstance = true
        } else if (child.baseClass) {
          // 内联 baseClass → 直接创建
          childActor = ActorRegistry.create(child.baseClass)
          if (childActor) {
            if (child.overrides && Object.keys(child.overrides).length > 0) {
              childActor.applyPatch(child.overrides)
            }
            if (child.components) {
              for (const cdef of child.components) {
                const comp = ComponentRegistry.create(childActor, cdef.baseClass, cdef.properties)
                if (comp) {
                  if (cdef.name) comp.name = cdef.name
                  childActor.addComponent(comp)
                } else {
                  logger.warn(`[UIManager] 子节点组件 "${cdef.baseClass}" 未注册，已跳过 (${path})`)
                }
              }
            }
            // Transform 组件化约定：内联子 Actor 未显式配置时自动补挂 UI 专用变换组件
            ensureUITransformComponent(childActor)
          }
        }
        // 纯容器节点（仅用来承载嵌套 children）
        if (!childActor && child.children?.length) {
          childActor = new GenericActor(child.name ?? `Container_${parentActor.name}`)
        }
        if (!childActor) {
          logger.warn(`[UIManager] 子节点生成失败 (ref=${child.ref ?? '-'}, baseClass=${child.baseClass ?? '-'})`)
          continue
        }

        // Transform 组件化约定：容器节点也补挂 UI 专用变换组件
        ensureUITransformComponent(childActor)

        childActor.attachTo(parentActor)

        // 失活属性：active=false 时节点已创建但不渲染（作用于整个子树）
        if (child.active === false) {
          childActor.bActive = false
          logger.info(`[UIManager] 子节点失活: "${child.name ?? childActor.name}" (parent=${parentActor.root.name}) → bActive=false`)
        }

        // ref 子节点 transform 已由被引用蓝图的 transform 组件负责。
        // 严格模式（组件优先）：内联子节点不再应用顶层 position/rotation/scale，
        // 缺组件却声明顶层字段的节点已在上方报错
        if (!isRefChild) {
          const violation = childTransformViolation(child)
          if (violation) {
            logger.error(`[UIManager] spawnUIActor: ${violation}`)
          }
        }
        if (child.name) childActor.root.name = child.name

        if (child.children && child.children.length > 0) {
          spawnChildObjects(child.children, childActor)
        }
      }
    }

    if (resolved.children.length > 0) {
      spawnChildObjects(resolved.children, actor)
    }

    // 4. 蓝图元数据 + 进 World 统一管理
    actor.blueprintRef = { id: path }
    this.owner.SpawnActor(actor)

    // 4.5 失活属性：active=false 时节点已创建但不渲染（作用于整个子树）
    if (resolved.active === false) {
      actor.bActive = false
      logger.info(`[UIManager] 根节点失活: "${resolved.name}" (${path}) → bActive=false`)
    }

    // 5. 挂载到父 Actor
    const p = parent ?? this._hud
    if (p) actor.attachTo(p)
    logger.info(`[UIManager] UI Actor 已生成: ${path} (uid=${actor.uid}, parent=${p ? p.name : '顶层'})`)
    return actor
  }

  /**
   * 创建 HUD（模仿 UE：GameMode.HUDClass → 场景切换时创建）。
   * 生成 HUD Actor + 从 HUDClass 蓝图实例化 UI 内容。
   * @param hudClass HUD 蓝图路径
   * @returns 创建的 HUD；失败返回 null
   */
  createHUD(hudClass: string): HUD | null {
    const hud = new HUD()
    hud.blueprintPath = hudClass
    this.owner.SpawnActor(hud)

    const ui = this.spawnUIActor(hudClass, hud)
    if (ui) hud.attachUI(ui)

    this._hud = hud
    logger.info(`[UIManager] HUD 已创建: ${hudClass} (hasUI=${hud.hasUI})`)
    return hud
  }

  // ════════════════════════════════════════════
  //  UI Actor 独立生命周期
  // ════════════════════════════════════════════

  /** 将 Actor 纳入 UI 管理（由 World.commitSpawn 委托调用，替代加入 allActors） */
  addUIActor(actor: Actor): void {
    this._pendingSpawn.push(actor)
  }

  /** UI Actor 数量 */
  get actorCount(): number { return this._uiActors.size }
  get pendingSpawnCount(): number { return this._pendingSpawn.length }

  /** 处理待生成的 UI Actor */
  private commitSpawn() {
    for (const actor of this._pendingSpawn) {
      this._uiActors.add(actor)
      if (!actor.parent) {
        this.scene.add(actor.root)
      }
      if (this._running) {
        actor.BeginPlay()
      }
    }
    this._pendingSpawn = []
  }

  /** 处理待销毁的 UI Actor */
  private commitDestroy() {
    for (const actor of this._pendingDestroy) {
      if (this._uiActors.has(actor)) {
        actor.EndPlay()
        this.scene.remove(actor.root)
        this._uiActors.delete(actor)
      }
    }
    this._pendingDestroy = []
  }

  /** 销毁 UI Actor（延迟到 tick 提交；未提交生成时直接取消生成） */
  destroyUIActor(actor: Actor): void {
    if (actor.bPendingDestroy && !this._uiActors.has(actor)) return
    // 尚未提交生成（_pendingSpawn 中）：直接取消生成，避免生成一个已请求销毁的对象
    const spawnIdx = this._pendingSpawn.indexOf(actor)
    if (spawnIdx >= 0) {
      this._pendingSpawn.splice(spawnIdx, 1)
      actor.bPendingDestroy = true
      // 从未进入 UI 场景，仍需释放资源（EndPlay → markDestroyed → 注册表注销）
      actor.EndPlay()
      return
    }
    actor.bPendingDestroy = true
    this._pendingDestroy.push(actor)
  }

  /** UI 子系统恢复运行（场景切换 BeginPlay 时调用） */
  beginPlay() {
    this._running = true
    this.commitSpawn()
    this.commitDestroy()
    for (const actor of this._uiActors) {
      if (!actor.bHasBegunPlay) actor.BeginPlay()
    }
  }

  /** 驱动所有 UI Actor 的 Tick */
  tickUI(dt: number) {
    if (!this._running) return
    this.commitSpawn()
    this.commitDestroy()
    for (const actor of this._uiActors) {
      if (!actor.bPendingDestroy) actor.Tick(dt)
    }
  }

  /** 查找 UI 子系统中的 Actor */
  findUIActor<T extends Actor>(type: new (...args: any[]) => T): T | null {
    for (const actor of this._uiActors) {
      if (actor instanceof type) return actor
    }
    for (const actor of this._pendingSpawn) {
      if (actor instanceof type) return actor
    }
    return null
  }

  /** 获取所有 UI Actor */
  getAllUIActors(): Actor[] {
    return [...this._uiActors]
  }

  /**
   * 销毁所有 UI Actor 并清空状态。
   * 场景切换时由 World.SwitchScene 显式调用，与 3D Actor 销毁分离。
   */
  destroyAll(): void {
    this._running = false
    // 清理已提交的 UI Actor
    for (const actor of [...this._uiActors]) {
      actor.EndPlay()
      this.scene.remove(actor.root)
    }
    this._uiActors.clear()
    this._pendingDestroy = []
    // 清理等待生成的 UI Actor（从未进入场景，仍需释放）
    for (const actor of this._pendingSpawn) {
      actor.EndPlay()
    }
    this._pendingSpawn = []
    // 清空 HUD 引用
    this._hud = null
  }

  /** 清空当前 HUD 引用（World 统一销毁 Actor 时调用，避免悬空引用） */
  clear(): void {
    this._hud = null
  }
}
