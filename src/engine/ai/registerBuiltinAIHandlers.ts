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
  AI_EVENT_SET_SCORE,
  AI_EVENT_ADD_SCORE,
  AI_EVENT_GAME_OVER,
  AI_EVENT_SWITCH_SCENE,
  AI_EVENT_GET_STATE,
  AI_EVENT_SHOW_MESSAGE,
  AI_EVENT_CLICK_ACTOR,
  type AINotifyPayload,
  type AISpawnActorPayload,
  type AIDestroyActorPayload,
  type AITransformActorPayload,
  type AISetScorePayload,
  type AIAddScorePayload,
  type AISwitchScenePayload,
  type AIShowMessagePayload,
  type AIClickActorPayload,
  type AIGameStateSnapshot,
} from './AIEvents'
import { logger } from '../Logger'
import { World } from '../gameplay/gameflow/World'
import { ActorRegistry } from '../gameplay/tools/ActorRegistry'
import { UIButtonComponent } from '../gameplay/ui/UIButtonComponent'
import { ClickableComponent } from '../gameplay/physics/ClickableComponent'

/** 需要运行中 World 的守卫：返回 world 或 null（并提示） */
function requireWorld(ctx: AIEventContext): World | null {
  if (!ctx.world) {
    logger.warn('[AI] 事件需要游戏运行中（当前未运行）')
    return null
  }
  return ctx.world
}

/** 按名称查找 Actor（name 或 root.name，递归子节点） */
function findActorByName(world: World, name: string) {
  const walk = (a: import('../gameplay/entity/Actor').Actor): import('../gameplay/entity/Actor').Actor | null => {
    if (a.name === name || a.root.name === name) return a
    for (const child of a.getChildren()) {
      const hit = walk(child)
      if (hit) return hit
    }
    return null
  }
  for (const a of world.GetAllActors()) {
    const hit = walk(a)
    if (hit) return hit
  }
  return null
}

let _registered = false

/** 注册全部内置 AI 事件（幂等） */
export function registerBuiltinAIHandlers(): void {
  if (_registered) return
  _registered = true

  const ai = AIModule.instance

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

  // ─── ai.showMessage — UI 消息（暂以日志通知实现，预留 UI 通道） ───
  ai.register(AI_EVENT_SHOW_MESSAGE, (payload: unknown) => {
    const p = (payload ?? {}) as AIShowMessagePayload
    const msg = p.text ?? '（空消息）'
    switch (p.level ?? 'info') {
      case 'warn': logger.warn(`[AI][UI] ${msg}`); break
      case 'error': logger.error(`[AI][UI] ${msg}`); break
      default: logger.info(`[AI][UI] ${msg}`)
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
      actor = world.SpawnActorFromBlueprint(p.blueprint, undefined)
      if (!actor) return { ok: false, error: `蓝图生成失败: ${p.blueprint}` }
    } else if (p.baseClass) {
      actor = ActorRegistry.create(p.baseClass)
      if (!actor) return { ok: false, error: `baseClass 未注册: ${p.baseClass}` }
      world.SpawnActor(actor)
      // 立即提交生成（否则要等下一帧 manualTick 才进入 allActors，随后的 transform/destroy 会找不到）
      world.manualTick(0)
    } else {
      return { ok: false, error: '缺少 blueprint 或 baseClass' }
    }

    if (p.name) { actor.root.name = p.name }
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
    world.DestroyActor(actor)
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

  // ─── ai.setScore / ai.addScore — 分数 ───
  ai.register(AI_EVENT_SET_SCORE, (payload: unknown, ctx: AIEventContext) => {
    const world = requireWorld(ctx)
    if (!world || !world.gameState) return { ok: false, error: '游戏未运行或无 GameState' }
    const p = (payload ?? {}) as AISetScorePayload
    if (typeof p.score !== 'number') return { ok: false, error: '缺少 score' }
    const gs = world.gameState
    const diff = p.score - gs.score
    gs.addScore(diff)
    world.gameMode?.OnScoreChanged(p.score)
    logger.info(`[AI] setScore: ${p.score}`)
    return { ok: true, score: p.score }
  })

  ai.register(AI_EVENT_ADD_SCORE, (payload: unknown, ctx: AIEventContext) => {
    const world = requireWorld(ctx)
    if (!world || !world.gameState) return { ok: false, error: '游戏未运行或无 GameState' }
    const p = (payload ?? {}) as AIAddScorePayload
    if (typeof p.amount !== 'number') return { ok: false, error: '缺少 amount' }
    world.gameState.addScore(p.amount)
    world.gameMode?.OnScoreChanged(world.gameState.score)
    logger.info(`[AI] addScore: +${p.amount}`)
    return { ok: true, score: world.gameState.score }
  })

  // ─── ai.gameOver — 结束游戏 ───
  ai.register(AI_EVENT_GAME_OVER, (_payload: unknown, ctx: AIEventContext) => {
    const world = requireWorld(ctx)
    if (!world || !world.gameState) return { ok: false, error: '游戏未运行或无 GameState' }
    world.gameState.setPhase('gameover')
    logger.info('[AI] gameOver: 已设置 gameover 阶段')
    return { ok: true, phase: 'gameover' }
  })

  // ─── ai.switchScene — 切换场景 ───
  ai.register(AI_EVENT_SWITCH_SCENE, (payload: unknown, ctx: AIEventContext) => {
    const world = requireWorld(ctx)
    if (!world) return { ok: false, error: '游戏未运行' }
    const p = (payload ?? {}) as AISwitchScenePayload
    if (!p.scene) return { ok: false, error: '缺少 scene' }
    const ok = world.SwitchToScene(p.scene, undefined)
    logger.info(`[AI] switchScene: ${p.scene} -> ${ok ? '成功' : '失败'}`)
    return { ok, scene: p.scene }
  })

  // ─── ai.getState — 查询运行状态 ───
  ai.register(AI_EVENT_GET_STATE, (_payload: unknown, ctx: AIEventContext) => {
    const world = ctx.world
    const snapshot: AIGameStateSnapshot = {
      running: !!world?.running,
      phase: world?.gameState?.phase ?? 'idle',
      score: world?.gameState?.score ?? 0,
      gameOver: world?.gameState?.gameOver ?? false,
      actorCount: world?.actorCount ?? 0,
      actors: world
        ? world.GetAllActors().map((a) => ({ name: a.name, type: a.constructor.name }))
        : [],
    }
    return snapshot
  })

  // ─── ai.clickActor — 按名称触发 UI 按钮点击（不依赖鼠标坐标） ───
  ai.register(AI_EVENT_CLICK_ACTOR, (payload: unknown, ctx: AIEventContext) => {
    const world = requireWorld(ctx)
    if (!world) return { ok: false, error: '游戏未运行' }
    const p = (payload ?? {}) as AIClickActorPayload
    if (!p.name) return { ok: false, error: '缺少 name' }

    // 递归查找（按钮通常在 HUD 树的子节点上）
    const actor = findActorByName(world, p.name)
    if (!actor) return { ok: false, error: `未找到 Actor: ${p.name}` }

    // 优先触发 UI 按钮（UIButtonComponent 构造时自动挂 ClickableComponent）
    const buttons = actor.getComponents(UIButtonComponent)
    if (buttons.length > 0) {
      for (const b of buttons) b.triggerClick()
      logger.info(`[AI] clickActor: ${p.name} 触发 ${buttons.length} 个按钮`)
      return { ok: true, clicked: buttons.length, type: 'button' }
    }

    // 兜底：触发普通可点击组件（AI 触发无 raycast hit，传空对象占位）
    const clickables = actor.getComponents(ClickableComponent)
    if (clickables.length > 0) {
      for (const c of clickables) c.onClick?.(undefined as never)
      logger.info(`[AI] clickActor: ${p.name} 触发 ${clickables.length} 个可点击组件`)
      return { ok: true, clicked: clickables.length, type: 'clickable' }
    }

    return { ok: false, error: `${p.name} 上没有 UIButtonComponent / ClickableComponent` }
  })

  logger.info(`[AIModule] 内置事件处理器已注册: ${ai.listEvents().join(', ')}`)
}
