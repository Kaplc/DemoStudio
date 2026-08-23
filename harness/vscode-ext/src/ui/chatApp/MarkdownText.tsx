/**
 * MarkdownText：轻量级 Markdown 渲染器（webview 内使用，无外部依赖）
 *
 * 支持：标题 / 粗体 / 斜体 / 行内代码 / 代码块 / 链接 / 列表 / 换行
 */
import * as React from 'react'

interface MarkdownTextProps {
  text: string
  streaming?: boolean
}

/** 转义 HTML 特殊字符 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 将 Markdown 文本转为 HTML（简单实现） */
function markdownToHtml(text: string): string {
  let html = text

  // 代码块（```...```）
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const escaped = escapeHtml(code.trimEnd())
    const langLabel = lang ? `<span class="code-lang">${lang}</span>` : ''
    return `<div class="code-block"><div class="code-block__head">${langLabel}<button class="code-block__copy" data-code="${encodeURIComponent(code.trimEnd())}">复制</button></div><pre><code>${escaped}</code></pre></div>`
  })

  // 行内代码（`...`）
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')

  // 标题（# ## ###）
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>')
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>')

  // 粗体（**...**）
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

  // 斜体（*...*）
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // 链接（[text](url)）
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')

  // 无序列表（- item）
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')

  // 有序列表（1. item）
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>')

  // 换行
  html = html.replace(/\n/g, '<br/>')

  return html
}

export const MarkdownText: React.FC<MarkdownTextProps> = ({ text, streaming }) => {
  const html = React.useMemo(() => markdownToHtml(text), [text])
  const ref = React.useRef<HTMLDivElement>(null)

  // 复制代码块
  const handleClick = React.useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.classList.contains('code-block__copy')) {
      const code = decodeURIComponent(target.getAttribute('data-code') ?? '')
      navigator.clipboard.writeText(code).then(() => {
        target.textContent = '已复制'
        setTimeout(() => { target.textContent = '复制' }, 1500)
      })
    }
  }, [])

  return (
    <div
      ref={ref}
      className={`markdown-body${streaming ? ' markdown-body--streaming' : ''}`}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
