import React from 'react'
import { useEditorStore } from '../stores/editorStore'
import { useCodeLintStore } from '../stores/useCodeLintStore'

interface StatusBarProps {
  renderFps: number
  logicFps: number
  projectName: string
}

export function StatusBar({ renderFps, logicFps, projectName }: StatusBarProps) {
  const { gameState, consoleErrors, refreshConsoleErrors, clearConsoleErrors, consoleErrPanelOpen, setConsoleErrPanelOpen } = useEditorStore()
  const codeLintIssueCount = useCodeLintStore((s) => s.issues.length)
  const assetLintIssueCount = useCodeLintStore((s) => s.assetIssues.length)
  const codeLintOpen = useCodeLintStore((s) => s.panelOpen)
  const setCodeLintOpen = useCodeLintStore((s) => s.setPanelOpen)
  // 代码 + 资产问题合并计数（共用右下角入口）
  const totalIssueCount = codeLintIssueCount + assetLintIssueCount
  // 报错计数：ERROR 行数 + WARN 行数
  const errCount = consoleErrors.length
  const errorCount = consoleErrors.filter((t) => /(\[ERROR\]|CONSOLE:ERROR)/.test(t)).length
  const warnCount = errCount - errorCount

  // 点击展开时顺带刷新一次日志文件读取（保证徽标/面板都是最新数据）
  const toggleErrPanel = () => {
    const next = !consoleErrPanelOpen
    setConsoleErrPanelOpen(next)
    if (next) refreshConsoleErrors()
  }

  return (
    <div className="status-bar">
      <div className="status-left">
        <span>{projectName}</span>
        <span>|</span>
        <span>
          <span className={`status-dot ${gameState.running ? 'running' : 'stopped'}`} style={{ marginRight: 4 }} />
          {gameState.running ? 'Running' : 'Stopped'}
        </span>
      </div>
      <div className="status-right">
        {/* 控制台报错/警告入口：有错误红色徽标（warning 有黄色小点），点击展开/收起报错面板 */}
        <span
          className={`status-err ${errCount > 0 ? 'has-errors' : 'clean'}${consoleErrPanelOpen ? ' open' : ''}`}
          onClick={toggleErrPanel}
          title={
            errCount > 0
              ? `控制台报错: ${errCount} 条（错误 ${errorCount} · 警告 ${warnCount}，点击${consoleErrPanelOpen ? '收起' : '展开'}；右键清空）`
              : '控制台报错: 无（点击展开面板）'
          }
          onContextMenu={(e) => {
            e.preventDefault()
            clearConsoleErrors()
            setConsoleErrPanelOpen(false)
          }}
        >
          {errCount > 0 ? (
            <>
              <span className="codelint-icon">❌</span>
              <span className="err-badge">{errCount}</span>
              <span className="status-label">Console</span>
            </>
          ) : (
            <>
              <span className="codelint-icon">✓</span>
              <span className="status-label">Console</span>
            </>
          )}
        </span>
        {/* 代码/资产检查入口：有 issue 红色计数徽标，无 issue 绿色 ✓；点击切换 tips 面板 */}
        <span
          className={`status-codelint ${totalIssueCount > 0 ? 'has-issues' : 'clean'}${codeLintOpen ? ' open' : ''}`}
          onClick={() => setCodeLintOpen(!codeLintOpen)}
          title={
            totalIssueCount > 0
              ? `代码/资产检查: ${totalIssueCount} 个问题（代码 ${codeLintIssueCount} · 资产 ${assetLintIssueCount}，点击${codeLintOpen ? '收起' : '展开'}）`
              : '代码/资产检查: 无问题'
          }
        >
          {totalIssueCount > 0 ? (
            <>
              <span className="codelint-icon">⚠</span>
              <span className="codelint-badge">{totalIssueCount}</span>
              <span className="status-label">Lint</span>
            </>
          ) : (
            <>
              <span className="codelint-icon">✓</span>
              <span className="status-label">Lint</span>
            </>
          )}
        </span>
        <span>Render: {renderFps} fps | Logic: {logicFps} fps</span>
      </div>
    </div>
  )
}
