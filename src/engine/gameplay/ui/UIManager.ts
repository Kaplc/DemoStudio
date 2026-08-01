/**
 * UIManager — 世界 UI 统一管理器
 *
 * 由 World 持有，专门负责 UI 对象的创建与管理：
 *  - 生成 UI Actor（从蓝图实例化）—— 生成逻辑自持，不依赖 World.SpawnActorFromBlueprint
 *  - 创建/销毁 HUD（模仿 UE GameMode.HUDClass → 场景切换时创建）
 *  - 维护当前 HUD 引用
 *
 * 职责划分：
 *  - UIManager：UI 对象的"生成/挂载/清空"（含完整蓝图解析与实例化流程）
 *  - HUD：纯容器（Actor），承载 UI 树，不参与生成逻辑
 *  - World：UI 对象生成后经 world.SpawnActor(actor) 进入统一生命周期管理
 *
 * 用法：
 *   // World 内部（SwitchScene）：
 *   if (newMode.HUDClass) this.ui.createHUD(newMode.HUDClass)
 *
 *   // 代码动态生成 UI（挂到当前 HUD）：
 *   const panel = world.ui.spawnUIActor('asset/blueprints/ui/some_panel.blueprint.json')
 */
import { Actor } from '../entity/Actor'
import { GenericActor } from '../entity/GenericActor'
import { ensureTransformComponent } from '../entity/TransformComponent'
import { HUD } from './HUD'
import { BlueprintRegistry } from '../blueprint/BlueprintRegistry'
import { ActorRegistry } from '../tools/ActorRegistry'
import { ComponentRegistry } from '../tools/ComponentRegistry'
import { logger } from '../../Logger'
import type { World } from '../gameflow/World'
import type { PropertyPatch } from '../../tools/deepMerge'
import type { ResolvedChildDef } from '../blueprint/BlueprintAsset'

export class UIManager {
  private world: World
  private _hud: HUD | null = null

  constructor(world: World) {
    this.world = world
  }

  /** 当前 HUD（可空） */
  get hud(): HUD | null { return this._hud }

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

    // 1. Transform
    if (resolved.position) actor.setPosition(resolved.position[0], resolved.position[1], resolved.position[2])
    if (resolved.rotation) actor.setRotation(resolved.rotation[0], resolved.rotation[1], resolved.rotation[2])
    if (resolved.scale) actor.setScale(resolved.scale[0], resolved.scale[1], resolved.scale[2])

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

    // 2.5 Transform 组件化约定：数据未显式配置时自动补挂（保证每个 UI Actor 都有变换组件）
    ensureTransformComponent(actor)

    // 3. 递归子 Actor
    const spawnChildObjects = (childDefs: ResolvedChildDef[], parentActor: Actor) => {
      for (const child of childDefs) {
        let childActor: Actor | null = null
        let isRefChild = false

        if (child.ref) {
          // ref 引用：作为独立子 Actor 生成，transform 通过 overrides 传入
          isRefChild = true
          const refOverrides: PropertyPatch = { ...(child.overrides ?? {}) }
          if (child.position) refOverrides.position = child.position
          if (child.rotation) refOverrides.rotation = child.rotation
          if (child.scale) refOverrides.scale = child.scale
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
            // Transform 组件化约定：内联子 Actor 未显式配置时自动补挂
            ensureTransformComponent(childActor)
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

        // Transform 组件化约定：容器节点也补挂变换组件
        ensureTransformComponent(childActor)

        childActor.attachTo(parentActor)

        // ref 子节点 transform 已在递归生成时通过 overrides 应用
        if (!isRefChild) {
          if (child.position) childActor.setPosition(child.position[0], child.position[1], child.position[2])
          if (child.rotation) childActor.setRotation(child.rotation[0], child.rotation[1], child.rotation[2])
          if (child.scale) childActor.setScale(child.scale[0], child.scale[1], child.scale[2])
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
    this.world.SpawnActor(actor)

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
    this.world.SpawnActor(hud)

    const ui = this.spawnUIActor(hudClass, hud)
    if (ui) hud.attachUI(ui)

    this._hud = hud
    logger.info(`[UIManager] HUD 已创建: ${hudClass} (hasUI=${hud.hasUI})`)
    return hud
  }

  /** 清空当前 HUD 引用（World 统一销毁 Actor 时调用，避免悬空引用） */
  clear(): void {
    this._hud = null
  }
}
