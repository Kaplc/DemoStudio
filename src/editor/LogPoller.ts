/**
 * LogPoller — 日志文件轮询器
 *
 * 从 ProjectPanel.tsx 中剥离的日志读取逻辑。
 * 在 Electron 环境下定时轮询日志文件，返回最新内容。
 */
export type LogContentCallback = (content: string, error: string | null) => void

export class LogPoller {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private callback: LogContentCallback | null = null

  /** 开始轮询日志（默认间隔 2s） */
  start(callback: LogContentCallback, intervalMs = 2000): void {
    this.callback = callback

    if (!window.electronAPI?.readLogFile) {
      callback('', '日志读取仅支持 Electron 环境')
      return
    }

    const fetchLog = async () => {
      try {
        const text = await window.electronAPI.readLogFile!({ tail: 200 })
        callback(text, null)
      } catch {
        callback('', '日志读取失败')
      }
    }

    fetchLog()
    this.intervalId = setInterval(fetchLog, intervalMs)
  }

  /** 停止轮询 */
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    this.callback = null
  }

  /** 销毁轮询器 */
  destroy(): void {
    this.stop()
  }
}
