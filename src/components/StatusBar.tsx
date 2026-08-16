import React from 'react'
import { useEditorStore } from '../stores/editorStore'
import { useCodeLintStore } from '../stores/useCodeLintStore'

interface StatusBarProps {
  fps: number
  projectName: string
}

export function StatusBar({ fps, projectName }: StatusBarProps) {
  const { gameState } = useEditorStore()
  const codeLintIssueCount = useCodeLintStore((s) => s.issues.length)
  const codeLintOpen = useCodeLintStore((s) => s.panelOpen)
  const setCodeLintOpen = useCodeLintStore((s) => s.setPanelOpen)

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
        {/* codeLint 入口：有 issue 红色计数徽标，无 issue 绿色 ✓；点击切换 tips 面板 */}
        <span
          className={`status-codelint ${codeLintIssueCount > 0 ? 'has-issues' : 'clean'}${codeLintOpen ? ' open' : ''}`}
          onClick={() => setCodeLintOpen(!codeLintOpen)}
          title={
            codeLintIssueCount > 0
              ? `代码检查: ${codeLintIssueCount} 个问题（点击${codeLintOpen ? '收起' : '展开'}）`
              : '代码检查: 无问题'
          }
        >
          {codeLintIssueCount > 0 ? (
            <>
              <span className="codelint-icon">⚠</span>
              <span className="codelint-badge">{codeLintIssueCount}</span>
            </>
          ) : (
            <span className="codelint-icon">✓</span>
          )}
        </span>
        <span>FPS: {fps}</span>
      </div>
    </div>
  )
}
