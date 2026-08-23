import React, { useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

interface MarkdownRendererProps {
  content: string
  streaming?: boolean
}

/** 代码块：带复制按钮 */
const CodeBlock: React.FC<{ className?: string; children: React.ReactNode }> = ({ className, children }) => {
  const [copied, setCopied] = useState(false)
  const language = className?.replace('language-', '') || ''
  const code = String(children).replace(/\n$/, '')

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [code])

  return (
    <div className="md-code-block">
      <div className="md-code-block__header">
        <span className="md-code-block__lang">{language || 'code'}</span>
        <button className="md-code-block__copy" onClick={handleCopy} title="复制代码">
          {copied ? '✓' : '📋'}
        </button>
      </div>
      <pre className={className}><code>{children}</code></pre>
    </div>
  )
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, streaming }) => {
  if (!content) return null

  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre({ children, ...props }) {
            // 提取 code 子元素的 className
            const codeChild = React.Children.toArray(children).find(
              (c) => React.isValidElement(c) && c.type === 'code'
            ) as React.ReactElement<{ className?: string; children?: React.ReactNode }> | undefined

            if (codeChild) {
              return <CodeBlock className={codeChild.props.className}>{codeChild.props.children}</CodeBlock>
            }
            return <pre {...props}>{children}</pre>
          },
          a({ href, children }) {
            return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
