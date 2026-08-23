/**
 * 输入框：支持 Enter 发送 / Shift+Enter 换行 / @ 提及提示（M2.5 完善）
 */
import * as React from 'react'

interface Props {
  onSend: (text: string) => void
  disabled?: boolean
}

export const InputBox: React.FC<Props> = ({ onSend, disabled }) => {
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
      submit()
    }
  }

  return (
    <div className="input-box">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="向 DSH 提问...（Enter 发送 / Shift+Enter 换行）"
        rows={3}
        disabled={disabled}
      />
      <button onClick={submit} disabled={disabled || !text.trim()}>发送</button>
    </div>
  )
}
