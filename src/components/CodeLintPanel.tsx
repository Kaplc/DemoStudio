/**
 * CodeLintPanel — 代码扫描 tips 悬浮面板
 *
 * 悬浮气泡层（fixed 定位，状态栏上方右下角），不占布局高度：
 * - 打开工程首扫有问题 → engine 自动 setPanelOpen(true) 弹出；无问题不弹
 * - 手动 X 收起；收起后通过状态栏入口重新点开
 * - 每条 issue：规则名 + message + 相对路径:行:列；点击条目复制完整路径到剪贴板
 *   （Console 同步提示"已复制"）；顶部"复制全部"按钮
 */
import React from 'react'
import { useCodeLintStore } from '../stores/useCodeLintStore'
import { useEditorStore } from '../stores/editorStore'

export function CodeLintPanel() {
  const issues = useCodeLintStore((s) => s.issues)
  const panelOpen = useCodeLintStore((s) => s.panelOpen)
  const setPanelOpen = useCodeLintStore((s) => s.setPanelOpen)
  const addConsoleOutput = useEditorStore((s) => s.addConsoleOutput)

  const copyToClipboard = (text: string) => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(text)
        addConsoleOutput(`[CodeLint] 已复制: ${text}`)
      } catch {
        addConsoleOutput('[CodeLint] 复制失败（剪贴板不可用）')
      }
    })()
  }

  const copyAll = () => {
    if (issues.length === 0) {
      addConsoleOutput('[CodeLint] 当前无问题可复制')
      return
    }
    const text = issues.map((i) => `${i.file}:${i.line}:${i.col} ${i.message}`).join('\n')
    copyToClipboard(text)
  }

  if (!panelOpen) return null

  return (
    <div className="codelint-panel">
      <div className="codelint-panel-header">
        <span className="codelint-panel-title">代码检查 CodeLint</span>
        <div className="codelint-panel-actions">
          <button className="codelint-btn" onClick={copyAll}>复制全部</button>
          <button
            className="codelint-btn codelint-close"
            onClick={() => setPanelOpen(false)}
            title="收起"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="codelint-panel-body">
        {issues.length === 0 ? (
          <div className="codelint-empty">✓ 未发现代码规范问题</div>
        ) : (
          issues.map((issue, idx) => (
            <div
              key={idx}
              className="codelint-item"
              title={`点击复制: ${issue.file}:${issue.line}:${issue.col}`}
              onClick={() => copyToClipboard(`${issue.file}:${issue.line}:${issue.col}`)}
            >
              <span className="codelint-rule">[{issue.rule}]</span>
              <span className="codelint-msg">{issue.message}</span>
              <span className="codelint-pos">
                {issue.file}:{issue.line}:{issue.col}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
