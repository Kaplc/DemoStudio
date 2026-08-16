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
  const assetLintIssueCount = useCodeLintStore((s) => s.assetIssues.length)
  const codeLintOpen = useCodeLintStore((s) => s.panelOpen)
  const setCodeLintOpen = useCodeLintStore((s) => s.setPanelOpen)
  // 代码 + 资产问题合并计数（共用右下角入口）
  const totalIssueCount = codeLintIssueCount + assetLintIssueCount

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
