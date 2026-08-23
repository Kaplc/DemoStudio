/**
 * ToolCallTree：工具调用树组件（对齐 DSH ui-tool 的 ToolCallTree）
 *
 * 展示工具调用的层级结构，支持：
 * - 状态指示器（pending/running/success/error）
 * - 可折叠的详情面板
 * - 文件路径链接
 * - 参数/结果 JSON 展示
 * - 子调用递归渲染
 */
import * as React from 'react'
import type { ToolCall, ToolVariant } from './types'

interface ToolCallTreeProps {
  tool: ToolCall
  onOpenFile?: (path: string) => void
}

/** 工具变体 → 图标 */
const VARIANT_ICONS: Record<ToolVariant, string> = {
  search: '🔍',
  read: '📄',
  bash: '⌨️',
  write: '✏️',
  edit: '📝',
  code: '💻',
  others: '⚡',
}

/** 状态 → 图标和样式 */
const STATE_MAP = {
  pending:  { icon: '⏳', dot: 'state-dot--pending', label: '等待中' },
  running:  { icon: '🔄', dot: 'state-dot--running', label: '运行中' },
  success:  { icon: '✅', dot: 'state-dot--success', label: '完成' },
  error:    { icon: '❌', dot: 'state-dot--error',   label: '失败' },
  stopped:  { icon: '⚠️', dot: 'state-dot--stopped', label: '中断' },
}

/** 工具名称 → 中文摘要 */
function toolSummary(tool: ToolCall): string {
  const { name, args, filePath } = tool
  switch (name) {
    case 'inspect_scene':
      return `检查场景${args.scenePath ? `: ${args.scenePath}` : ''}`
    case 'run_scenario':
      return `运行场景测试 (${(args.durationMs as number ?? 20000) / 1000}s)`
    case 'get_game_state':
      return '获取游戏状态快照'
    case 'set_game_speed':
      return `设置游戏速度: ${args.speed ?? 1}x`
    case 'spawn_entity':
      return `生成实体${args.type ? `: ${args.type}` : ''}`
    case 'read_file':
      return filePath ? `读取 ${filePath}` : '读取文件'
    case 'write_file':
      return filePath ? `写入 ${filePath}` : '写入文件'
    case 'edit_file':
      return filePath ? `编辑 ${filePath}` : '编辑文件'
    case 'search':
      return `搜索: ${args.query ?? ''}`
    case 'bash':
      return `执行命令: ${args.command ?? ''}`
    default:
      return name.replace(/_/g, ' ')
  }
}

/** 截断 JSON 字符串 */
function truncateJson(value: unknown, maxLen = 500): string {
  try {
    const str = JSON.stringify(value, null, 2)
    return str.length > maxLen ? str.slice(0, maxLen) + '...' : str
  } catch {
    return String(value)
  }
}

export const ToolCallTree: React.FC<ToolCallTreeProps> = ({ tool, onOpenFile }) => {
  const [expanded, setExpanded] = React.useState(false)
  const st = STATE_MAP[tool.state]
  const variant = tool.variant ?? 'others'
  const icon = tool.state === 'running' || tool.state === 'pending'
    ? st.icon
    : (VARIANT_ICONS[variant] ?? '⚡')
  const summary = toolSummary(tool)
  const hasDetails = tool.args && Object.keys(tool.args).length > 0
    || tool.result !== undefined
    || tool.error
    || tool.subCalls.length > 0

  return (
    <div className={`tool-row tool-row--${tool.state}`} data-call-id={tool.id}>
      {/* ── 摘要行（可点击展开）── */}
      <div
        className="tool-row__head"
        onClick={() => hasDetails && setExpanded(!expanded)}
        role={hasDetails ? 'button' : undefined}
        tabIndex={hasDetails ? 0 : undefined}
      >
        <span className={`state-dot ${st.dot}`} title={st.label} />
        <span className="tool-row__icon">{icon}</span>
        <span className="tool-row__name">{tool.name.replace(/_/g, ' ')}</span>
        <span className="tool-row__sep">·</span>
        <span className="tool-row__summary">{summary}</span>
        {tool.durationMs != null && (
          <span className="tool-row__duration">{(tool.durationMs / 1000).toFixed(1)}s</span>
        )}
        {hasDetails && (
          <span className="tool-row__chevron">{expanded ? '▼' : '▶'}</span>
        )}
      </div>

      {/* ── 展开详情 ── */}
      {expanded && (
        <div className="tool-row__body">
          {/* 文件路径链接 */}
          {tool.filePath && onOpenFile && (
            <div className="tool-row__file" onClick={() => onOpenFile(tool.filePath!)}>
              📂 {tool.filePath}
            </div>
          )}

          {/* 参数 */}
          {tool.args && Object.keys(tool.args).length > 0 && (
            <details className="tool-row__section" open>
              <summary>参数</summary>
              <pre className="tool-row__json">{truncateJson(tool.args)}</pre>
            </details>
          )}

          {/* 结果 */}
          {tool.result !== undefined && (
            <details className="tool-row__section">
              <summary>结果</summary>
              <pre className="tool-row__json">{truncateJson(tool.result)}</pre>
            </details>
          )}

          {/* 错误 */}
          {tool.error && (
            <div className="tool-row__error">{tool.error}</div>
          )}

          {/* 子调用 */}
          {tool.subCalls.length > 0 && (
            <div className="tool-row__subcalls">
              {tool.subCalls.map(sub => (
                <ToolCallTree key={sub.id} tool={sub} onOpenFile={onOpenFile} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
