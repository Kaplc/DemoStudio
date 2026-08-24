/**
 * 输入框：支持 Enter 发送 / Shift+Enter 换行 / 运行中切换为停止按钮。
 *
 * 对齐 DSH Web 端 InputBar 的 Send/Stop 切换逻辑：
 * - AI 空闲时：显示"发送"按钮，Enter 提交
 * - AI 生成中（running=true）：主按钮切换为"停止"（■ 方块），Enter 仍然可以排队消息
 */
import * as React from 'react'

interface Props {
  onSend: (text: string) => void
  onStop?: () => void
  running?: boolean
  disabled?: boolean
}

export const InputBox: React.FC<Props> = ({ onSend, onStop, running, disabled }) => {
  const [text, setText] = React.useState('')

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    onSend(trimmed)
    setText('')
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (running) {
        // 运行中 Enter 仍可排队消息（对齐 DSH Web 端行为）
        submit()
      } else {
        submit()
      }
    }
  }

  const onPrimary = () => {
    if (running && onStop) {
      onStop()
      return
    }
    submit()
  }

  return (
    <div className="input-box">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={running ? 'AI 正在生成中，可继续输入排队...' : '向 DSH 提问...（Enter 发送 / Shift+Enter 换行）'}
        rows={3}
        disabled={disabled}
      />
      {running && onStop ? (
        <button
          className="input-box__stop"
          onClick={onPrimary}
          title="停止生成"
        >
          {/* ■ 方块图标 — 与 DSH Web 端一致 */}
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
            <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
          </svg>
        </button>
      ) : (
        <button onClick={onPrimary} disabled={disabled || !text.trim()}>发送</button>
      )}
    </div>
  )
}
