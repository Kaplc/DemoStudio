/**
 * PerfStatsCollector — 引擎性能采集器（模块化单例）
 *
 * 架构：一个采集器，两个消费者。
 *   Game 启动 → start(world) → 自持 rAF 逐帧采样（注册晚于编辑器渲染 rAF，
 *   同帧内后执行，读到的是上一完整帧的两趟渲染累计）→ 快照挂 window.__dsPerf
 *     ├─ ai.getPerfStats 事件（AI 读，DSH emit_ai_event / MCP ai_event 直达）
 *     └─ perf-collect IPC 往返（性能分析器独立窗口读，1s 轮询关窗即停）
 *
 * 扩展点：IPerfModule（PerfTypes.ts）——新分析模块 register() 即纳入快照。
 *
 * ⚠️ renderer.info.autoReset 接管：three 默认每次 render() 后重置 info，而本引擎
 * 每帧渲染两趟（世界 + UI 叠加），直读只会拿到 UI 最后一趟的数字。采集器运行期
 * 置 autoReset=false 并在每帧采样后手动 reset，停止时归还 true。
 */
import type { World } from '../../gameflow/World'
import type { PerfSnapshot } from '../../../types/perf'
import { createBuiltinPerfModules } from './builtinModules'
import type { IPerfModule, PerfSampleContext } from './PerfTypes'
import { logger } from '../../Logger'

/** 历史环形缓冲上限（约 2 分钟 @1s 粒度，面板趋势图用） */
const HISTORY_LIMIT = 120

/** renderer.info 最小结构（避免对 three 具体类型硬依赖，便于测试替换） */
interface RendererInfoLike {
  info: { autoReset: boolean; reset(): void }
}

export class PerfStatsCollector {
  private static _instance: PerfStatsCollector | null = null

  /** 全局单例（懒创建；创建即挂 window.__dsPerf，游戏未运行也可被读取） */
  static instance(): PerfStatsCollector {
    if (!PerfStatsCollector._instance) {
      PerfStatsCollector._instance = new PerfStatsCollector()
      PerfStatsCollector._instance._installWindowGlobal()
    }
    return PerfStatsCollector._instance
  }

  /** 仅 vitest 用：停采并丢弃单例（模块级状态跨用例泄漏是必踩坑，先例 clearImageDataUrlCacheForTest） */
  static resetForTest(): void {
    if (PerfStatsCollector._instance) {
      PerfStatsCollector._instance.stop()
      PerfStatsCollector._instance = null
    }
  }

  private _modules = new Map<string, IPerfModule>()
  private _world: World | null = null
  private _running = false
  private _rafId: number | null = null
  private _lastTickAt = 0
  private _lastSampleAt = new Map<string, number>()
  private _history: PerfSnapshot[] = []
  private _latest: PerfSnapshot | null = null
  private _renderer: RendererInfoLike | null = null

  private constructor() {
    for (const mod of createBuiltinPerfModules()) this.register(mod)
  }

  // ─── 模块注册（扩展点） ───

  /** 注册采集模块（同名覆盖并告警；运行中注册立即接线 setup） */
  register(mod: IPerfModule): void {
    if (this._modules.has(mod.name)) {
      logger.warn(`[PerfCollector] 模块 "${mod.name}" 已存在，覆盖注册`)
    }
    this._modules.set(mod.name, mod)
    if (this._running) mod.setup?.(this._buildContext(0))
    logger.info(`[PerfCollector] 模块已注册: ${mod.name} (${mod.label}, ${mod.intervalMs}ms)`)
  }

  /** 注销采集模块（触发 dispose） */
  unregister(name: string): void {
    const mod = this._modules.get(name)
    if (!mod) return
    this._modules.delete(name)
    mod.dispose?.()
    logger.info(`[PerfCollector] 模块已注销: ${name}`)
  }

  /** 已注册模块名清单（诊断/测试用） */
  getModuleNames(): string[] {
    return [...this._modules.keys()]
  }

  // ─── 生命周期（Game.launch / Game.shutdown 挂钩） ───

  /**
   * 开始采样（游戏启动调用；已运行中重复调用仅刷新 World，不重启循环）。
   * @param world 运行中的 World（null 允许：仅跑 fps/js 等无世界依赖模块）
   */
  start(world: World | null): void {
    if (this._running) {
      this._world = world
      return
    }
    this._running = true
    this._world = world
    this._lastTickAt = 0
    this._lastSampleAt.clear()
    const ctx = this._buildContext(0)
    for (const mod of this._modules.values()) mod.setup?.(ctx)
    this._schedule()
    logger.info(`[PerfCollector] 采样已启动（模块 ${this.getModuleNames().join('/')}）`)
  }

  /** 停止采样（游戏停止调用）：取消 rAF、dispose 模块、快照冻结为 running:false、归还 autoReset */
  stop(): void {
    if (!this._running) return
    this._running = false
    if (this._rafId !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(this._rafId)
    }
    this._rafId = null
    for (const mod of this._modules.values()) mod.dispose?.()
    if (this._latest) {
      this._latest = { ...this._latest, game: { ...this._latest.game, running: false } }
    }
    if (this._renderer) {
      this._renderer.info.autoReset = true
      this._renderer.info.reset()
      this._renderer = null
    }
    logger.info('[PerfCollector] 采样已停止（快照冻结为 running:false）')
  }

  isRunning(): boolean {
    return this._running
  }

  // ─── 读取（AI / 面板 / window.__dsPerf 共用） ───

  /** 最新快照（从未运行过为 null） */
  getSnapshot(): PerfSnapshot | null {
    return this._latest
  }

  /** 最近 n 条历史快照（时间升序） */
  getHistory(n: number): PerfSnapshot[] {
    if (n <= 0) return []
    return this._history.slice(-Math.min(n, HISTORY_LIMIT))
  }

  /** 组装 AI / 往返返回体（samples>0 时附带历史，控上下文体积默认不带） */
  buildResult(samples = 0): { running: boolean; current: PerfSnapshot | null; history?: PerfSnapshot[] } {
    const result: { running: boolean; current: PerfSnapshot | null; history?: PerfSnapshot[] } = {
      running: this._running,
      current: this._latest,
    }
    if (samples > 0) result.history = this.getHistory(samples)
    return result
  }

  // ─── 内部：采样循环 ───

  /** 供测试直驱的 tick（生产环境由 rAF 驱动） */
  _tick = (nowMs: number): void => {
    if (!this._running) return
    const dtMs = this._lastTickAt > 0 ? nowMs - this._lastTickAt : 0
    this._lastTickAt = nowMs

    // renderer 接管 autoReset（每次出现新 renderer 重设一次）
    const renderer = (this._world?.gameRenderer?.renderer ?? null) as unknown as RendererInfoLike | null
    if (renderer && renderer !== this._renderer) {
      renderer.info.autoReset = false
      this._renderer = renderer
      logger.info('[PerfCollector] renderer.info.autoReset 已接管（每帧采样后手动 reset，两趟渲染累计）')
    }

    const ctx = this._buildContext(dtMs)
    const prevModules = this._latest?.modules ?? {}
    const modules: Record<string, Record<string, unknown>> = {}
    for (const mod of this._modules.values()) {
      // 间隔门控：未到间隔沿用上次输出（O(n) 模块靠此降频摊薄）
      const lastAt = this._lastSampleAt.get(mod.name) ?? Number.NEGATIVE_INFINITY
      if (mod.intervalMs > 0 && nowMs - lastAt < mod.intervalMs) {
        modules[mod.name] = prevModules[mod.name] ?? {}
        continue
      }
      this._lastSampleAt.set(mod.name, nowMs)
      let out: Record<string, unknown> | null = null
      try {
        out = mod.sample(ctx)
      } catch (err) {
        logger.warn(`[PerfCollector] 模块 "${mod.name}" 采样异常: ${err instanceof Error ? err.message : String(err)}`)
      }
      if (out !== null) modules[mod.name] = out
      else modules[mod.name] = prevModules[mod.name] ?? {}
    }

    const snapshot: PerfSnapshot = { ts: nowMs, game: { running: true }, modules }
    this._latest = snapshot
    this._history.push(snapshot)
    if (this._history.length > HISTORY_LIMIT) this._history.shift()

    // 本帧两趟渲染已累计读取完毕，手动复位（autoReset=false 的配对动作）
    this._renderer?.info.reset()

    this._schedule()
  }

  private _buildContext(dtMs: number): PerfSampleContext {
    return {
      world: this._world,
      nowMs: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      dtMs,
    }
  }

  private _schedule(): void {
    if (typeof window === 'undefined') return // 非浏览器环境（vitest）由测试直驱 _tick
    this._rafId = window.requestAnimationFrame(this._tick)
  }

  private _installWindowGlobal(): void {
    if (typeof window === 'undefined') return
    ;(window as unknown as { __dsPerf?: unknown }).__dsPerf = {
      getSnapshot: () => this.getSnapshot(),
      getHistory: (n: number) => this.getHistory(n),
      isRunning: () => this.isRunning(),
      buildResult: (samples?: number) => this.buildResult(samples),
    }
    logger.info('[PerfCollector] window.__dsPerf 已挂载')
  }
}
