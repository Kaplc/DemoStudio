/**
 * 工具调用卡片组件
 * 参考 DSH Web UI 的 ToolRow 设计
 *
 * write/edit 工具卡片默认自动展开，渲染 diff 视图（行号 + 红/绿行 + 上下文，对齐 DSH DiffBlock 风格）：
 * - 进行中（无 result）：从入参派生"将要做的修改"（deriveDiffsFromArgs）
 * - 已完成：展示 result meta 携带的已应用权威 hunk（tool.diffs，含 3 行上下文）
 * - 失败/非文件工具：回退通用 JSON 视图（输入/输出）
 * - 默认全量展开不折叠（用户决策 2026-09-10：剩余行数也要直接显示）
 * - edit/write 卡片默认自动展开（用户决策 2026-09-10），点击头部仍可收起/再展开
 *
 * 使用 React.memo 避免父组件重渲染时不必要的更新。
 */
import React, { useEffect, useState, useMemo } from 'react'
import type { ToolState, FileDiff } from '../../types/agent'
import {
  deriveDiffsFromArgs, buildDiffRows, formatDiffRowsForCopy, resolveDiffStartLines, isDiffToolName,
} from './toolDiff'

interface ToolCardProps {
  tool: ToolState
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str
  return str.slice(0, max) + '...'
}

/** 缓存 JSON.stringify 结果，避免每次 render 重新序列化 */
function useSerializedJson(value: unknown): string {
  return useMemo(() => {
    if (!value) return ''
    try { return JSON.stringify(value, null, 2) } catch { return String(value) }
  }, [value])
}

/** 渲染进程文件读取器：定位 hunk 绝对行号用（浏览器模式无 electronAPI 时返回 null） */
async function readDiffFile(path: string): Promise<string | null> {
  const api = window.electronAPI
  if (!api?.readTextFile) return null
  try {
    const res = await api.readTextFile(path)
    return res?.success ? (res.data ?? null) : null
  } catch {
    return null
  }
}

/** diff 视图主体（展开卡片内的行序列 + 复制）。默认全量展开不折叠（用户决策 2026-09-10）。 */
const DiffBody: React.FC<{ diffs: FileDiff[] }> = ({ diffs }) => {
  const [copied, setCopied] = useState(false)
  const [startLines, setStartLines] = useState<ReadonlyMap<number, number>>()

  // best-effort 绝对行号定位：展开后异步读当前文件内容，锚定各 hunk 起始行
  useEffect(() => {
    let cancelled = false
    resolveDiffStartLines(diffs, readDiffFile).then((map) => {
      if (!cancelled && map.size > 0) setStartLines(map)
    })
    return () => { cancelled = true }
  }, [diffs])

  const rows = useMemo(() => buildDiffRows(diffs, startLines), [diffs, startLines])

  const handleCopy = () => {
    if (copied) return
    const clip = navigator.clipboard
    if (!clip?.writeText) return
    clip.writeText(formatDiffRowsForCopy(rows)).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1000)
    }).catch(() => { /* 剪贴板失败静默：复制是辅助能力 */ })
  }

  if (rows.length === 0) return null

  return (
    <div className="tool-diff">
      <button type="button" className="tool-diff__copy" onClick={handleCopy}>
        {copied ? '复制成功' : '复制'}
      </button>
      <div className="tool-diff__body">
        {rows.map((row, i) => (
          <div key={i} className={`tool-diff__row tool-diff__row--${row.kind}`}>
            {row.kind !== 'path' && row.kind !== 'gap' && (
              <span className="tool-diff__gutter" aria-hidden>
                {row.kind === 'del' ? '-' : row.kind === 'add' ? '+' : ''}{row.line}
              </span>
            )}
            <span className={row.kind === 'path' || row.kind === 'gap' ? 'tool-diff__pathtext' : 'tool-diff__text'}>
              {row.text === '' ? '\u00A0' : row.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

const ToolCardInner: React.FC<ToolCardProps> = ({ tool }) => {
  // edit/write 卡片默认自动展开（用户决策 2026-09-10：diff 直接可见），其余工具仍点击展开
  const [expanded, setExpanded] = useState(() => isDiffToolName(tool.name))

  const argsStr = useSerializedJson(tool.args)
  const resultStr = useSerializedJson(tool.result)

  // 摘要：显示参数的关键信息（memoize）
  const summary = useMemo(() => {
    // ask_user_question 特殊摘要：显示问题文本
    if (tool.name === 'ask_user_question' && tool.args && typeof tool.args === 'object') {
      const questions = (tool.args as { questions?: Array<{ question?: string }> }).questions
      if (Array.isArray(questions) && questions.length > 0) {
        const first = questions[0]
        if (first?.question) {
          return truncate(first.question, 80)
        }
      }
    }
    if (!tool.args || typeof tool.args !== 'object') return ''
    const obj = tool.args as Record<string, unknown>
    const keys = Object.keys(obj)
    if (keys.length === 0) return ''
    for (const k of keys) {
      const v = obj[k]
      if (typeof v === 'string' && v.length > 0) return truncate(v, 60)
    }
    return truncate(JSON.stringify(obj), 60)
  }, [tool.args, tool.name])

  // diff 数据源：settle 后用权威 meta.diffs；进行中从入参派生意图（失败不派生，走通用视图展示错误）
  const diffs = useMemo(() => {
    if (tool.diffs && tool.diffs.length > 0) return tool.diffs
    if (tool.status === 'running' || tool.status === 'pending') {
      return deriveDiffsFromArgs(tool.name, tool.args)
    }
    return null
  }, [tool.diffs, tool.name, tool.args, tool.status])

  return (
    <div className={`tool-card tool-card--${tool.status}`}>
      <div
        className="tool-card__head"
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpanded(!expanded) }}
      >
        <span className="tool-card__name">{tool.name}</span>
        <span className="tool-card__summary">{summary}</span>
        <span className="tool-card__status-dot"></span>
        <span className="tool-card__arrow">{expanded ? '▼' : '▶'}</span>
      </div>

      {expanded && (
        <div className="tool-card__details">
          {diffs && diffs.length > 0 ? (
            <DiffBody diffs={diffs} />
          ) : (
            argsStr && (
              <div className="tool-card__section">
                <div className="tool-card__section-label">输入</div>
                <div className="md-code-block">
                  <pre><code>{argsStr}</code></pre>
                </div>
              </div>
            )
          )}
          {(!diffs || !diffs.length || tool.status === 'failure') && resultStr && (
            <div className="tool-card__section">
              <div className="tool-card__section-label">输出</div>
              <div className={`md-code-block ${tool.status === 'failure' ? 'md-code-block--error' : ''}`}>
                <pre><code>{resultStr}</code></pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export const ToolCard = React.memo(ToolCardInner, (prev, next) => {
  return prev.tool.id === next.tool.id
    && prev.tool.status === next.tool.status
    && prev.tool.result === next.tool.result
    && prev.tool.args === next.tool.args
    && prev.tool.diffs === next.tool.diffs
})
