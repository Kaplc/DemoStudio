/**
 * registerBuiltinAIHandlers — 内置 AI 事件处理器
 *
 * 把 AIModule 事件接到引擎真实能力上（World / GameState / UIManager / 日志）。
 * 添加新内置事件：在 AIEvents.ts 定义常量/类型后，在此注册处理器即可。
 *
 * 处理器约定：
 *  - 通过 ctx.world 操作场景（未运行时为 null，返回提示）
 *  - 有返回值的处理器（如 ai.getState）返回值经 AIModule.emit 汇总回传 AI
 */
import { AIModule, type AIEventContext } from './AIModule'
import {
  AI_EVENT_NOTIFY,
  AI_EVENT_SPAWN_ACTOR,
  AI_EVENT_DESTROY_ACTOR,
  AI_EVENT_TRANSFORM_ACTOR,
  AI_EVENT_GET_STATE,
  AI_EVENT_SHOW_MESSAGE,
  AI_EVENT_CLICK_ACTOR,
  AI_EVENT_GET_ACTOR,
  AI_EVENT_SCROLL_CAMERA,
  AI_EVENT_GET_COMPONENT,
  AI_EVENT_SET_PROPERTY,
  AI_EVENT_CALL_ACTOR,
  AI_EVENT_MOUSE_CLICK,
  AI_EVENT_MOUSE_MOVE,
  AI_EVENT_MOUSE_DRAG,
  AI_EVENT_KEY_PRESS,
  AI_EVENT_KEY_RELEASE,
  AI_EVENT_GET_HUD,
  AI_EVENT_GET_SCENE_OUTLINE,
  type AINotifyPayload,
  type AISpawnActorPayload,
  type AIDestroyActorPayload,
  type AITransformActorPayload,
  type AIShowMessagePayload,
  type AIClickActorPayload,
  type AIGetActorPayload,
  type AIScrollCameraPayload,
  type AIGetComponentPayload,
  type AISetPropertyPayload,
  type AICallActorPayload,
  type AIMouseClickPayload,
  type AIMouseMovePayload,
  type AIMouseDragPayload,
  type AIKeyPayload,
  type AIActorInfo,
  type AIGameStateSnapshot,
  type AIHUDNode,
  type AISceneOutlineNode,
  type AIGetSceneOutlinePayload,
} from './AIEvents'
import { logger } from '../Logger'
import * as THREE from 'three'
import { World } from '../gameflow/World'
import { ActorRegistry } from '../tools/ActorRegistry'
import { Instantiate } from '../asset/BlueprintAsset'
import { ToastSystem } from '../ui/ToastSystem'
import { UIButtonComponent } from '../ui/UIButtonComponent'
import { UITextComponent } from '../ui/UITextComponent'
import { UIImageComponent } from '../ui/UIImageComponent'
import { UITransformComponent } from '../ui/UITransformComponent'
import { CanvasUIComponent } from '../rendering/CanvasUIComponent'
import { ClickableComponent } from '../physics/ClickableComponent'
import { destroyActor, getAllActors, spawnActor } from '../gameflow/ActorUtils'

/** 需要运行中 World 的守卫：返回 world 或 null（并提示） */
function requireWorld(ctx: AIEventContext): World | null {
  if (!ctx.world) {
    logger.warn('[AI] 事件需要游戏运行中（当前未运行）')
    return null
  }
  return ctx.world
}

/** 按名称查找 Actor（name 或 root.name，递归子节点，同时搜索 3D 和 UI Actor） */
function findActorByName(world: World, name: string) {
  const walk = (a: import('../entity/Actor').Actor): import('../entity/Actor').Actor | null => {
    if (a.name === name || a.root.name === name) return a
    for (const child of a.getChildren()) {
      const hit = walk(child)
      if (hit) return hit
    }
    return null
  }
  // 搜索 3D Actor
  for (const a of getAllActors()) {
    const hit = walk(a)
    if (hit) return hit
  }
  // 搜索 UI Actor（UIManager 独立管理）
  for (const a of world.ui.getAllUIActors()) {
    const hit = walk(a)
    if (hit) return hit
  }
  return null
}

/** 内置事件名全集（注册前先清除旧处理器，保证 HMR 重载后不重复注册） */
const BUILTIN_EVENTS = [
  AI_EVENT_NOTIFY,
  AI_EVENT_SHOW_MESSAGE,
  AI_EVENT_SPAWN_ACTOR,
  AI_EVENT_DESTROY_ACTOR,
  AI_EVENT_TRANSFORM_ACTOR,
  AI_EVENT_GET_STATE,
  AI_EVENT_CLICK_ACTOR,
  AI_EVENT_GET_ACTOR,
  AI_EVENT_SCROLL_CAMERA,
  AI_EVENT_GET_COMPONENT,
  AI_EVENT_SET_PROPERTY,
  AI_EVENT_CALL_ACTOR,
  AI_EVENT_MOUSE_CLICK,
  AI_EVENT_MOUSE_MOVE,
  AI_EVENT_MOUSE_DRAG,
  AI_EVENT_KEY_PRESS,
  AI_EVENT_KEY_RELEASE,
  AI_EVENT_GET_HUD,
  AI_EVENT_GET_SCENE_OUTLINE,
]

/**
 * 注册全部内置 AI 事件（幂等）。
 * HMR 场景：模块重载后本文件重新求值，但 AIModule 单例仍保留旧处理器，
 * 直接注册会导致事件重复触发（如 ai.notify 出现 8 个处理器）。
 * 因此每次调用都先清除内置事件旧处理器再注册 —— 始终只保留最新一份。
 */
export function registerBuiltinAIHandlers(): void {
  const ai = AIModule.instance
  for (const ev of BUILTIN_EVENTS) ai.clearEvent(ev)

  // ─── ai.notify — 通用通知（无需游戏运行） ───
  ai.register(AI_EVENT_NOTIFY, (payload: unknown) => {
    const p = (payload ?? {}) as AINotifyPayload
    const msg = p.message ?? '（空通知）'
    switch (p.level ?? 'info') {
      case 'warn': logger.warn(`[AI] ${msg}`); break
      case 'error': logger.error(`[AI] ${msg}`); break
      default: logger.info(`[AI] ${msg}`)
    }
    return { ok: true, message: msg }
  })

  // ─── ai.showMessage — UI 消息（ToastSystem 挂接时显示 toast 通知，否则回退日志） ───
  ai.register(AI_EVENT_SHOW_MESSAGE, (payload: unknown) => {
    const p = (payload ?? {}) as AIShowMessagePayload
    const msg = p.text ?? '（空消息）'
    // ToastSystem 已挂接（项目启动 attach）→ 显示 toast；未挂接回退日志
    if (ToastSystem.instance.attached) {
      ToastSystem.instance.show(msg, {
        priority: p.level === 'error' ? 'critical' : p.level === 'warn' ? 'high' : 'normal',
        duration: p.duration ?? 3,
      })
    } else {
      switch (p.level ?? 'info') {
        case 'warn': logger.warn(`[AI][UI] ${msg}`); break
        case 'error': logger.error(`[AI][UI] ${msg}`); break
        default: logger.info(`[AI][UI] ${msg}`)
      }
    }
    return { ok: true, message: msg }
  })

  // ─── ai.spawnActor — 生成 Actor ───
  ai.register(AI_EVENT_SPAWN_ACTOR, (payload: unknown, ctx: AIEventContext) => {
    const world = requireWorld(ctx)
    if (!world) return { ok: false, error: '游戏未运行' }
    const p = (payload ?? {}) as AISpawnActorPayload

    let actor = null
    if (p.blueprint) {
      actor = Instantiate(p.blueprint)
      if (!actor) return { ok: false, error: `蓝图生成失败: ${p.blueprint}` }
    } else if (p.baseClass) {
      actor = ActorRegistry.create(p.baseClass)
      if (!actor) return { ok: false, error: `baseClass 未注册: ${p.baseClass}` }
      spawnActor(actor)
      // 立即提交生成（否则要等下一帧 manualTick 才进入 allActors，随后的 transform/destroy 会找不到）
      world.manualTick(0)
    } else {
      return { ok: false, error: '缺少 blueprint 或 baseClass' }
    }

    if (p.name) {
      actor.root.name = p.name
      actor.name = p.name
    }
    if (p.position) actor.setPosition(p.position[0], p.position[1], p.position[2])
    if (p.rotation) actor.setRotation(p.rotation[0], p.rotation[1], p.rotation[2])
    if (p.scale) actor.setScale(p.scale[0], p.scale[1], p.scale[2])

    logger.info(`[AI] spawnActor: ${actor.name} (${actor.constructor.name})`)
    return { ok: true, uid: actor.uid, name: actor.name }
  })

  // ─── ai.destroyActor — 按名称销毁 ───
  ai.register(AI_EVENT_DESTROY_ACTOR, (payload: unknown, ctx: AIEventContext) => {
    const world = requireWorld(ctx)
    if (!world) return { ok: false, error: '游戏未运行' }
    const p = (payload ?? {}) as AIDestroyActorPayload
    if (!p.name) return { ok: false, error: '缺少 name' }
    const actor = findActorByName(world, p.name)
    if (!actor) return { ok: false, error: `未找到 Actor: ${p.name}` }
    destroyActor(actor)
    world.manualTick(0) // 立即提交销毁，保证后续 getState 即时反映
    logger.info(`[AI] destroyActor: ${p.name}`)
    return { ok: true, name: p.name }
  })

  // ─── ai.transformActor — 移动/旋转/缩放 ───
  ai.register(AI_EVENT_TRANSFORM_ACTOR, (payload: unknown, ctx: AIEventContext) => {
    const world = requireWorld(ctx)
    if (!world) return { ok: false, error: '游戏未运行' }
    const p = (payload ?? {}) as AITransformActorPayload
    if (!p.name) return { ok: false, error: '缺少 name' }
    const actor = findActorByName(world, p.name)
    if (!actor) return { ok: false, error: `未找到 Actor: ${p.name}` }
    if (p.position) actor.setPosition(p.position[0], p.position[1], p.position[2])
    if (p.rotation) actor.setRotation(p.rotation[0], p.rotation[1], p.rotation[2])
    if (p.scale) actor.setScale(p.scale[0], p.scale[1], p.scale[2])
    logger.info(`[AI] transformActor: ${p.name} -> pos=${p.position ? JSON.stringify(p.position) : '-'}`)
    return { ok: true, name: p.name }
  })

  // ─── ai.getState — 查询运行状态 ───
  ai.register(AI_EVENT_GET_STATE, (_payload: unknown, ctx: AIEventContext) => {
    const world = ctx.world
    const mapActor = (a: import('../entity/Actor').Actor) => ({
      name: a.name,
      type: a.constructor.name,
      scale: [a.root.scale.x, a.root.scale.y, a.root.scale.z] as [number, number, number],
      active: a.bActive,
    })
    const snapshot: AIGameStateSnapshot = {
      running: !!world?.running,
      phase: world?.gameState?.phase ?? 'idle',
      score: world?.gameState?.score ?? 0,
      gameOver: world?.gameState?.gameOver ?? false,
      actorCount: (world?.actorCount ?? 0) + (world?.ui.actorCount ?? 0),
      actors: world
        ? [
            ...getAllActors().map(mapActor),
            ...world.ui.getAllUIActors().map(mapActor),
          ]
        : [],
    }
    return snapshot
  })

  // ─── ai.clickActor — 按名称/文字/路径触发按钮点击（不依赖鼠标坐标） ───
  ai.register(AI_EVENT_CLICK_ACTOR, (payload: unknown, ctx: AIEventContext) => {
    const world = requireWorld(ctx)
    if (!world) return { ok: false, error: '游戏未运行' }
    const p = (payload ?? {}) as AIClickActorPayload

    if (!p.name && !p.text && !p.path) return { ok: false, error: '缺少 name、text 或 path' }

    /** 在指定 Actor 上查找并触发按钮（UIButtonComponent → ClickableComponent 兜底） */
    const triggerButtonsOn = (actor: import('../entity/Actor').Actor): { ok: boolean; clicked?: number; type?: string } => {
      // 优先触发 UI 按钮
      const buttons = actor.getComponents(UIButtonComponent)
      if (buttons.length > 0) {
        for (const b of buttons) b.triggerClick()
        return { ok: true, clicked: buttons.length, type: 'button' }
      }
      // 兜底：递归子树找按钮
      const findButtonActor = (a: import('../entity/Actor').Actor): import('../entity/Actor').Actor | null => {
        if (a.getComponents(UIButtonComponent).length > 0) return a
        for (const child of a.getChildren()) {
          const hit = findButtonActor(child)
          if (hit) return hit
        }
        return null
      }
      const buttonActor = findButtonActor(actor)
      if (buttonActor) {
        const bs = buttonActor.getComponents(UIButtonComponent)
        for (const b of bs) b.triggerClick()
        return { ok: true, clicked: bs.length, type: 'button' }
      }
      // 兜底：触发可点击组件
      const clickables = actor.getComponents(ClickableComponent)
      if (clickables.length > 0) {
        for (const c of clickables) c.onClick?.(undefined as never)
        return { ok: true, clicked: clickables.length, type: 'clickable' }
      }
      return { ok: false }
    }

    // ─── 按路径查找（最精确，getHUD 返回的 path） ───
    if (p.path) {
      const targetPath = p.path.startsWith('/') ? p.path : `/${p.path}`
      const uiActors = world.ui.getAllUIActors()

      /** 复用 getHUD 的路径生成逻辑，递归匹配 path */
      const findActorByPath = (actor: import('../entity/Actor').Actor, currentPath: string, siblingSegments: string[]): import('../entity/Actor').Actor | null => {
        // 构建当前节点的路径段（与 getHUD 一致）
        let segment = 'Actor'
        const actorTexts = actor.getComponents(UITextComponent)
        if (actorTexts.length > 0) {
          const t = actorTexts[0].text
          segment = t.length > 12 ? t.slice(0, 12) + '…' : t
        } else if (actor.name && actor.name !== 'Actor' && actor.name !== 'GenericActor') {
          segment = actor.name
        } else {
          // 子节点中有文字 → 用子节点文字
          for (const child of actor.getChildren()) {
            const childTexts = child.getComponents(UITextComponent)
            if (childTexts.length > 0) {
              const t = childTexts[0].text
              segment = t.length > 12 ? t.slice(0, 12) + '…' : t
              break
            }
          }
        }
        // 同父重名去重
        const usedCount = siblingSegments.filter((s) => s === segment).length
        if (usedCount > 0) segment = `${segment}_${usedCount + 1}`
        siblingSegments.push(segment)

        const fullPath = currentPath ? `${currentPath}/${segment}` : `/${segment}`
        if (fullPath === targetPath) return actor

        // 递归子节点
        const childSegments: string[] = []
        for (const child of actor.getChildren()) {
          const hit = findActorByPath(child, fullPath, childSegments)
          if (hit) return hit
        }
        return null
      }

      const rootSegments: string[] = []
      let target: import('../entity/Actor').Actor | null = null
      for (const actor of uiActors) {
        target = findActorByPath(actor, '', rootSegments)
        if (target) break
      }

      if (!target) return { ok: false, error: `未找到路径 "${targetPath}" 对应的 UI 元素` }
      const result = triggerButtonsOn(target)
      if (result.ok) {
        logger.info(`[AI] clickActor(path="${targetPath}"): 触发 ${result.clicked} 个 ${result.type}`)
        return result
      }
      return { ok: false, error: `路径 "${targetPath}" 对应的元素上没有可点击组件` }
    }

    // ─── 按名称查找（原有逻辑） ───
    if (p.name) {
      const actor = findActorByName(world, p.name)
      if (!actor) return { ok: false, error: `未找到 Actor: ${p.name}` }
      const result = triggerButtonsOn(actor)
      if (result.ok) {
        logger.info(`[AI] clickActor(name="${p.name}"): 触发 ${result.clicked} 个 ${result.type}`)
        return result
      }
      return { ok: false, error: `${p.name} 上没有 UIButtonComponent / ClickableComponent` }
    }

    // ─── 按 UI 文字查找（新逻辑）：遍历所有 UI Actor，找到包含指定文字的 Actor，触发其按钮 ───
    const searchText = p.text!
    const uiActors = world.ui.getAllUIActors()
    const findActorByText = (actor: import('../entity/Actor').Actor): import('../entity/Actor').Actor | null => {
      // 检查自身是否有匹配文字的 UITextComponent
      const texts = actor.getComponents(UITextComponent)
      if (texts.some((t) => t.text.includes(searchText))) return actor
      // 递归子节点
      for (const child of actor.getChildren()) {
        const hit = findActorByText(child)
        if (hit) return hit
      }
      return null
    }

    // 先找包含文字的 Actor
    let target: import('../entity/Actor').Actor | null = null
    for (const actor of uiActors) {
      target = findActorByText(actor)
      if (target) break
    }
    if (!target) return { ok: false, error: `未找到包含文字 "${searchText}" 的 UI 元素` }

    // 找到了文字 Actor——往上找最近的带按钮的祖先/自身
    const findClickableAncestor = (actor: import('../entity/Actor').Actor): import('../entity/Actor').Actor | null => {
      // 自身有按钮 → 直接用
      if (actor.getComponents(UIButtonComponent).length > 0) return actor
      // 自身有可点击组件 → 用
      if (actor.getComponents(ClickableComponent).length > 0) return actor
      // 往上找父 Actor（通过 root.parent.userData.actorRef）
      let current: import('../entity/Actor').Actor = actor
      while (current.root.parent) {
        const parentRef = current.root.parent.userData?.actorRef as import('../entity/Actor').Actor | undefined
        if (!parentRef) break
        if (parentRef.getComponents(UIButtonComponent).length > 0) return parentRef
        if (parentRef.getComponents(ClickableComponent).length > 0) return parentRef
        current = parentRef
      }
      return null
    }

    // 先尝试在文字 Actor 本身找按钮
    let clickTarget: import('../entity/Actor').Actor | null = target
    const btnResult = triggerButtonsOn(target)
    if (!btnResult.ok) {
      // 文字 Actor 本身没按钮，向上找可点击祖先
      clickTarget = findClickableAncestor(target)
      if (clickTarget) {
        const result = triggerButtonsOn(clickTarget)
        if (result.ok) {
          logger.info(`[AI] clickActor(text="${searchText}"): 文字在 "${target.name}"，按钮在 "${clickTarget.name}"，触发 ${result.clicked} 个 ${result.type}`)
          return result
        }
      }
      return { ok: false, error: `找到文字 "${searchText}"（在 ${target.name}），但周围没有可点击元素` }
    }

    logger.info(`[AI] clickActor(text="${searchText}"): 在 "${target.name}" 触发 ${btnResult.clicked} 个 ${btnResult.type}`)
    return btnResult
  })

  // ─── ai.getActor — 查询单个 Actor 详细信息（含按钮状态/缩放，递归查找） ───
  ai.register(AI_EVENT_GET_ACTOR, (payload: unknown, ctx: AIEventContext) => {
    const world = requireWorld(ctx)
    if (!world) return { ok: false, error: '游戏未运行' }
    const p = (payload ?? {}) as AIGetActorPayload
    if (!p.name) return { ok: false, error: '缺少 name' }

    const actor = findActorByName(world, p.name)
    if (!actor) return { ok: false, error: `未找到 Actor: ${p.name}` }

    const info: AIActorInfo = {
      name: actor.name,
      type: actor.constructor.name,
      position: [actor.root.position.x, actor.root.position.y, actor.root.position.z],
      rotation: [actor.root.rotation.x, actor.root.rotation.y, actor.root.rotation.z],
      scale: [actor.root.scale.x, actor.root.scale.y, actor.root.scale.z],
      active: actor.bActive,
      children: actor.getChildren().map((c) => ({ name: c.name, type: c.constructor.name })),
      // UI 组件渲染状态（验证 active 属性是否真正控制渲染）
      components: actor.getAllComponents().map((c) => {
        const anyC = c as unknown as { bActive?: boolean; mesh?: { visible?: boolean } }
        const panelVis = (c as unknown as { panel?: { visible?: boolean } }).panel?.visible
        const meshVis = anyC.mesh?.visible
        return {
          type: c.constructor.name,
          enabled: c.bEnabled,
          componentActive: anyC.bActive ?? undefined,
          renderVisible: panelVis ?? meshVis ?? undefined,
        }
      }),
    }
    // 按钮状态摘要（验证按下缩放动效：state=pressed 时 scale 应为原始 × pressScale）
    const buttons = actor.getComponents(UIButtonComponent)
    if (buttons.length > 0) {
      info.buttons = buttons.map((b) => ({ state: b.state, pressScale: b.pressScale }))
    }
    return { ok: true, actor: info }
  })

  // ─── ai.scrollCamera — 模拟鼠标滚轮缩放摄像机（delta>0 拉远 / <0 拉近，与 PlayerController.OnScroll 一致） ───
  ai.register(AI_EVENT_SCROLL_CAMERA, (payload: unknown, ctx: AIEventContext) => {
    const world = requireWorld(ctx)
    if (!world) return { ok: false, error: '游戏未运行' }
    const p = (payload ?? {}) as AIScrollCameraPayload
    if (typeof p.delta !== 'number' || !Number.isFinite(p.delta)) {
      return { ok: false, error: '缺少 delta（数字）' }
    }

    // 目标摄像机：优先按名称指定，否则用当前 GameMode 上第一个带 zoom 方法的摄像机
    // （鸭子类型：engine 不依赖 projects。支持 Actor 方法（zoom）或组件（rig.zoom）两种形态）
    const findZoomable = (obj: unknown): { zoom?: (delta: number) => void } | null => {
      const o = obj as { zoom?: (d: number) => void; getComponents?: (t: unknown) => unknown[] }
      if (o && typeof o.zoom === 'function') return o
      // 组件形态：遍历 getComponents 找带 zoom 的组件（如 CameraRigComponent）
      if (o && typeof o.getComponents === 'function') {
        const all = (o as unknown as { getAllComponents?: () => unknown[] }).getAllComponents?.() ?? []
        for (const c of all) {
          const z = c as { zoom?: (d: number) => void }
          if (z && typeof z.zoom === 'function') return z
        }
      }
      return null
    }

    let target: { zoom?: (delta: number) => void } | null = null
    if (p.camera) {
      const actor = findActorByName(world, p.camera)
      if (!actor) return { ok: false, error: `未找到 Actor: ${p.camera}` }
      // 鸭子类型：Actor 方法（zoom）或 rig 组件（CameraRigComponent）
      const actorRig = (actor as unknown as { rig?: unknown }).rig
      target = findZoomable(actor) ?? findZoomable(actorRig)
      if (!target) return { ok: false, error: `${p.camera} 上没有可调用的 zoom 方法` }
    } else {
      const gm = world.gameMode as Record<string, unknown> | null
      if (gm) {
        for (const v of Object.values(gm)) {
          target = findZoomable(v) ?? findZoomable((v as { rig?: unknown })?.rig)
          if (target) break
        }
      }
      if (!target) return { ok: false, error: '当前 GameMode 上没有可缩放摄像机（需运行基地阶段）' }
    }

    target.zoom?.(p.delta)
    // 读取缩放后距离：target 可能是组件（rig，有 target 注视点 + owner 是摄像机 actor）
    const anyT = target as {
      owner?: { camera?: { position?: { x: number; y: number; z: number } }; root?: { position?: { x: number; y: number; z: number } } }
      camera?: { position?: { x: number; y: number; z: number } }
      root?: { position?: { x: number; y: number; z: number } }
      target?: { x: number; y: number; z: number }
      position?: { x: number; y: number; z: number }
    }
    const ownerCam = anyT.owner?.camera?.position ?? anyT.owner?.root?.position
    const pos = ownerCam ?? anyT.camera?.position ?? anyT.root?.position ?? anyT.position
    const distance =
      anyT.target && pos
        ? Math.hypot(pos.x - anyT.target.x, pos.y - anyT.target.y, pos.z - anyT.target.z)
        : undefined
    logger.info(`[AI] scrollCamera: delta=${p.delta} distance=${distance?.toFixed(2) ?? '?'}`)
    return { ok: true, delta: p.delta, distance }
  })

  // ─── ai.mouseClick — 模拟鼠标点击（经 InputSys 完整管线：raycast → ClickableComponent → controller） ───
  ai.register(AI_EVENT_MOUSE_CLICK, (payload: unknown, ctx: AIEventContext) => {
    const world = requireWorld(ctx)
    if (!world) return { ok: false, error: '游戏未运行' }
    const gi = ctx.gameInstance
    if (!gi) return { ok: false, error: '无 GameInstance' }
    const p = (payload ?? {}) as AIMouseClickPayload
    if (typeof p.screenX !== 'number' || typeof p.screenY !== 'number') {
      return { ok: false, error: '缺少 screenX/screenY（数字）' }
    }
    const button = p.button ?? 0
    const worldPos = p.worldPos
      ? new THREE.Vector3(p.worldPos[0], p.worldPos[1], p.worldPos[2])
      : undefined

    // 执行完整点击管线：InputSys.handlePointerDown → PhySys.raycastClick → controller
    const consumed = gi.inputSys.handlePointerDown(p.screenX, p.screenY, worldPos, gi.controller, button)
    logger.info(`[AI] mouseClick: (${p.screenX}, ${p.screenY}) button=${button} consumed=${consumed}`)
    return { ok: true, screenX: p.screenX, screenY: p.screenY, consumed }
  })

  // ─── ai.mouseMove — 模拟鼠标移动（触发 hover 射线检测 + 拖拽分发） ───
  ai.register(AI_EVENT_MOUSE_MOVE, (payload: unknown, ctx: AIEventContext) => {
    const world = requireWorld(ctx)
    if (!world) return { ok: false, error: '游戏未运行' }
    const gi = ctx.gameInstance
    if (!gi) return { ok: false, error: '无 GameInstance' }
    const p = (payload ?? {}) as AIMouseMovePayload
    if (typeof p.screenX !== 'number' || typeof p.screenY !== 'number') {
      return { ok: false, error: '缺少 screenX/screenY（数字）' }
    }
    const worldPos = p.worldPos
      ? new THREE.Vector3(p.worldPos[0], p.worldPos[1], p.worldPos[2])
      : undefined

    gi.inputSys.handlePointerMove(p.screenX, p.screenY, worldPos, gi.controller)
    logger.info(`[AI] mouseMove: (${p.screenX}, ${p.screenY})`)
    return { ok: true, screenX: p.screenX, screenY: p.screenY }
  })

  // ─── ai.mouseDrag — 模拟鼠标拖拽（按下→多步移动→释放，完整序列） ───
  ai.register(AI_EVENT_MOUSE_DRAG, async (payload: unknown, ctx: AIEventContext) => {
    const world = requireWorld(ctx)
    if (!world) return { ok: false, error: '游戏未运行' }
    const gi = ctx.gameInstance
    if (!gi) return { ok: false, error: '无 GameInstance' }
    const p = (payload ?? {}) as AIMouseDragPayload
    if (typeof p.startX !== 'number' || typeof p.startY !== 'number' ||
        typeof p.endX !== 'number' || typeof p.endY !== 'number') {
      return { ok: false, error: '缺少 startX/startY/endX/endY（数字）' }
    }
    const steps = Math.max(1, p.steps ?? 10)
    const stepDelay = Math.max(0, p.stepDelayMs ?? 16)

    // 1. 按下
    gi.inputSys.handlePointerDown(p.startX, p.startY, undefined, gi.controller, 0)

    // 2. 逐步移动
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const x = p.startX + (p.endX - p.startX) * t
      const y = p.startY + (p.endY - p.startY) * t
      gi.inputSys.handlePointerMove(x, y, undefined, gi.controller)
      if (stepDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, stepDelay))
      }
    }

    // 3. 释放
    gi.inputSys.handlePointerUp(undefined, gi.controller, 0)
    logger.info(`[AI] mouseDrag: (${p.startX},${p.startY}) → (${p.endX},${p.endY}) steps=${steps}`)
    return { ok: true, startX: p.startX, startY: p.startY, endX: p.endX, endY: p.endY, steps }
  })

  // ─── ai.keyPress — 模拟键盘按下 ───
  ai.register(AI_EVENT_KEY_PRESS, (payload: unknown, ctx: AIEventContext) => {
    const world = requireWorld(ctx)
    if (!world) return { ok: false, error: '游戏未运行' }
    const gi = ctx.gameInstance
    if (!gi) return { ok: false, error: '无 GameInstance' }
    const p = (payload ?? {}) as AIKeyPayload
    if (!p.key) return { ok: false, error: '缺少 key' }

    gi.inputSys.handleKeyDown(p.key, gi.controller)
    logger.info(`[AI] keyPress: ${p.key}`)
    return { ok: true, key: p.key, action: 'pressed' }
  })

  // ─── ai.keyRelease — 模拟键盘释放 ───
  ai.register(AI_EVENT_KEY_RELEASE, (payload: unknown, ctx: AIEventContext) => {
    const world = requireWorld(ctx)
    if (!world) return { ok: false, error: '游戏未运行' }
    const gi = ctx.gameInstance
    if (!gi) return { ok: false, error: '无 GameInstance' }
    const p = (payload ?? {}) as AIKeyPayload
    if (!p.key) return { ok: false, error: '缺少 key' }

    gi.inputSys.handleKeyUp(p.key, gi.controller)
    logger.info(`[AI] keyRelease: ${p.key}`)
    return { ok: true, key: p.key, action: 'released' }
  })

  // ─── ai.getHUD — 获取完整 HUD 结构（递归遍历 UI 树，返回文字/按钮状态/图片等） ───
  ai.register(AI_EVENT_GET_HUD, (_payload: unknown, ctx: AIEventContext) => {
    const world = requireWorld(ctx)
    if (!world) return { ok: false, error: '游戏未运行' }

    /**
     * 为节点生成路径段（同父范围内唯一）：
     * 优先级：自身有文字 → 用文字；自身有名字且非 GenericActor → 用名字；
     * 子节点中有文字 → 用子节点文字；都没有 → "Actor"
     * 同父重名时追加 _2/_3… 后缀（与编辑器大纲一致）
     */
    const buildSegments = (actor: import('../entity/Actor').Actor): string => {
      // 自身有文字 → 用文字
      const texts = actor.getComponents(UITextComponent)
      if (texts.length > 0) {
        const t = texts[0].text
        return t.length > 12 ? t.slice(0, 12) + '…' : t
      }
      // 自身有名字且非通用名 → 用名字
      if (actor.name && actor.name !== 'Actor' && actor.name !== 'GenericActor') {
        return actor.name
      }
      // 子节点中有文字 → 用子节点文字（按钮容器常把文字放子节点）
      for (const child of actor.getChildren()) {
        const childTexts = child.getComponents(UITextComponent)
        if (childTexts.length > 0) {
          const t = childTexts[0].text
          return t.length > 12 ? t.slice(0, 12) + '…' : t
        }
      }
      return 'Actor'
    }

    /** 递归构建 UI 节点树 */
    const buildNode = (actor: import('../entity/Actor').Actor, parentPath: string, siblingSegments: string[]): AIHUDNode => {
      let segment = buildSegments(actor)
      // 同父重名去重（与编辑器 uniqueNodeName 一致）
      const usedCount = siblingSegments.filter((s) => s === segment).length
      if (usedCount > 0) segment = `${segment}_${usedCount + 1}`
      siblingSegments.push(segment)

      const path = parentPath ? `${parentPath}/${segment}` : `/${segment}`

      const node: AIHUDNode = {
        name: actor.name,
        path,
        type: actor.constructor.name,
        active: actor.bActive,
        children: [],
      }

      // 读取 UITransformComponent 的世界尺寸
      const tsf = actor.getComponent(UITransformComponent)
      if (tsf) {
        const [ww, wh] = tsf.getWorldSize()
        node.worldSize = [Math.round(ww * 100) / 100, Math.round(wh * 100) / 100]
      }

      // 世界坐标
      const p = actor.root.position
      node.position = [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, Math.round(p.z * 100) / 100]

      // 读取 UITextComponent 的文字内容
      const texts = actor.getComponents(UITextComponent)
      if (texts.length > 0) {
        node.text = texts.map((t) => t.text).join('')
      }

      // 读取 UIButtonComponent 的按钮状态
      const buttons = actor.getComponents(UIButtonComponent)
      if (buttons.length > 0) {
        node.buttonState = buttons[0].state
      }

      // 读取 UIImageComponent 的图片资源
      const images = actor.getComponents(UIImageComponent)
      if (images.length > 0) {
        const img = images[0] as unknown as { src?: string; _src?: string }
        node.imageSrc = img.src ?? img._src ?? undefined
      }

      // 读取 CanvasUIComponent 的 zOrder
      const canvas = actor.getComponent(CanvasUIComponent)
      if (canvas) {
        node.zOrder = canvas.zOrder
      }

      // 递归子节点
      const childSegments: string[] = []
      const children = actor.getChildren()
      for (let i = 0; i < children.length; i++) {
        node.children.push(buildNode(children[i], path, childSegments))
      }

      return node
    }

    // 从 UIManager 获取所有 UI Actor，构建完整 HUD 树
    const uiActors = world.ui.getAllUIActors()
    const hudTree: AIHUDNode[] = []
    const rootSegments: string[] = []
    for (let i = 0; i < uiActors.length; i++) {
      hudTree.push(buildNode(uiActors[i], '', rootSegments))
    }

    logger.info(`[AI] getHUD: ${uiActors.length} 个根 UI Actor`)
    return { ok: true, hud: hudTree }
  })

  // ─── ai.getSceneOutline — 获取场景完整 Actor 大纲（3D + UI 树，供 AI 测试定位） ───
  ai.register(AI_EVENT_GET_SCENE_OUTLINE, (payload: unknown, ctx: AIEventContext) => {
    const world = requireWorld(ctx)
    if (!world) return { ok: false, error: '游戏未运行' }
    const p = (payload ?? {}) as AIGetSceneOutlinePayload
    const maxDepth = typeof p.maxDepth === 'number' && p.maxDepth > 0 ? Math.floor(p.maxDepth) : 6
    const activeOnly = p.activeOnly === true

    /** 递归构建大纲节点（超深截断，组件只返回类型名摘要） */
    const buildOutline = (actor: import('../entity/Actor').Actor, depth: number): AISceneOutlineNode => {
      const node: AISceneOutlineNode = {
        name: actor.root.name || actor.name,
        type: actor.constructor.name,
        active: actor.bActive,
        components: actor.getAllComponents().map((c) => c.constructor.name),
        children: [],
      }
      if (depth >= maxDepth) return node
      for (const child of actor.getChildren()) {
        if (activeOnly && !child.bActive) continue
        node.children.push(buildOutline(child, depth + 1))
      }
      return node
    }

    const outline: AISceneOutlineNode[] = []
    // 去重：UI Actor 可能同时挂在 3D 根（HUD）下与 UIManager 根列表中，避免重复列出
    const visited = new Set<unknown>()
    // 3D Actor（ActorUtils 全局列表）
    for (const a of getAllActors()) {
      if (visited.has(a)) continue
      visited.add(a)
      if (activeOnly && !a.bActive) continue
      outline.push(buildOutline(a, 0))
    }
    // UI Actor（UIManager 独立管理，跳过已列出的）
    const uiActors = world.ui.getAllUIActors()
    for (const a of uiActors) {
      if (visited.has(a)) continue
      visited.add(a)
      if (activeOnly && !a.bActive) continue
      outline.push(buildOutline(a, 0))
    }

    logger.info(`[AI] getSceneOutline: ${getAllActors().length} 个 3D Actor + ${uiActors.length} 个 UI 根 Actor`)
    return { ok: true, outline }
  })

  logger.info(`[AIModule] 内置事件处理器已注册: ${ai.listEvents().join(', ')}`)
}
