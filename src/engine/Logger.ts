/**
 * DemoStudio 日志系统
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
  private minLevel: number
  private module: string
  private enableFile: boolean
  private onOutput?: (text: string) => void

  constructor(options: LoggerOptions = {}) {
    this.minLevel = LEVEL_ORDER[options.minLevel ?? 'info']
    this.module = options.module ?? 'App'
    this.enableFile = options.enableFile ?? true
    this.onOutput = options.onOutput
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= this.minLevel
  }

  private formatTime(): string {
    return new Date().toLocaleTimeString('zh-CN', { hour12: false })
  }

  private toISO(): string {
    return new Date().toISOString()
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
    return `[${this.toISO()}][${level.toUpperCase()}][${this.module}] ${message}${extra}`
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
    if (this.enableFile && typeof window !== 'undefined' && window.electronAPI?.writeLogFile) {
      window.electronAPI.writeLogFile(level, fileLine).catch(() => {})
    }
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

  /** 创建子 Logger（继承父级配置） */
  child(module: string): LoggerInstance {
    const child = new LoggerInstance({
      minLevel: Object.keys(LEVEL_ORDER).find(k => LEVEL_ORDER[k as LogLevel] === this.minLevel) as LogLevel,
      module: `${this.module}:${module}`,
      enableFile: this.enableFile,
      onOutput: this.onOutput,
    })
    return child
  }
}

/** 全局默认 Logger */
export const logger = new LoggerInstance({ module: 'DemoStudio', minLevel: 'debug' })

/** 创建独立 Logger */
export function createLogger(options: LoggerOptions): LoggerInstance {
  return new LoggerInstance(options)
}

export { LoggerInstance as Logger }
