/**
 * ToastSystem — 通知/Toast 队列系统（引擎通用）
 *
 * 能力：
 *  - 优先级队列：critical（插队）> high > normal > low
 *  - 同时最多 maxVisible 条（默认 3），超出时新通知顶掉最旧的非 critical
 *  - 自动消失：duration 秒后淡出并销毁（TweenSystem 驱动，无第三方依赖）
 *  - UI 生成：按配置的 widget 资产路径经 UIManager.spawnUIActor 动态生成
 *    （动态生成的浮动面板自动获得 FLOAT_LAYER_BIAS，盖住常驻 HUD）
 *
 * 用法（项目启动时挂接）：
 *   ToastSystem.instance.attach(world.ui, 'asset/blueprints/ui/toast.widget.json')
 *   ToastSystem.instance.show('金币 +50', { priority: 'normal' })
 *
 * widget 资产约定（toast.widget.json）：
 *  - 根：CanvasUIComponent（面板背景，stretch 或 top-center 锚点）
 *  - 子节点：name="ToastText" 的 UITextComponent（文本显示于此，center 对齐）
 *
 * 驱动：由 UIManager.tickUI 调用 update(dt)（与 TweenSystem 同链）。
 */
import { TweenSystem } from './TweenSystem'
import { logger } from '../Logger'
import type { Actor } from '../entity/Actor'
import type { UIManager } from './UIManager'
import { UITextComponent } from './UITextComponent'

export type ToastPriority = 'critical' | 'high' | 'normal' | 'low'

export interface ToastOptions {
  /** 优先级（默认 normal）：critical 插队显示 */
  priority?: ToastPriority
  /** 显示时长（秒，默认 3） */
  duration?: number
  /** 入淡出时长（秒，默认 0.2） */
  fadeDuration?: number
  /** 显示回调（spawn 完成后，可自定义 UI 内容） */
  onShown?: (actor: Actor) => void
}

/** 文本节点名称约定（toast widget 资产内） */
export const TOAST_TEXT_NODE = 'ToastText'

interface ToastEntry {
  id: number
  message: string
  priority: number
  duration: number
  fadeDuration: number
  onShown?: (actor: Actor) => void
  actor: Actor | null
  elapsed: number
  dismissed: boolean
}

const PRIORITY_WEIGHT: Record<ToastPriority, number> = { critical: 3, high: 2, normal: 1, low: 0 }

export class ToastSystem {
  private static _instance: ToastSystem | null = null

  /** 全局单例（懒创建） */
  static get instance(): ToastSystem {
    if (!ToastSystem._instance) ToastSystem._instance = new ToastSystem()
    return ToastSystem._instance
  }

  private _ui: UIManager | null = null
  private _widgetPath: string | null = null
  private _maxVisible = 3
  private _queue: ToastEntry[] = []
  private _active: ToastEntry[] = []
  private _nextId = 1

  /** 当前同时可见的最大条数 */
  get maxVisible(): number { return this._maxVisible }
  set maxVisible(v: number) { this._maxVisible = Math.max(1, v) }

  /** 是否已挂接 UIManager（未挂接时 show 仅入队不生成 UI） */
  get attached(): boolean { return this._ui !== null }

  /**
   * 挂接 UIManager 与 toast widget 资产（项目启动时调用一次）。
   * @param ui         UIManager（world.ui）
   * @param widgetPath toast widget 蓝图路径（如 'asset/blueprints/ui/toast.widget.json'）
   */
  attach(ui: UIManager, widgetPath: string): void {
    this._ui = ui
    this._widgetPath = widgetPath
    logger.info(`[ToastSystem] 已挂接 UIManager, widget=${widgetPath}, maxVisible=${this._maxVisible}`)
  }

  /** 解除挂接（清空队列） */
  detach(): void {
    this.dismissAll()
    this._ui = null
    this._widgetPath = null
  }

  /**
   * 显示一条通知（入队；未达上限时立即显示）。
   * @returns toast id（可配合 dismiss 使用）
   */
  show(message: string, options: ToastOptions = {}): number {
    const entry: ToastEntry = {
      id: this._nextId++,
      message,
      priority: PRIORITY_WEIGHT[options.priority ?? 'normal'],
      duration: options.duration ?? 3,
      fadeDuration: options.fadeDuration ?? 0.2,
      onShown: options.onShown,
      actor: null,
      elapsed: 0,
      dismissed: false,
    }
    this._queue.push(entry)
    this._drain()
    return entry.id
  }

  /** 按 id 立即消失指定通知（未显示则出队不显示） */
  dismiss(id: number): void {
    const qi = this._queue.findIndex((e) => e.id === id)
    if (qi >= 0) {
      this._queue.splice(qi, 1)
      return
    }
    const entry = this._active.find((e) => e.id === id)
    if (entry) this._dismissEntry(entry)
  }

  /** 全部消失 */
  dismissAll(): void {
    for (const entry of [...this._active]) this._dismissEntry(entry)
    this._queue = []
  }

  /**
   * 每帧推进（由 UIManager.tickUI 调用；独立环境可自行驱动）。
   * @param dt 帧间隔（秒）
   */
  update(dt: number): void {
    if (dt <= 0) return
    // 1. 推进显示时长，超时消失
    for (const entry of [...this._active]) {
      if (entry.dismissed) continue
      entry.elapsed += dt
      if (entry.elapsed >= entry.duration) this._dismissEntry(entry)
    }
    // 2. 补位
    this._drain()
  }

  // ─── 内部 ─────────────────────────────────

  /** 队列 → 活动区（有位置就弹，critical 插队） */
  private _drain(): void {
    while (this._active.length < this._maxVisible && this._queue.length > 0) {
      // critical 插队：优先取队列中最高优先级
      const idx = this._queue.reduce(
        (best, e, i) => (e.priority > this._queue[best].priority ? i : best),
        0,
      )
      const entry = this._queue.splice(idx, 1)[0]
      this._spawnEntry(entry)
    }
  }

  /** 生成一条 toast 的 UI */
  private _spawnEntry(entry: ToastEntry): void {
    const ui = this._ui
    if (!ui || !this._widgetPath) {
      // 未挂接：仅记录（不生成 UI，避免静默丢失——控制台提示）
      logger.warn(`[ToastSystem] 未挂接 UIManager/widget，通知被丢弃: "${entry.message}"`)
      this._queue = this._queue.filter((e) => e.id !== entry.id)
      return
    }
    const actor = ui.spawnUIActor(this._widgetPath)
    if (!actor) {
      logger.error(`[ToastSystem] toast widget 生成失败: ${this._widgetPath}，通知丢弃: "${entry.message}"`)
      return
    }
    entry.actor = actor
    // 设置文本（约定节点名 ToastText）
    const textComp = this._findText(actor)
    if (textComp) textComp.text = entry.message
    else logger.warn(`[ToastSystem] toast widget 缺少 "${TOAST_TEXT_NODE}" 节点（UITextComponent），文本未设置`)

    this._active.push(entry)
    TweenSystem.instance.fadeIn(actor, { duration: entry.fadeDuration })
    entry.onShown?.(actor)
    logger.info(`[ToastSystem] 显示通知: "${entry.message}" (id=${entry.id}, priority=${entry.priority})`)
  }

  /** 淡出并销毁一条 toast */
  private _dismissEntry(entry: ToastEntry): void {
    if (entry.dismissed) return
    entry.dismissed = true
    const ui = this._ui
    const actor = entry.actor
    if (ui && actor && !actor.bPendingDestroy) {
      // 淡出完成后销毁（防重复：_finalize 内部幂等）
      TweenSystem.instance.fadeOut(actor, {
        duration: entry.fadeDuration,
        onComplete: () => this._finalize(entry),
      })
    } else {
      this._finalize(entry)
    }
  }

  /** 销毁 toast UI 并移出活动区（幂等：重复调用安全） */
  private _finalize(entry: ToastEntry): void {
    const ui = this._ui
    const actor = entry.actor
    if (ui && actor && !actor.bPendingDestroy) {
      ui.destroyUIActor(actor)
    }
    const ai = this._active.indexOf(entry)
    if (ai >= 0) this._active.splice(ai, 1)
  }

  /** 在 toast Actor 子树查找文本组件（约定节点名 ToastText，按 root.name 匹配） */
  private _findText(actor: Actor): UITextComponent | null {
    const walk = (a: Actor): UITextComponent | null => {
      const comp = a.getComponent(UITextComponent)
      if (comp && a.root.name === TOAST_TEXT_NODE) return comp
      for (const child of a.getChildren()) {
        const found = walk(child)
        if (found) return found
      }
      return null
    }
    return walk(actor)
  }
}
