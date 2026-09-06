/**
 * AudioSys — 引擎音频系统（A6）
 *
 * WebAudio 底座（无 IPC 依赖，浏览器环境直接可用；无 AudioContext 环境
 * [SSR/旧测试桩] 全 API 静默降级不抛错）：
 *  - 三总线：master → destination；bgm / sfx → master；音量 0~1 独立可调
 *  - play(clipId)：2D 一次性播放；playAt(clipId, pos)：3D 距离衰减（对活跃
 *    相机或 setListener 注入的监听点求距离）
 *  - 程序化音效：clip.kind='synth'（振荡器/噪声 + 频率扫线 + 包络）——
 *    无音频资产依赖的占位与兜底（方案 §七：CC0 包并行，表驱动解耦）
 *  - playBgm/stopBgm：BGM 通道 + 淡入淡出（synth loop 循环音垫；音频文件
 *    buffer 循环为二期扩展）
 *  - 生命周期：实现 GameSingleton，Game.launch 收集 / shutdown 统一 reset
 *    （停 BGM、清一次性节点），随游戏停止而静默
 *
 * 音频资产约定：项目可经 registerClip(s) 注入 audio.table.json 消费结果
 * （ConfigRegistry 归一化后调用）；引擎内置一组通用 synth 音效供直接使用。
 */

/** 程序化音效规格（振荡器扫频 + 包络） */
export interface SynthClipSpec {
  /** 'osc' = 振荡器；'noise' = 白噪声 burst（打击/爆炸质感） */
  kind: 'osc' | 'noise'
  /** osc 波形（缺省 'sine'） */
  waveform?: OscillatorType
  /** 起始频率（Hz；noise 类忽略） */
  freqFrom?: number
  /** 终止频率（Hz，缺省不变频） */
  freqTo?: number
  /** 时长（秒） */
  duration: number
  /** 起音时间（秒，缺省 0.005） */
  attack?: number
  /** 峰值增益（0~1，缺省 0.5） */
  gain?: number
  /** 可选滤波器（噪声塑形用：bandpass/highpass/lowpass） */
  filter?: { type: BiquadFilterType; freq: number; q?: number }
}

/** 音频片段定义 */
export interface AudioClip {
  id: string
  /** 程序化合成规格（当前唯一来源；文件 buffer 为二期扩展） */
  synth?: SynthClipSpec
  /** 片级音量乘数（缺省 1） */
  volume?: number
}

/** play/playAt 选项 */
export interface PlayOptions {
  /** 音量乘数（缺省 1） */
  volume?: number
  /** 播放速率（缺省 1；随机变调可传 0.95~1.05） */
  rate?: number
  /** 目标总线（缺省 'sfx'） */
  bus?: 'sfx' | 'bgm' | 'master'
}

/** playAt 3D 衰减参数 */
export interface SpatialOptions {
  /** 最大可闻距离（米，缺省 25；超出静音） */
  maxDistance?: number
  /** 最近距离（米，缺省 2；以内全音量） */
  referenceDistance?: number
}

type Buses = { master: GainNode; bgm: GainNode; sfx: GainNode }

/** GameSingleton 延迟到实现处引用（避免 import 循环），此处结构化满足即可 */
export class AudioSys {
  readonly name = 'AudioSys'

  private _ctx: AudioContext | null = null
  private _buses: Buses | null = null
  private _clips = new Map<string, AudioClip>()
  private _volumes = { master: 0.8, bgm: 0.5, sfx: 0.9 }
  private _noiseBuffer: AudioBuffer | null = null
  /** BGM 当前源（单声道单源；换曲 = 旧源淡出 + 新源淡入） */
  private _bgmSource: { stop: () => void } | null = null
  private _bgmId: string | null = null
  /** 3D 监听点（playAt 距离衰减基准；缺省取活跃相机） */
  private _listener: { x: number; y: number; z: number } | null = null

  constructor() {
    this.registerDefaults()
  }

  // ─── 单例 ───

  private static _instance: AudioSys | null = null

  static get instance(): AudioSys {
    if (!this._instance) this._instance = new AudioSys()
    return this._instance
  }

  // ─── 能力探测 ───

  /** 当前环境是否具备 WebAudio（false = 全 API 静默降级） */
  get supported(): boolean {
    if (typeof window === 'undefined') return false
    return !!(window.AudioContext ?? (window as { webkitAudioContext?: unknown }).webkitAudioContext)
  }

  /** 是否已初始化（首次播放时惰性创建 AudioContext） */
  get initialized(): boolean {
    return this._ctx !== null
  }

  /** 当前 BGM 片段 id（无则 null） */
  get currentBgm(): string | null {
    return this._bgmId
  }

  // ─── 片段注册 ───

  /** 注册/覆盖一个音频片段 */
  registerClip(clip: AudioClip): void {
    this._clips.set(clip.id, clip)
  }

  /** 批量注册 */
  registerClips(clips: AudioClip[]): void {
    for (const c of clips) this._clips.set(c.id, c)
  }

  /** 已注册片段 id 列表（诊断） */
  get clipIds(): string[] {
    return [...this._clips.keys()]
  }

  // ─── 音量总线 ───

  /** 读取总线音量（0~1） */
  getVolume(bus: 'master' | 'bgm' | 'sfx'): number {
    return this._volumes[bus]
  }

  /** 设置总线音量（0~1；立即生效，含已初始化的 GainNode） */
  setVolume(bus: 'master' | 'bgm' | 'sfx', volume: number): void {
    this._volumes[bus] = Math.min(1, Math.max(0, volume))
    const nodes = this._buses
    if (nodes) {
      const node = nodes[bus]
      // 感性音量曲线（平方）：低音量更线性可感
      node.gain.setTargetAtTime(this._volumes[bus] * this._volumes[bus], this._ctx!.currentTime, 0.03)
    }
  }

  /** 注入 3D 监听点（playAt 距离衰减基准；游戏侧每帧调用保持跟随，未注入时 playAt 回退 2D） */
  setListener(x: number, y: number, z: number): void {
    this._listener = { x, y, z }
  }

  // ─── 播放 API ───

  /** 2D 一次性播放。返回是否成功调度（不支持/未知 clip = false，不抛错） */
  play(clipId: string, opts?: PlayOptions): boolean {
    const ctx = this.ensureContext()
    if (!ctx || !this._buses) return false
    const clip = this._clips.get(clipId)
    if (!clip?.synth) return false
    this._playSynth(clip.synth, opts ?? {}, clip.volume ?? 1, this._buses[opts?.bus ?? 'sfx'])
    return true
  }

  /**
   * 3D 空间衰减播放：按监听点（setListener 注入）与 pos 距离衰减。
   * 未注入监听点时回退 2D 全音量。linear 衰减：referenceDistance 内全音量，
   * maxDistance 外静音。
   */
  playAt(clipId: string, pos: { x: number; y: number; z: number }, opts?: PlayOptions & SpatialOptions): boolean {
    const listen = this._listener
    if (!listen) return this.play(clipId, opts)
    const maxD = opts?.maxDistance ?? 25
    const refD = opts?.referenceDistance ?? 2
    const d = Math.hypot(pos.x - listen.x, pos.y - listen.y, pos.z - listen.z)
    if (d >= maxD) return false
    const falloff = d <= refD ? 1 : 1 - (d - refD) / (maxD - refD)
    const vol = (opts?.volume ?? 1) * falloff * falloff
    return this.play(clipId, { ...opts, volume: vol })
  }

  /**
   * 播放 BGM（淡入 crossfade：旧曲 fade 后停止，新曲 fade 起播）。
   * 当前支持 synth 循环音垫（kind='osc' 且 loop 语义：持续振荡至 stop）。
   */
  playBgm(clipId: string, fadeSeconds = 1): boolean {
    const ctx = this.ensureContext()
    if (!ctx || !this._buses) return false
    const clip = this._clips.get(clipId)
    if (!clip?.synth) return false
    if (this._bgmId === clipId) return true
    this.stopBgm(fadeSeconds)
    this._bgmId = clipId
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(clip.volume ?? 0.6, ctx.currentTime + Math.max(0.01, fadeSeconds))
    gain.connect(this._buses.bgm)
    const stopFns = this._startSynthLayer(clip.synth, gain)
    this._bgmSource = {
      stop: () => {
        // 淡出后停止
        const t0 = ctx.currentTime
        gain.gain.cancelScheduledValues(t0)
        gain.gain.setValueAtTime(gain.gain.value, t0)
        gain.gain.linearRampToValueAtTime(0.0001, t0 + Math.max(0.01, fadeSeconds))
        window.setTimeout(() => stopFns(), Math.max(0.01, fadeSeconds) * 1000 + 60)
      },
    }
    return true
  }

  /** 停止 BGM（淡出） */
  stopBgm(fadeSeconds = 0.8): void {
    if (this._bgmSource) {
      this._bgmSource.stop()
      this._bgmSource = null
    }
    this._bgmId = null
    void fadeSeconds
  }

  // ─── 内部实现 ───

  /** 惰性创建 AudioContext + 总线（失败静默禁用；autoplay 策略下可能 suspended，由用户手势后 resume） */
  private ensureContext(): AudioContext | null {
    if (!this.supported) return null
    if (this._ctx) {
      if (this._ctx.state === 'suspended') void this._ctx.resume().catch(() => {})
      return this._ctx
    }
    try {
      const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)
      const ctx = new Ctor()
      const master = ctx.createGain()
      master.connect(ctx.destination)
      const bgm = ctx.createGain()
      const sfx = ctx.createGain()
      bgm.connect(master)
      sfx.connect(master)
      master.gain.value = this._volumes.master * this._volumes.master
      bgm.gain.value = this._volumes.bgm * this._volumes.bgm
      sfx.gain.value = this._volumes.sfx * this._volumes.sfx
      this._ctx = ctx
      this._buses = { master, bgm, sfx }
      return ctx
    } catch {
      return null
    }
  }

  /** 活跃相机位置钩子已移除：监听点由游戏侧每帧 setListener 注入（解耦渲染层） */

  /** 白噪声缓冲（惰性创建一次，1 秒） */
  private _getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this._noiseBuffer) return this._noiseBuffer
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    this._noiseBuffer = buf
    return buf
  }

  /** 合成一次性音效（osc/noise + 频率扫线 + 包络 → 总线） */
  private _playSynth(spec: SynthClipSpec, opts: PlayOptions, clipVolume: number, bus: GainNode): void {
    const ctx = this._ctx!
    const t0 = ctx.currentTime
    const dur = Math.max(0.02, spec.duration)
    const peak = (spec.gain ?? 0.5) * clipVolume * (opts.volume ?? 1)
    if (peak <= 0.0001) return
    const rate = opts.rate ?? 1

    const env = ctx.createGain()
    env.gain.setValueAtTime(0.0001, t0)
    env.gain.linearRampToValueAtTime(peak, t0 + Math.max(0.002, spec.attack ?? 0.005))
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    env.connect(bus)

    let head: AudioNode = env
    if (spec.filter) {
      const f = ctx.createBiquadFilter()
      f.type = spec.filter.type
      f.frequency.value = spec.filter.freq
      if (spec.filter.q !== undefined) f.Q.value = spec.filter.q
      f.connect(env)
      head = f
    }

    if (spec.kind === 'osc') {
      const osc = ctx.createOscillator()
      osc.type = spec.waveform ?? 'sine'
      osc.frequency.setValueAtTime(Math.max(1, (spec.freqFrom ?? 440) * rate), t0)
      if (spec.freqTo !== undefined) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec.freqTo * rate), t0 + dur)
      }
      osc.connect(head)
      osc.start(t0)
      osc.stop(t0 + dur + 0.02)
      osc.onended = () => { osc.disconnect(); env.disconnect() }
    } else {
      const src = ctx.createBufferSource()
      src.buffer = this._getNoiseBuffer(ctx)
      src.playbackRate.value = rate
      src.connect(head)
      src.start(t0, Math.random() * 0.5, dur + 0.02)
      src.onended = () => { src.disconnect(); env.disconnect() }
    }
  }

  /** 合成持续音层（BGM loop；返回停止函数） */
  private _startSynthLayer(spec: SynthClipSpec, bus: AudioNode): () => void {
    const ctx = this._ctx!
    const nodes: Array<{ stop: () => void }> = []
    const layer = (freq: number, gain: number, type: OscillatorType) => {
      const osc = ctx.createOscillator()
      osc.type = type
      osc.frequency.value = freq
      const g = ctx.createGain()
      g.gain.value = gain
      osc.connect(g)
      g.connect(bus)
      osc.start()
      nodes.push({ stop: () => { try { osc.stop() } catch { /* already stopped */ } osc.disconnect(); g.disconnect() } })
    }
    // 双振荡器轻微失谐 + 低八度铺底（最小可听音垫）
    const base = Math.max(20, spec.freqFrom ?? 220)
    layer(base, 0.5, spec.waveform === 'square' ? 'triangle' : (spec.waveform ?? 'sine'))
    layer(base * 1.007, 0.35, 'sine')
    layer(base / 2, 0.4, 'sine')
    return () => {
      for (const n of nodes) n.stop()
    }
  }

  /** 引擎内置通用 synth 音效（打击/拾取/UI/移动；arena 直接使用） */
  private registerDefaults(): void {
    this.registerClips([
      { id: 'ui.click', synth: { kind: 'osc', waveform: 'square', freqFrom: 880, freqTo: 520, duration: 0.06, gain: 0.25 } },
      { id: 'swing', synth: { kind: 'noise', duration: 0.12, gain: 0.4, filter: { type: 'bandpass', freq: 2400, q: 1.2 } } },
      { id: 'hit.light', synth: { kind: 'noise', duration: 0.09, gain: 0.6, filter: { type: 'bandpass', freq: 1800, q: 0.8 } } },
      { id: 'hit.heavy', synth: { kind: 'noise', duration: 0.18, gain: 0.8, filter: { type: 'lowpass', freq: 900 } } },
      { id: 'player.attack1', synth: { kind: 'noise', duration: 0.1, gain: 0.45, filter: { type: 'bandpass', freq: 2800, q: 1.4 } } },
      { id: 'player.attack2', synth: { kind: 'noise', duration: 0.1, gain: 0.45, filter: { type: 'bandpass', freq: 2200, q: 1.4 } } },
      { id: 'player.attack3', synth: { kind: 'noise', duration: 0.16, gain: 0.6, filter: { type: 'bandpass', freq: 1500, q: 1 } } },
      { id: 'player.hurt', synth: { kind: 'osc', waveform: 'sawtooth', freqFrom: 320, freqTo: 110, duration: 0.18, gain: 0.5 } },
      { id: 'player.die', synth: { kind: 'osc', waveform: 'sawtooth', freqFrom: 240, freqTo: 50, duration: 0.6, gain: 0.6 } },
      { id: 'enemy.hit', synth: { kind: 'noise', duration: 0.08, gain: 0.5, filter: { type: 'bandpass', freq: 1400, q: 1 } } },
      { id: 'enemy.die', synth: { kind: 'osc', waveform: 'square', freqFrom: 380, freqTo: 70, duration: 0.28, gain: 0.4 } },
      { id: 'slime.jump', synth: { kind: 'osc', waveform: 'sine', freqFrom: 180, freqTo: 420, duration: 0.14, gain: 0.35 } },
      { id: 'slime.attack', synth: { kind: 'osc', waveform: 'triangle', freqFrom: 500, freqTo: 160, duration: 0.12, gain: 0.4 } },
      { id: 'pickup.coin', synth: { kind: 'osc', waveform: 'triangle', freqFrom: 1046, freqTo: 1568, duration: 0.12, gain: 0.4 } },
      { id: 'heal', synth: { kind: 'osc', waveform: 'sine', freqFrom: 600, freqTo: 1200, duration: 0.3, gain: 0.4 } },
      { id: 'dodge', synth: { kind: 'noise', duration: 0.12, gain: 0.35, filter: { type: 'highpass', freq: 2000 } } },
      { id: 'door.open', synth: { kind: 'osc', waveform: 'sawtooth', freqFrom: 70, freqTo: 180, duration: 0.45, gain: 0.45 } },
      { id: 'combo.ready', synth: { kind: 'osc', waveform: 'square', freqFrom: 700, freqTo: 1400, duration: 0.1, gain: 0.3 } },
    ])
  }

  // ─── 生命周期（GameSingleton）───

  /** Game.shutdown 统一回收：停 BGM、挂起上下文（一次性节点自然结束） */
  reset(): void {
    this.stopBgm(0)
    if (this._ctx && this._ctx.state === 'running') {
      void this._ctx.suspend().catch(() => {})
    }
    this._listener = null
  }
}

/** 全局音频单例（游戏代码直接 import 使用） */
export const audioSys = AudioSys.instance
