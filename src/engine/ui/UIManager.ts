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
import { TransformComponent } from '../entity/TransformComponent'
import { GenericActor } from '../entity/GenericActor'
import { AObjectComponent } from '../entity/AObjectComponent'
import { ensureUITransformComponent, UITransformComponent } from './UITransformComponent'
import { UIWorldAnchorComponent, type UIWorldAnchorComponentOptions } from './UIWorldAnchorComponent'
import { HUD } from './HUD'
import { CanvasUIComponent } from '../rendering/CanvasUIComponent'
import { BlueprintRegistry } from '../asset/BlueprintRegistry'
import { ActorRegistry } from '../tools/ActorRegistry'
import { ComponentRegistry } from '../tools/ComponentRegistry'
import { TweenSystem } from './TweenSystem'
import { ToastSystem } from './ToastSystem'
import { logger } from '../Logger'
import type { World } from '../gameflow/World'
import type { ResolvedChildDef } from '../asset/BlueprintAsset'

/**
 * 浮动面板层级基准（兼容保留）。
 *
 * 渲染层级已由 reassignTreeOrder 按大纲树序遍历自动分配（树中靠后的节点覆盖
 * 靠前的），浮动面板作为 HUD 子树末尾节点天然获得更高层级，本基准仅作为
 * 非树序路径（如程序化直接设置 zOrder）的兜底偏移常量保留。
 */
export const FLOAT_LAYER_BIAS = 100

/**
 * 锚定 widget 句柄（spawnAnchoredWidget 返回）。
 * actor/transform 在 widget 销毁后读取为 null（惰性判活）；release() 幂等。
 */
export interface AnchoredWidgetHandle {
  /** widget 根 Actor（销毁后为 null） */
  readonly actor: Actor | null
  /** widget 根 UITransformComponent（销毁后为 null） */
  readonly transform: UITransformComponent | null
  /** 销毁 widget（幂等；延迟到下一帧 tickUI 提交） */
  release(): void
}

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
  /** UI Actor 列表自上次通知后是否有变化（commitSpawn/commitDestroy/destroyAll 标记，World 消费后通知大纲） */
  private _uiListDirty = false

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
   * 例外：根含 UIWorldAnchorComponent(mode='world') 的 widget 归 UIManager 生命周期
   * 管理，但挂主场景（世界空间面板，见 commitSpawn 分流）——本方法返回 true 保证
   * 生命周期统一，场景归属由 commitSpawn 单独判断。
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

  /**
   * 判断 Actor 是否为"世界空间面板"（UIWorldAnchorComponent(mode='world) 根）：
   * 此类 Actor 归 UIManager 生命周期管理，但 mesh 挂主场景（深度遮挡/透视正确）。
   * 仅根 Actor 判定——子树随根 Object3D 走，逐节点无需感知。
   */
  isWorldSpaceUI(actor: Actor): boolean {
    const anchor = actor.getComponent(UIWorldAnchorComponent)
    return anchor?.mode === 'world'
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
      // TransformComponent 复用：Actor 构造已自带（UE RootComponent 语义），
      // 蓝图再声明时对已有实例应用属性即可，避免重复挂载（同名组件警告 + 双重组件）
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

    // 4. 蓝图元数据 + 应用根节点 name（子节点已在 spawnChildObjects 应用 child.name，
    // 根节点遗漏会导致大纲等显示 baseClass 默认名而非资产名）
    actor.blueprintRef = { id: path }
    if (resolved.name) {
      actor.root.name = resolved.name
    }
    this.owner.actorMgr.SpawnActor(actor)

    // 4.5 失活属性：active=false 时节点已创建但不渲染（作用于整个子树）
    if (resolved.active === false) {
      actor.bActive = false
      logger.info(`[UIManager] 根节点失活: "${resolved.name}" (${path}) → bActive=false`)
    }

    // 5. 挂载到父 Actor
    const p = parent ?? this._hud
    if (p) actor.attachTo(p)
    // 5.5 world 归属：内联子节点（spawnChildObjects attachTo 挂树）不经 SpawnActor，
    // 不会被 commitSpawn 设置 world（字段恒 null）→ 显式整树传播，
    // 供依赖 owner.world 的组件（UIScrollListComponent 等）在 BeginPlay 时取用。
    const setWorld = (a: Actor): void => {
      a.world = this.owner
      for (const c of a.getChildren()) setWorld(c)
    }
    setWorld(actor)
    // 浮动面板层级基准：游戏运行中动态生成的 UI（地图面板/暂停菜单/兵营面板等）整树
    // zOrder += FLOAT_LAYER_BIAS，保证盖过常驻 HUD（three 透明排序按全局 renderOrder，
    // 不偏移会被 HUD 内高 zOrder 的文字穿透）。场景切换期生成（HUD 本体）不偏移。
    if (this.owner.running) this.applyFloatLayerBias(actor)
    return actor
  }

  /**
   * 生成世界锚定 widget（World-Space UI 统一入口，doc-dev/ui-world-space）。
   *
   * 与 spawnUIActor 的差异：
   *  - 自动补挂 UIWorldAnchorComponent（资产未声明时按 opts 注入）；
   *  - world 模式 widget 禁止挂 HUD 子树（必须顶层，否则场景分流失效）——检测到
   *    parent 参数时告警并忽略；
   *  - 返回句柄：release() 销毁 widget；target（按名解析的 3D Actor）被销毁时
   *    widget 在下一帧锚定 tick 中自动销毁（跟随目标生命周期）。
   *
   * @param path      widget 蓝图路径
   * @param target    锚定目标（screen 模式必填语义；world 面板传 null 表示位姿静态）
   * @param opts      锚定参数（缺省 mode='screen'，其余见 UIWorldAnchorComponentOptions）
   * @returns 句柄（actor/transform 可能随销毁变 null）；生成失败返回 null
   */
  spawnAnchoredWidget(
    path: string,
    target: Actor | null,
    opts: UIWorldAnchorComponentOptions & { targetActorId?: string } = {},
  ): AnchoredWidgetHandle | null {
    // world 模式必须顶层（场景分流按根 Actor 判定；挂 HUD 子树会让面板留在 uiScene）
    const parent = opts.mode === 'world' ? undefined : undefined
    if (opts.mode === 'world' && target) {
      logger.warn(`[UIManager] spawnAnchoredWidget: mode='world' 面板忽略 target（世界面板位姿由场景决定，跟随需求用 mode='screen'）`)
    }
    const actor = this.spawnUIActor(path, parent)
    if (!actor) return null

    // 补挂/复用锚定组件（资产已声明 data-comp=UIWorldAnchorComponent 时以资产为准，
    // 运行时 opts 覆盖 targetActorId）
    let anchor = actor.getComponent(UIWorldAnchorComponent)
    if (!anchor) {
      anchor = new UIWorldAnchorComponent(actor, opts)
      actor.addComponent(anchor)
    } else if (opts.targetActorId) {
      anchor.targetActorId = opts.targetActorId
    }
    if (target) anchor.targetActorId = target.root.name

    // 句柄：actor 引用惰性判活（bPendingDestroy / 注册表注销后置 null）
    const handle: AnchoredWidgetHandle = {
      get actor() { return actor.bPendingDestroy ? null : actor },
      get transform() {
        return actor.bPendingDestroy ? null : actor.getComponent(UITransformComponent)
      },
      release: () => this.destroyUIActor(actor),
    }
    logger.info(`[UIManager] spawnAnchoredWidget: "${actor.root.name}" (${path}) mode=${anchor.mode} target=${anchor.targetActorId || '-'}`)
    return handle
  }

  /**
   * 提升一棵 UI 树的 zOrder（浮动面板层级基准，兼容保留）：
   * 树序遍历分配（reassignTreeOrder）已保证浮动面板（HUD 子树末尾）天然盖过
   * 常驻 HUD，此方法保留用于非树序路径的程序化 UI（如 UIScrollList 滚动条）
   * 叠加兜底偏移。递归遍历所有 CanvasUIComponent（UIText/UIImage 继承自它，
   * setter 会同步各自渲染对象的 renderOrder/position.z）。
   */
  private applyFloatLayerBias(actor: Actor): void {
    const walk = (a: Actor): void => {
      for (const comp of a.getComponents(CanvasUIComponent)) {
        comp.zOrder += FLOAT_LAYER_BIAS
      }
      for (const child of a.getChildren()) {
        walk(child)
      }
    }
    walk(actor)
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
    this.owner.actorMgr.SpawnActor(hud)

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
    const changed = this._pendingSpawn.length > 0
    if (changed) this._uiListDirty = true
    for (const actor of this._pendingSpawn) {
      this._uiActors.add(actor)
      if (!actor.parent) {
        // 世界空间面板（UIWorldAnchor mode='world'）挂主场景：深度遮挡/透视正确；
        // 其余 UI Actor 挂独立 uiScene（叠加渲染，永在顶层）
        if (this.isWorldSpaceUI(actor)) {
          this.owner.scene.add(actor.root)
        } else {
          this.scene.add(actor.root)
        }
      }
      if (this._running) {
        actor.BeginPlay()
      }
    }
    this._pendingSpawn = []
    // UI 树结构变化 → 按大纲树序重排渲染层级（树中靠后的节点覆盖靠前的）
    if (changed) this.reassignTreeOrder()
  }

  /** 处理待销毁的 UI Actor */
  private commitDestroy() {
    const changed = this._pendingDestroy.length > 0
    if (changed) this._uiListDirty = true
    for (const actor of this._pendingDestroy) {
      if (this._uiActors.has(actor)) {
        actor.EndPlay()
        // 世界空间面板挂主场景，销毁时从对应场景移除
        if (this.isWorldSpaceUI(actor)) this.owner.scene.remove(actor.root)
        else this.scene.remove(actor.root)
        this._uiActors.delete(actor)
        // 从父 Actor 树拆离：运行时动态生成的 UI（如兵营面板 spawnUIActor 挂 HUD 下）
        // 必须 detach，否则大纲递归 HUD 子树仍显示已销毁节点
        if (actor.parent) actor.detach()
      }
    }
    this._pendingDestroy = []
    // 节点移除后树序出现空洞，重排保持层级连续（相对顺序不变）
    if (changed) this.reassignTreeOrder()
  }

  /**
   * 视口比例变化 → 重排全屏 HUD 根到 contain 视锥尺寸（UI 视口自适应，方案 doc-dev/ui-viewport-relayout）。
   *
   * 由 SceneRendererComponent.resize() 在同步相机视锥后调用（传入视锥设计尺寸）：
   *  - 全屏根（HUD 子树根：真实画布 1920×1080 或 markerOnly 容器高 ≥ 半屏）
   *    重设为视锥尺寸 → 根铺满视锥，任意比例视口两侧/上下不再留空；
   *  - 递归重算子树锚点（stretch 子节点跟随新容器、九宫格锚点位置重算）；
   *  - 浮层 widget / 锚定 widget（顶层 Actor）不在根子树内，天然豁免；
   *  - 幂等：尺寸未变化时不重排。
   *
   * 与预览态的分工：编辑器 widget 预览的同类逻辑在 UIPreviewManager.applyViewportAspect
   * （fitToWidget 视口语境，保持高度改宽）；运行时以 contain 视锥为准（根 = 视锥）。
   *
   * @param frustumW contain 视锥设计宽（UICamera.computeContainFrustum）
   * @param frustumH contain 视锥设计高
   */
  relayoutForViewport(frustumW: number, frustumH: number): void {
    if (frustumW <= 0 || frustumH <= 0) return
    const root = this._hud?.uiActor
    if (!root) return
    this.relayoutFullscreenRoot(root, frustumW, frustumH)
  }

  /**
   * 重排一个全屏根子树（供 relayoutForViewport 驱动；GM 控制台等特殊 HUD 同构可复用）。
   * 幂等：根尺寸已等于目标时跳过（同比例 resize 零开销）。
   */
  private relayoutFullscreenRoot(root: Actor, frustumW: number, frustumH: number): void {
    const rootTsf = root.getComponent(UITransformComponent)
    if (!rootTsf) return
    // 全屏根判定（与 UIPreviewManager.applyViewportAspect 同式）：
    // 真实画布根 1920×1080，或 markerOnly 容器根高 ≥ 半屏（HUD 挂点类布局容器）
    const canvas = root.getComponent(CanvasUIComponent)
    const isFullscreen = canvas
      ? (!canvas.isMarkerOnly && canvas.getSize()[0] === 1920 && canvas.getSize()[1] === 1080)
        || (canvas.isMarkerOnly && rootTsf.getWorldSize()[1] >= 540)
      : rootTsf.getWorldSize()[1] >= 540
    if (!isFullscreen) return
    const [ww, wh] = rootTsf.getWorldSize()
    // 幂等：已等于目标尺寸（16:9 视锥 = 原画布）时跳过
    if (Math.abs(ww - frustumW) < 1e-6 && Math.abs(wh - frustumH) < 1e-6) return
    rootTsf.setWorldSize(frustumW, frustumH)
    rootTsf.applyAnchor()
    // 容器尺寸已变：递归重算子树锚点（父先定，子锚点用新容器求解）
    const applyAnchors = (a: Actor): void => {
      for (const child of a.getChildren()) {
        child.getComponent(UITransformComponent)?.applyAnchor()
        applyAnchors(child)
      }
    }
    applyAnchors(root)
    logger.info(
      `[UIManager] 视口重排: 根 "${root.root.name}" ${ww.toFixed(0)}x${wh.toFixed(0)} → ${frustumW.toFixed(0)}x${frustumH.toFixed(0)}（contain 视锥）`,
    )
  }

  /**
   * 按大纲树序遍历重排渲染层级（zOrder）。
   *
   * 渲染层级 = 大纲树结构位置：深度优先遍历所有顶层 UI Actor（顺序与 UiOutline
   * 大纲一致：父→子、兄→弟），为每个节点的 CanvasUIComponent 分配递增的 zOrder
   * —— 树中靠后的节点（大纲中"在下面"的：子节点、后面的兄弟）zOrder 更大，
   * 渲染在上层，覆盖前面的节点。
   *
   * 特殊层：HUD 子类可覆写 layerBaseZ（如 GM 控制台 = GM_ZORDER_BASE），该子树
   * 整树抬升其层基准（GM 面板始终盖过常规 UI 树，浮动面板因树序靠后天然在
   * 常驻 HUD 之上）。
   *
   * 调用时机：UI 树结构变化后（commitSpawn / commitDestroy / 程序化挂载）。
   */
  reassignTreeOrder(): void {
    let order = 0
    const walk = (a: Actor, base: number): void => {
      // 特殊层 HUD（GM 控制台等）：子树整体抬升其层基准（子树内相对顺序不变）
      const nodeBase = a instanceof HUD && a.layerBaseZ > 0 ? a.layerBaseZ : base
      // 同节点多个 canvas 组件（UIText/UIImage/UIMarker）共享同一层级，
      // 靠各自 position.z 微偏移（UIText +0.0002）区分渲染前后
      for (const comp of a.getComponents(CanvasUIComponent)) {
        comp.zOrder = nodeBase + order
      }
      order += 1
      for (const child of a.getChildren()) walk(child, nodeBase)
    }
    for (const a of this._uiActors) {
      if (a.parent) continue
      walk(a, 0)
    }
  }

  /** 读取并清除 UI Actor 列表变化标记（由 World 在每帧提交后消费，触发 onActorListChanged 通知） */
  consumeUiListDirty(): boolean {
    const dirty = this._uiListDirty
    this._uiListDirty = false
    return dirty
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
    // 子树节点（attachTo 挂树、不在 _uiActors）：父链 EndPlay 递归 destroy() 到达这里，
    // 不能入队（commitDestroy 只处理 _uiActors 成员，入队会被丢弃 → 永久泄漏）。
    // 直接本地递归 EndPlay（EndPlay 递归子树，bPendingDestroy 短路防重）并拆离父树。
    if (!this._uiActors.has(actor)) {
      actor.bPendingDestroy = true
      actor.EndPlay()
      if (actor.parent) actor.detach()
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
    // 补间系统推进（与 rAF 自驱双保险：rAF 暂停的隐藏页面/测试环境仍可由外部 tick 驱动）
    TweenSystem.instance.update(dt)
    // Toast 队列推进（超时消失/队列补位）
    ToastSystem.instance.update(dt)
    this.commitSpawn()
    this.commitDestroy()
    for (const actor of this._uiActors) {
      if (actor.bPendingDestroy) continue
      // 锚定 widget 的 target 生命周期联动：target 消失（被销毁）→ widget 一并销毁。
      // world 面板无 target 语义，不受影响。
      const anchor = actor.getComponent(UIWorldAnchorComponent)
      if (anchor && anchor.mode === 'screen' && anchor.targetActorId && !this.owner.findActorByName(anchor.targetActorId)) {
        logger.info(`[UIManager] 锚定 widget "${actor.root.name}" 的 target "${anchor.targetActorId}" 已销毁 → 联动销毁`)
        this.destroyUIActor(actor)
        continue
      }
      actor.Tick(dt)
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
      if (this.isWorldSpaceUI(actor)) this.owner.scene.remove(actor.root)
      else this.scene.remove(actor.root)
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
    this._uiListDirty = true
  }

  /** 清空当前 HUD 引用（World 统一销毁 Actor 时调用，避免悬空引用） */
  clear(): void {
    this._hud = null
  }
}
