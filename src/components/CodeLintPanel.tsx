/**
 * CodeLintPanel — 代码/资产检查 tips 悬浮面板
 *
 * 悬浮气泡层（fixed 定位，状态栏上方右下角），不占布局高度：
 * - 打开工程首扫有问题（代码或资产）→ engine 自动 setPanelOpen(true) 弹出；无问题不弹
 * - 手动 X 收起；收起后通过状态栏入口重新点开
 * - 两条来源分节展示：代码问题（CodeLint：规则名 + message + 相对路径:行:列）、
 *   资产问题（AssetLint：规则名 + message + 文件 > 节点 [字段]，warn 黄 / error 红）
 * - 点击条目复制该条完整内容到剪贴板（`[规则] 消息 定位`，Console 同步提示"已复制"）；顶部"复制全部"按钮
 */
import React from 'react'
import { useCodeLintStore } from '../stores/useCodeLintStore'
import { useEditorStore } from '../stores/editorStore'

export function CodeLintPanel() {
  const issues = useCodeLintStore((s) => s.issues)
  const assetIssues = useCodeLintStore((s) => s.assetIssues)
  const panelOpen = useCodeLintStore((s) => s.panelOpen)
  const setPanelOpen = useCodeLintStore((s) => s.setPanelOpen)
  const addConsoleOutput = useEditorStore((s) => s.addConsoleOutput)

  const totalCount = issues.length + assetIssues.length

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
    if (totalCount === 0) {
      addConsoleOutput('[CodeLint] 当前无问题可复制')
      return
    }
    const codeLines = issues.map((i) => `${i.file}:${i.line}:${i.col} ${i.message}`)
    const assetLines = assetIssues.map(
      (i) => `${i.file} > ${i.nodePath} [${i.field}] ${i.message}`,
    )
    copyToClipboard([...codeLines, ...assetLines].join('\n'))
  }

  if (!panelOpen) return null

  return (
    <div className="codelint-panel">
      <div className="codelint-panel-header">
        <span className="codelint-panel-title">代码/资产检查 CodeLint + AssetLint</span>
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
        {totalCount === 0 ? (
          <div className="codelint-empty">✓ 未发现代码/资产规范问题</div>
        ) : (
          <>
            {issues.length > 0 && (
              <div className="codelint-section">
                <div className="codelint-section-title">代码问题（{issues.length}）</div>
                {issues.map((issue, idx) => (
                  <div
                    key={`code-${idx}`}
                    className="codelint-item"
                    title={`点击复制: [${issue.rule}] ${issue.message} ${issue.file}:${issue.line}:${issue.col}`}
                    onClick={() =>
                      copyToClipboard(
                        `[${issue.rule}] ${issue.message} ${issue.file}:${issue.line}:${issue.col}`,
                      )
                    }
                  >
                    <span className="codelint-rule">[{issue.rule}]</span>
                    <span className="codelint-msg">{issue.message}</span>
                    <span className="codelint-pos">
                      {issue.file}:{issue.line}:{issue.col}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {assetIssues.length > 0 && (
              <div className="codelint-section">
                <div className="codelint-section-title">资产问题（{assetIssues.length}）</div>
                {assetIssues.map((issue, idx) => (
                  <div
                    key={`asset-${idx}`}
                    className="codelint-item"
                    title={`点击复制: [${issue.rule}] ${issue.message} ${issue.file} > ${issue.nodePath} [${issue.field}]`}
                    onClick={() =>
                      copyToClipboard(
                        `[${issue.rule}] ${issue.message} ${issue.file} > ${issue.nodePath} [${issue.field}]`,
                      )
                    }
                  >
                    <span className={`codelint-rule asset-sev-${issue.severity}`}>[{issue.rule}]</span>
                    <span className="codelint-msg">{issue.message}</span>
                    <span className="codelint-pos">
                      {issue.file} &gt; {issue.nodePath} [{issue.field}]
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
