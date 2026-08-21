/**
 * DemoStudio 日志系统
 * 单例模式，全局统一实例
 * 支持多级别日志、文件输出（通过 Electron IPC）、Console 面板输出
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const LEVEL_PREFIXES: Record<LogLevel, string> = {
  debug: '🔍',
  info: 'ℹ️',
  warn: '⚠️',
  error: '❌',
}

interface LoggerOptions {
  /** 最低输出级别（默认 info） */
  minLevel?: LogLevel
  /** 模块名称 */
  module?: string
  /** 写入文件（需要 Electron IPC 支持） */
  enableFile?: boolean
  /** Console 面板输出回调 */
  onOutput?: (text: string) => void
}

class LoggerInstance {
  private static instance: LoggerInstance

  private minLevel: number
  private module: string
  private enableFile: boolean
  private onOutput?: (text: string) => void
  /** 游戏日志开关：由 Game.launch/shutdown 控制，开启期间日志同时写入独立 game_*.log */
  private _gameLogActive = false

  private constructor(options: LoggerOptions = {}) {
    this.minLevel = LEVEL_ORDER[options.minLevel ?? 'info']
    this.module = options.module ?? 'App'
    this.enableFile = options.enableFile ?? true
    this.onOutput = options.onOutput
  }

  /** 获取全局单例 */
  static getInstance(options?: LoggerOptions): LoggerInstance {
    if (!LoggerInstance.instance) {
      LoggerInstance.instance = new LoggerInstance(options)
    }
    return LoggerInstance.instance
  }

  /** 初始化单例（仅在首次调用前生效） */
  static init(options: LoggerOptions): LoggerInstance {
    if (!LoggerInstance.instance) {
      LoggerInstance.instance = new LoggerInstance(options)
    }
    return LoggerInstance.instance
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= this.minLevel
  }

  private formatTime(): string {
    return new Date().toLocaleString('zh-CN', { hour12: false })
  }

  private formatMessage(level: LogLevel, message: string, ...args: any[]): string {
    const extra = args.length > 0 ? ' ' + args.map(a => {
      try { return typeof a === 'object' ? JSON.stringify(a, null, 0) : String(a) }
      catch { return String(a) }
    }).join(' ') : ''
    return `[${this.formatTime()}][${level.toUpperCase()}][${this.module}] ${message}${extra}`
  }

  private toFileLine(level: LogLevel, message: string, ...args: any[]): string {
    const extra = args.length > 0 ? ' ' + args.map(a => {
      try { return typeof a === 'object' ? JSON.stringify(a) : String(a) }
      catch { return String(a) }
    }).join(' ') : ''
    return `[${this.formatTime()}][${level.toUpperCase()}][${this.module}] ${message}${extra}`
  }

  private write(level: LogLevel, message: string, ...args: any[]) {
    if (!this.shouldLog(level)) return

    const formatted = this.formatMessage(level, message, ...args)
    const fileLine = this.toFileLine(level, message, ...args)

    // 终端输出（console.debug 在多数浏览器默认隐藏，改用 console.log）
    switch (level) {
      case 'debug':
        console.log(formatted)
        break
      case 'info':
        console.info(formatted)
        break
      case 'warn':
        console.warn(formatted)
        break
      case 'error':
        console.error(formatted)
        break
    }

    // 2. Console 面板
    this.onOutput?.(formatted)

    // 3. 写入文件（Electron IPC）
    if (this.enableFile && typeof window !== 'undefined' && typeof window.electronAPI?.writeLogFile === 'function') {
      window.electronAPI.writeLogFile(level, fileLine).catch(() => {})
    }

    // 4. 游戏日志（Game.launch 开启后，本局日志同步写入独立 game_*.log 文件）
    if (this._gameLogActive && typeof window !== 'undefined' && typeof window.electronAPI?.writeGameLog === 'function') {
      window.electronAPI.writeGameLog(level, fileLine).catch(() => {})
    }
  }

  // ─── 游戏日志（每次启动游戏独立文件，滚动删除）───

  /** 开始游戏日志：创建独立 game_*.log 文件，后续日志同时写入 */
  beginGameLog(projectName?: string): void {
    this._gameLogActive = true
    if (typeof window !== 'undefined' && typeof window.electronAPI?.startGameLog === 'function') {
      window.electronAPI.startGameLog(projectName).catch(() => {})
    }
  }

  /** 结束游戏日志：停止写入 game 文件（文件保留，滚动清理） */
  endGameLog(): void {
    this._gameLogActive = false
    if (typeof window !== 'undefined' && typeof window.electronAPI?.stopGameLog === 'function') {
      window.electronAPI.stopGameLog().catch(() => {})
    }
  }

  /** 当前是否处于游戏日志开启状态（调试用） */
  get gameLogActive(): boolean {
    return this._gameLogActive
  }

  // ─── 公开 API ───

  debug(message: string, ...args: any[]) { this.write('debug', message, ...args) }
  info(message: string, ...args: any[]) { this.write('info', message, ...args) }
  warn(message: string, ...args: any[]) { this.write('warn', message, ...args) }
  error(message: string, ...args: any[]) { this.write('error', message, ...args) }

  /** 设置 Console 面板输出回调 */
  setOutputCallback(cb: (text: string) => void) {
    this.onOutput = cb
  }
}

/** 全局默认 Logger 单例 */
export const logger = LoggerInstance.getInstance({ module: 'DemoStudio', minLevel: 'debug' })

export { LoggerInstance as Logger }
