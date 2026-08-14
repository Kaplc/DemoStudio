/**
 * TweenSystem — 轻量补间动画系统（引擎内置，无第三方依赖）
 *
 * 能力：
 *  - 通用补间：目标对象属性的数字 / 数组（vec2/vec3/vec4）/ 颜色字符串（#rgb/#rrggbb/rgb()/rgba()）
 *  - 缓动函数库：linear / quad / cubic / sine / back / elastic / bounce（各 In/Out/InOut 组合）
 *  - 选项：duration（秒）、delay、easing、yoyo、repeat（-1 无限）、onUpdate / onComplete
 *  - 驱动：默认自持 rAF 循环（首次创建 tween 自动启动，全部完成自动停止）；
 *    也可关闭自驱（setAutoDrive(false)）改由外部 update(dt) 驱动（如 World.tick / 测试）
 *  - UI 快捷方法：fade / fadeIn / fadeOut（遍历子树 CanvasUIComponent 补间透明度）
 *
 * 用法：
 *   TweenSystem.instance.to(target, { x: 10, color: '#ff0000' }, { duration: 0.3, easing: 'quadOut', onComplete })
 *   TweenSystem.instance.fadeIn(actor, { duration: 0.2 })
 *   const h = TweenSystem.instance.to(...); h.kill()   // 取消
 *
 * 驱动链：UIManager.tickUI 亦会调用 update(dt)（游戏运行时双保险）；编辑器预览由 rAF 自驱。
 */
import { logger } from '../Logger'
import type { Actor } from '../entity/Actor'
import { CanvasUIComponent } from '../rendering/CanvasUIComponent'
// ════════════════════════════════════════════
//  缓动函数库
// ════════════════════════════════════════════

export type EasingName =
  | 'linear'
  | 'quadIn' | 'quadOut' | 'quadInOut'
  | 'cubicIn' | 'cubicOut' | 'cubicInOut'
  | 'sineIn' | 'sineOut' | 'sineInOut'
  | 'backOut' | 'elasticOut' | 'bounceOut'

export type EasingFn = (t: number) => number

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)

/** 缓动函数库：输入归一化进度 t∈[0,1]，输出缓动后的进度 */
export const Easing: Record<EasingName, EasingFn> = {
  linear: (t) => t,
  quadIn: (t) => t * t,
  quadOut: (t) => t * (2 - t),
  quadInOut: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  cubicIn: (t) => t * t * t,
  cubicOut: (t) => --t * t * t + 1,
  cubicInOut: (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
  sineIn: (t) => 1 - Math.cos((t * Math.PI) / 2),
  sineOut: (t) => Math.sin((t * Math.PI) / 2),
  sineInOut: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  backOut: (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
  elasticOut: (t) => {
    if (t === 0 || t === 1) return t
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1
  },
  bounceOut: (t) => {
    const n1 = 7.5625
    const d1 = 2.75
    if (t < 1 / d1) return n1 * t * t
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375
    return n1 * (t -= 2.625 / d1) * t + 0.984375
  },
}

function resolveEasing(easing: EasingName | EasingFn | undefined): EasingFn {
  if (!easing) return Easing.linear
  if (typeof easing === 'function') return easing
  return Easing[easing] ?? Easing.linear
}

// ════════════════════════════════════════════
//  颜色解析 / 序列化（#rgb #rrggbb #rrggbbaa rgb() rgba()）
// ════════════════════════════════════════════

type RGBA = [number, number, number, number]

function parseColor(str: string): RGBA | null {
  const s = str.trim()
  if (s.startsWith('#')) {
    let hex = s.slice(1)
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
    if (hex.length === 6) hex += 'ff'
    if (hex.length !== 8 || !/^[0-9a-fA-F]{8}$/.test(hex)) return null
    return [
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
      parseInt(hex.slice(6, 8), 16) / 255,
    ]
  }
  const m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/)
  if (m) {
    return [
      clamp01(Number(m[1]) / 255),
      clamp01(Number(m[2]) / 255),
      clamp01(Number(m[3]) / 255),
      m[4] !== undefined ? clamp01(Number(m[4])) : 1,
    ]
  }
  return null
}

function rgbaToColor([r, g, b, a]: RGBA): string {
  if (a >= 0.999) {
    const toHex = (v: number) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`
  }
  return `rgba(${Math.round(clamp01(r) * 255)}, ${Math.round(clamp01(g) * 255)}, ${Math.round(clamp01(b) * 255)}, ${a.toFixed(3)})`
}

// ════════════════════════════════════════════
//  补间值类型与解析
// ════════════════════════════════════════════

/** 可补间的值：标量 / vec2 / vec3 / vec4 / 颜色字符串 */
export type Tweenable = number | number[] | string

interface ParsedProp {
  from: number[]
  delta: number[]
  isColor: boolean
}

/** 将目标值解析为「起始向量 + 增量向量」；颜色统一为 4 通道 RGBA */
function parseProp(value: Tweenable, from?: Tweenable): ParsedProp | null {
  if (typeof value === 'number') {
    const f = typeof from === 'number' ? from : value
    return { from: [f], delta: [value - f], isColor: false }
  }
  if (Array.isArray(value)) {
    const f = Array.isArray(from) ? from.slice() : value.slice()
    const delta = value.map((v, i) => v - (f[i] ?? 0))
    return { from: f, delta, isColor: false }
  }
  if (typeof value === 'string') {
    const to = parseColor(value)
    const fromC = typeof from === 'string' ? parseColor(from) : null
    if (!to) return null
    const f = fromC ?? to.slice()
    return { from: f, delta: to.map((v, i) => v - f[i]), isColor: true }
  }
  return null
}

// ════════════════════════════════════════════
//  补间对象
// ════════════════════════════════════════════

export interface TweenOptions {
  /** 时长（秒），默认 0.3 */
  duration?: number
  /** 缓动：名称或函数，默认 linear */
  easing?: EasingName | EasingFn
  /** 延迟（秒），默认 0 */
  delay?: number
  /** 往复：到达终点后反向回到起点（配合 repeat 循环） */
  yoyo?: boolean
  /** 额外重复次数：0 = 不重复（默认），-1 = 无限 */
  repeat?: number
  /** 每帧回调（值为当前各属性值） */
  onUpdate?: (values: Record<string, Tweenable>) => void
  /** 完成回调（被 kill 不触发） */
  onComplete?: () => void
}

export interface TweenHandle {
  /** 取消补间（onComplete 不触发） */
  kill(): void
  /** 是否已结束（完成或被取消） */
  readonly done: boolean
}

interface InternalTween {
  target: object
  props: Map<string, ParsedProp>
  duration: number
  delay: number
  easing: EasingFn
  yoyo: boolean
  repeat: number
  onUpdate?: TweenOptions['onUpdate']
  onComplete?: () => void
  elapsed: number
  /** 当前循环次数（repeat 用） */
  loops: number
  /** yoyo 方向：1 正向 / -1 反向 */
  dir: 1 | -1
  killed: boolean
}

// ════════════════════════════════════════════
//  TweenSystem 单例
// ════════════════════════════════════════════

export class TweenSystem {
  private static _instance: TweenSystem | null = null

  /** 全局单例（懒创建） */
  static get instance(): TweenSystem {
    if (!TweenSystem._instance) TweenSystem._instance = new TweenSystem()
    return TweenSystem._instance
  }

  private _tweens: InternalTween[] = []
  private _rafId: number | null = null
  private _lastTime = 0
  /** 是否自持 rAF 驱动（默认 true；外部 update(dt) 驱动时可关闭避免双驱动） */
  private _autoDrive = true
  /**
   * 减少动效开关（Motion Sickness 无障碍）：
   *  - 默认自动检测系统 prefers-reduced-motion（浏览器/OS 设置）
   *  - false 时所有补间瞬时完成（直接跳到终点 + 触发 onComplete），不做动画
   *  - 游戏内设置可手动覆盖（setMotionEnabled）
   */
  private _motionEnabled = true
  /** 是否已做过自动检测（仅首次，避免重复 matchMedia） */
  private _motionAutoDetected = false

  /** 当前活动补间数 */
  get activeCount(): number { return this._tweens.length }

  /** 是否自持 rAF 驱动 */
  get autoDrive(): boolean { return this._autoDrive }
  set autoDrive(v: boolean) {
    this._autoDrive = v
    if (!v && this._rafId !== null) {
      cancelAnimationFrame(this._rafId)
      this._rafId = null
    } else if (v && this._tweens.length > 0) {
      this._ensureLoop()
    }
  }

  /**
   * 减少动效是否启用（true = 播放动画；false = 瞬时完成）。
   * 首次访问自动检测系统 prefers-reduced-motion。
   */
  get motionEnabled(): boolean {
    this._autoDetectMotion()
    return this._motionEnabled
  }
  set motionEnabled(v: boolean) {
    this._motionEnabled = v
    // 关闭时：进行中的补间全部瞬时完成（跳到终点 + onComplete），不留半截动画
    if (!v && this._tweens.length > 0) {
      const pending = [...this._tweens]
      for (const tw of pending) this._completeImmediate(tw)
      this._tweens = []
      this._stopLoop()
      logger.info('[TweenSystem] 减少动效已启用，进行中补间全部瞬时完成')
    }
  }

  /** 手动设置减少动效开关（游戏设置 UI 调用；覆盖自动检测） */
  setMotionEnabled(v: boolean): void {
    this._motionAutoDetected = true // 手动设置后不再自动检测覆盖
    this.motionEnabled = v
  }

  /**
   * 补间目标对象属性到目标值（从当前值开始）。
   * @param target 目标对象（如组件实例）
   * @param props  属性映射：{ 属性名: 目标值 }
   */
  to(target: object, props: Record<string, Tweenable>, options: TweenOptions = {}): TweenHandle {
    const parsed = new Map<string, ParsedProp>()
    for (const [key, value] of Object.entries(props)) {
      const from = (target as Record<string, unknown>)[key] as Tweenable | undefined
      const p = parseProp(value, from)
      if (p) parsed.set(key, p)
    }
    return this._create(target, parsed, options)
  }

  /** 显式起始值补间（from → to） */
  fromTo(target: object, fromProps: Record<string, Tweenable>, toProps: Record<string, Tweenable>, options: TweenOptions = {}): TweenHandle {
    const parsed = new Map<string, ParsedProp>()
    for (const [key, value] of Object.entries(toProps)) {
      const p = parseProp(value, fromProps[key])
      if (p) parsed.set(key, p)
    }
    return this._create(target, parsed, options)
  }

  /** 取消全部补间 */
  killAll(): void {
    for (const t of this._tweens) t.killed = true
    this._tweens = []
    this._stopLoop()
  }

  /**
   * 手动推进一帧（autoDrive=false 或测试环境使用）。
   * @param dt 帧间隔（秒）
   */
  update(dt: number): void {
    if (dt <= 0 || this._tweens.length === 0) return
    const finished: InternalTween[] = []
    for (const tw of this._tweens) {
      if (tw.killed) continue
      this._advance(tw, dt)
      if (tw.killed) finished.push(tw)
    }
    for (const tw of finished) {
      const idx = this._tweens.indexOf(tw)
      if (idx >= 0) this._tweens.splice(idx, 1)
    }
    if (this._tweens.length === 0) this._stopLoop()
  }

  // ─── UI 快捷方法 ────────────────────────────

  /**
   * 补间 UI Actor 整树透明度（遍历所有非 markerOnly 的 CanvasUIComponent：
   * UIText / UIImage 均继承自它，setOpacity 统一驱动各自 material.opacity）。
   * @param actor UI Actor（或其子树）
   * @param to    目标透明度 [0,1]
   */
  fade(actor: Actor, to: number, options: TweenOptions = {}): TweenHandle {
    const comps: Array<{ comp: CanvasUIComponent; from: number }> = []
    const walk = (a: Actor): void => {
      for (const comp of a.getComponents(CanvasUIComponent)) {
        if (!comp.isMarkerOnly) comps.push({ comp, from: comp.opacity })
      }
      for (const child of a.getChildren()) walk(child)
    }
    walk(actor)
    if (comps.length === 0) {
      logger.warn('[TweenSystem] fade: Actor 子树无 CanvasUIComponent（或全部 markerOnly），跳过')
      return { kill: () => {}, done: true }
    }
    // 每个组件一个补间；统一句柄 kill 全部
    const handles: TweenHandle[] = comps.map(({ comp, from }) =>
      this.fromTo(comp, { opacity: from }, { opacity: to }, options),
    )
    return {
      kill: () => { for (const h of handles) h.kill() },
      get done() { return handles.every((h) => h.done) },
    }
  }

  /** 淡入（opacity → 1） */
  fadeIn(actor: Actor, options: TweenOptions = {}): TweenHandle {
    return this.fade(actor, 1, options)
  }

  /** 淡出（opacity → 0） */
  fadeOut(actor: Actor, options: TweenOptions = {}): TweenHandle {
    return this.fade(actor, 0, options)
  }

  // ─── 内部实现 ───────────────────────────────

  private _create(target: object, props: Map<string, ParsedProp>, options: TweenOptions): TweenHandle {
    const tw: InternalTween = {
      target,
      props,
      duration: Math.max(0.0001, options.duration ?? 0.3),
      delay: options.delay ?? 0,
      easing: resolveEasing(options.easing),
      yoyo: options.yoyo ?? false,
      repeat: options.repeat ?? 0,
      onUpdate: options.onUpdate,
      onComplete: options.onComplete,
      elapsed: -(options.delay ?? 0),
      loops: 0,
      dir: 1,
      killed: false,
    }
    // 减少动效：不播放动画，直接跳到终点（属性置目标值 + 触发 onComplete）
    if (!this._motionEnabled) {
      this._completeImmediate(tw)
      return { kill: () => {}, done: true }
    }
    this._tweens.push(tw)
    // 无目标属性（全部解析失败）→ 直接完成
    if (props.size === 0) {
      tw.killed = true
      this._tweens.splice(this._tweens.indexOf(tw), 1)
      return { kill: () => {}, done: true }
    }
    this._ensureLoop()
    const handle: TweenHandle = {
      kill: () => {
        tw.killed = true
        const idx = this._tweens.indexOf(tw)
        if (idx >= 0) this._tweens.splice(idx, 1)
        if (this._tweens.length === 0) this._stopLoop()
      },
      get done() { return tw.killed },
    }
    return handle
  }

  /** 瞬时完成一个补间：属性直接置终点值 + 触发 onComplete（减少动效用） */
  private _completeImmediate(tw: InternalTween): void {
    if (tw.killed) return
    const values: Record<string, Tweenable> = {}
    for (const [key, prop] of tw.props) {
      const final = prop.from.map((f, i) => f + prop.delta[i])
      values[key] = prop.isColor ? rgbaToColor(final as RGBA) : (prop.delta.length === 1 ? final[0] : final)
      ;(tw.target as Record<string, unknown>)[key] = values[key]
    }
    tw.killed = true
    tw.onUpdate?.(values)
    tw.onComplete?.()
  }

  /** 自动检测系统 prefers-reduced-motion（仅首次；手动 setMotionEnabled 后不再检测） */
  private _autoDetectMotion(): void {
    if (this._motionAutoDetected) return
    this._motionAutoDetected = true
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      try {
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
        this._motionEnabled = !reduced.matches
        if (reduced.matches) logger.info('[TweenSystem] 检测到系统 prefers-reduced-motion，动画默认瞬时完成')
      } catch {
        // matchMedia 不可用：保持默认 true
      }
    }
  }

  private _advance(tw: InternalTween, dt: number): void {
    tw.elapsed += dt
    if (tw.elapsed < 0) return // delay 阶段

    const t = clamp01(tw.elapsed / tw.duration)
    const eased = tw.easing(t)
    // yoyo 反向时进度取 1 - eased
    const progress = tw.dir === 1 ? eased : 1 - eased

    const values: Record<string, Tweenable> = {}
    for (const [key, prop] of tw.props) {
      const cur = prop.from.map((f, i) => f + prop.delta[i] * progress)
      values[key] = prop.isColor ? rgbaToColor(cur as RGBA) : (prop.delta.length === 1 ? cur[0] : cur)
      ;(tw.target as Record<string, unknown>)[key] = values[key]
    }
    tw.onUpdate?.(values)

    if (t >= 1) {
      if (tw.yoyo && tw.dir === 1) {
        // 反向回程
        tw.dir = -1
        tw.elapsed = 0
        return
      }
      if (tw.repeat === -1 || tw.loops < tw.repeat) {
        tw.loops++
        tw.dir = 1
        tw.elapsed = 0
        return
      }
      // 完成
      tw.killed = true
      tw.onComplete?.()
    }
  }

  private _ensureLoop(): void {
    if (!this._autoDrive || this._rafId !== null) return
    this._lastTime = performance.now()
    const loop = (time: number) => {
      if (this._rafId === null) return
      const dt = (time - this._lastTime) / 1000
      this._lastTime = time
      this.update(dt)
      if (this._rafId !== null) this._rafId = requestAnimationFrame(loop)
    }
    this._rafId = requestAnimationFrame(loop)
  }

  private _stopLoop(): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId)
      this._rafId = null
    }
  }
}
