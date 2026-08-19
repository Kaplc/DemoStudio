/**
 * ErrorStatusPanel — 状态栏报错/警告悬浮面板
 *
 * 悬浮气泡层（fixed 定位，状态栏上方右下角，与 CodeLintPanel 同级）：
 * - 数据源：磁盘日志文件（console_*.log）中的 ERROR/WARN 行，面板展开时通过
 *   editorStore.refreshConsoleErrors() 读取一次（readLogFile），无实时监听
 * - 行首按级别着色：ERROR 红 / WARN 黄，点击条目复制整行到剪贴板
 * - 顶部"清空"只清本地快照（不删磁盘日志，下次展开重新读到）；"复制全部"复制所有报错
 */
import React from 'react'
import { useEditorStore } from '../stores/editorStore'

/** 单行文本 → 级别判定（logger 格式 `[时间][LEVEL][模块] ...`） */
function lineSeverity(text: string): 'error' | 'warn' {
  return /(\[ERROR\]|CONSOLE:ERROR)/.test(text) ? 'error' : 'warn'
}

/** 提取行首时间并格式化：
 *  - logger 格式 `[HH:mm:ss]`→ 直接显示
 *  - 主进程 CONSOLE 格式 `[2026-08-18T17:04:41.860Z]` → 转本地 `HH:mm:ss`
 *  无法识别时返回空串 */
function lineTime(text: string): string {
  const m = text.match(/^\[([^\]]+)\]/)
  const raw = m?.[1] ?? ''
  if (!raw) return ''
  // ISO 时间戳（主进程 console-message 格式）→ 本地 HH:mm:ss
  const iso = Date.parse(raw)
  if (!Number.isNaN(iso)) {
    return new Date(iso).toLocaleTimeString('zh-CN', { hour12: false })
  }
  // logger 相对时间 HH:mm:ss 或其他短格式 → 原样
  return raw.trim()
}

/** 去掉行首时间戳/级别前缀，保留可读内容（`[12:00:00][ERROR][DemoStudio] msg` → `msg`） */
function lineMessage(text: string): string {
  // 剥离 `[时间][LEVEL][模块] ` 前缀
  const m = text.match(/\]\[(?:ERROR|WARN|CONSOLE:(?:ERROR|WARNING))\]\[[^\]]*\]\s*(.*)$/)
  return (m?.[1] ?? text).trim()
}

export function ErrorStatusPanel() {
  const consoleErrors = useEditorStore((s) => s.consoleErrors)
  const refreshConsoleErrors = useEditorStore((s) => s.refreshConsoleErrors)
  const clearConsoleErrors = useEditorStore((s) => s.clearConsoleErrors)
  const consoleErrPanelOpen = useEditorStore((s) => s.consoleErrPanelOpen)
  const setConsoleErrPanelOpen = useEditorStore((s) => s.setConsoleErrPanelOpen)
  const addConsoleOutput = useEditorStore((s) => s.addConsoleOutput)

  // 面板展开时读取一次磁盘日志文件刷新快照（无实时监听，读文件按需）
  React.useEffect(() => {
    if (consoleErrPanelOpen) refreshConsoleErrors()
  }, [consoleErrPanelOpen, refreshConsoleErrors])

  if (!consoleErrPanelOpen) return null

  const copyToClipboard = (text: string) => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(text)
        addConsoleOutput(`[报错] 已复制: ${lineMessage(text)}`)
      } catch {
        addConsoleOutput('[报错] 复制失败（剪贴板不可用）')
      }
    })()
  }

  const copyAll = () => {
    if (consoleErrors.length === 0) {
      addConsoleOutput('[报错] 当前无报错可复制')
      return
    }
    void (async () => {
      try {
        await navigator.clipboard.writeText(consoleErrors.join('\n'))
        addConsoleOutput(`[报错] 已复制全部 ${consoleErrors.length} 条`)
      } catch {
        addConsoleOutput('[报错] 复制失败（剪贴板不可用）')
      }
    })()
  }

  return (
    <div className="errpanel">
      <div className="errpanel-header">
        <span className="errpanel-title">控制台报错 Console Errors</span>
        <div className="errpanel-actions">
          <button className="errpanel-btn" onClick={copyAll}>复制全部</button>
          <button className="errpanel-btn" onClick={() => { clearConsoleErrors(); setConsoleErrPanelOpen(false) }} title="清空报错记录并收起面板（不影响主控制台）">
            清空
          </button>
          <button className="errpanel-btn errpanel-close" onClick={() => setConsoleErrPanelOpen(false)} title="收起">✕</button>
        </div>
      </div>
      <div className="errpanel-body">
        {consoleErrors.length === 0 ? (
          <div className="errpanel-empty">✓ 暂无错误/警告</div>
        ) : (
          consoleErrors
            .slice()
            .reverse()
            .map((text, idx) => {
              const sev = lineSeverity(text)
              const time = lineTime(text)
              return (
                <div
                  key={consoleErrors.length - idx}
                  className={`errpanel-item err-${sev}`}
                  title="点击复制整行"
                  onClick={() => copyToClipboard(text)}
                >
                  <span className="errpanel-time">{time}</span>
                  <span className="errpanel-level">[{sev.toUpperCase()}]</span>
                  <span className="errpanel-msg">{lineMessage(text)}</span>
                </div>
              )
            })
        )}
      </div>
    </div>
  )
}