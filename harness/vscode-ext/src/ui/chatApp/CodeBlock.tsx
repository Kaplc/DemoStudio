/**
 * 代码块组件：检测 ```lang → 高亮 + "应用到文件" 按钮
 *
 * 高亮：第一版用简单正则词法着色；M2.5 可换 shiki/prismjs
 * 应用：调用 vscode workspace fs 写文件（基于 webview → extension host 通信）
 */
import * as React from 'react'

interface Props {
  lang?: string
  code?: string
}

declare const vscode: { postMessage(msg: unknown): void }

export const CodeBlock: React.FC<Props> = ({ lang, code }) => {
  const [applied, setApplied] = React.useState(false)
  const apply = () => {
    // 从用户最近的 `# path: <path>` 提示解析；若未指定则要求用户
    vscode.postMessage({ type: 'applyCode', lang, code })
    setApplied(true)
    setTimeout(() => setApplied(false), 1500)
  }
  return (
    <div className="code-block">
      <div className="code-block__head">
        <span className="code-block__lang">{lang ?? 'text'}</span>
        <button className="code-block__apply" onClick={apply} disabled={applied}>{applied ? '已发送' : '应用'}</button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  )
}
