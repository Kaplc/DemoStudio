/**
 * AIModule — AI 事件模块（事件总线 + 处理器注册表）
 *
 * 让 AI（经 MCP）以"事件"方式控制游戏场景：
 *   AIModule.instance.emit('ai.spawnActor', { blueprint: '...', position: [...] })
 *
 * 设计目标：
 *  - 事件模式：AI 发事件 → 处理器执行 → （可选）返回值回传
 *  - 方便配置：register/unregister 动态增删处理器；事件名 + payload 集中定义在 AIEvents.ts
 *  - 场景上下文：World / GameInstance / UIManager 由 Game 生命周期注入（setWorld/setGameInstance）
 *  - 松耦合：模块不感知 MCP/编辑器，只提供事件能力；桥接在编辑器层完成
 *
 * 使用：
 *   // 游戏代码注册自定义事件
 *   AIModule.instance.register('ai.myEvent', (payload, ctx) => { ... })
 *   // 卸载
 *   AIModule.instance.unregister('ai.myEvent', handler)
 */
import { logger } from '../Logger'
import type { World } from '../gameflow/World'
import type { GameInstance } from '../gameflow/GameInstance'

/** 事件处理器上下文（引擎运行时的可操作对象） */
export interface AIEventContext {
  /** 当前运行 World（未运行时为 null） */
  world: World | null
  /** 当前游戏实例（未运行时为 null） */
  gameInstance: GameInstance | null
  /** 是否处于游戏运行中 */
  readonly running: boolean
}

/** 事件处理器：返回 void；也可返回任意数据供 emit 汇总回传（如 ai.getState） */
export type AIEventHandler = (
  payload: unknown,
  ctx: AIEventContext,
) => unknown | void

/** emit 结果：按注册顺序汇总各处理器返回值 */
export interface AIEmitResult {
  event: string
  /** 是否有处理器执行 */
  handled: boolean
  /** 各处理器返回值（未返回值的处理器为 undefined） */
  results: unknown[]
}

export class AIModule {
  private static _instance: AIModule | null = null

  /** 单例（引擎内全局唯一） */
  static get instance(): AIModule {
    if (!AIModule._instance) AIModule._instance = new AIModule()
    return AIModule._instance
  }

  private handlers = new Map<string, AIEventHandler[]>()
  private _world: World | null = null
  private _gameInstance: GameInstance | null = null

  /** 当前 World（由 Game 生命周期注入） */
  get world(): World | null { return this._world }
  /** 当前游戏实例 */
  get gameInstance(): GameInstance | null { return this._gameInstance }
  get running(): boolean { return this._world?.running ?? false }

  // ═══════════════════════════════════════
  //  上下文注入（Game.launch / shutdown 调用）
  // ═══════════════════════════════════════

  /** 游戏启动时注入运行上下文 */
  attachContext(world: World, gameInstance: GameInstance | null = null): void {
    this._world = world
    this._gameInstance = gameInstance
    logger.info(`[AIModule] 上下文已附加: world=${world.constructor.name}, running=${world.running}`)
  }

  /** 游戏停止时清空上下文 */
  detachContext(): void {
    this._world = null
    this._gameInstance = null
    logger.info('[AIModule] 上下文已清空（游戏停止）')
  }

  // ═══════════════════════════════════════
  //  处理器注册表
  // ═══════════════════════════════════════

  /**
   * 注册事件处理器（可多个）。返回注销函数。
   * 事件名不要求预先声明——任何字符串都可注册，方便自定义事件。
   */
  register(event: string, handler: AIEventHandler): () => void {
    let list = this.handlers.get(event)
    if (!list) {
      list = []
      this.handlers.set(event, list)
    }
    list.push(handler)
    logger.debug(`[AIModule] 注册事件处理器: ${event}（当前 ${list.length} 个）`)
    return () => this.unregister(event, handler)
  }

  /** 注销单个处理器 */
  unregister(event: string, handler: AIEventHandler): void {
    const list = this.handlers.get(event)
    if (!list) return
    const idx = list.indexOf(handler)
    if (idx >= 0) list.splice(idx, 1)
    if (list.length === 0) this.handlers.delete(event)
  }

  /** 注销事件的全部处理器 */
  clearEvent(event: string): void {
    this.handlers.delete(event)
  }

  /** 是否存在该事件的处理器 */
  has(event: string): boolean {
    return (this.handlers.get(event)?.length ?? 0) > 0
  }

  /** 列出已注册的事件名（按注册顺序） */
  listEvents(): string[] {
    return Array.from(this.handlers.keys())
  }

  /** 清空所有处理器（保留上下文） */
  clearAll(): void {
    this.handlers.clear()
  }

  // ═══════════════════════════════════════
  //  事件分发（AI 触发入口）
  // ═══════════════════════════════════════

  /**
   * 触发事件：按注册顺序调用所有处理器，汇总返回值。
   * 未注册任何处理器时 handled=false（可据此提示 AI 事件无效）。
   */
  emit(event: string, payload: unknown = undefined): AIEmitResult {
    const list = this.handlers.get(event)
    if (!list || list.length === 0) {
      logger.warn(`[AIModule] 事件 "${event}" 无处理器（未注册？），已忽略`)
      return { event, handled: false, results: [] }
    }
    const ctx: AIEventContext = {
      world: this._world,
      gameInstance: this._gameInstance,
      get running() { return AIModule.instance._world?.running ?? false },
    }
    const results: unknown[] = []
    for (const handler of list) {
      try {
        results.push(handler(payload, ctx))
      } catch (err) {
        logger.error(`[AIModule] 事件 "${event}" 处理器异常: ${(err as Error).message}`)
        results.push(undefined)
      }
    }
    logger.info(`[AIModule] 事件触发: ${event}（${list.length} 个处理器）`)
    return { event, handled: true, results }
  }
}
