/**
 * 输入框组件 —— 对齐 DSH Web UI 风格
 * 
 * 胶囊圆角 + 圆形发送按钮 + 自动扩展 + 停止按钮
 */
import React, { useState, useRef, useEffect } from 'react'

interface InputBoxProps {
  onSend: (text: string) => void
  onStop?: () => void
  disabled?: boolean
  running?: boolean
  placeholder?: string
}

export const InputBox: React.FC<InputBoxProps> = ({
  onSend,
  onStop,
  disabled = false,
  running = false,
  placeholder = '向 Agent 提问...（Enter 发送 / Shift+Enter 换行）'
}) => {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed || disabled || running) return
    onSend(trimmed)
    setText('')
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value)
  }

  // 镜像 div 驱动自动扩展高度
  useEffect(() => {
    if (mirrorRef.current && textareaRef.current) {
      mirrorRef.current.textContent = text + '\n'
      const mirrorH = mirrorRef.current.scrollHeight
      const container = textareaRef.current.closest('.agent-panel')
      const maxH = container ? Math.floor(container.clientHeight / 3) : 200
      // textarea 始终展开到内容高度，由外层 scroll 容器限制滚动
      const newH = Math.max(22, mirrorH)
      textareaRef.current.style.height = newH + 'px'
      textareaRef.current.style.overflowY = 'hidden'
      // 外层 scroll 容器设置最大高度
      const scrollEl = textareaRef.current.closest('.composer__scroll') as HTMLElement
      if (scrollEl) {
        scrollEl.style.maxHeight = maxH + 'px'
      }
    }
  }, [text])

  const isEmpty = !text.trim()

  return (
    <div className="composer">
      <div className="composer__card">
        <div className="composer__scroll">
          <div className="composer__grow">
            <div className="composer__mirror" ref={mirrorRef} aria-hidden="true" />
            <textarea
              ref={textareaRef}
              className="composer__input"
              value={text}
              onChange={handleInput}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              rows={1}
              disabled={disabled}
              readOnly={running}
            />
          </div>
        </div>

        <div className="composer__row">
          <div className="composer__tools">
            {/* 预留：+ 按钮、权限选择器 */}
          </div>
          <div className="composer__trailing">
            {running && onStop ? (
              <button
                className="composer__stop"
                onClick={onStop}
                title="停止生成"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <rect x="3" y="3" width="10" height="10" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                className={`composer__send ${isEmpty ? 'composer__send--disabled' : ''}`}
                onClick={submit}
                disabled={disabled || isEmpty}
                title="发送 (Enter)"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8.3125 15.0195C8.70103 15.0195 9.01562 14.7049 9.01562 14.3164V4.87793L11.8359 7.69824C12.1108 7.97313 12.5559 7.97313 12.8308 7.69824C13.1057 7.42335 13.1057 6.97827 12.8308 6.70337L8.99487 2.86743C8.86255 2.73511 8.68466 2.66113 8.49878 2.66113C8.31289 2.66113 8.13501 2.73511 8.00269 2.86743L4.16675 6.70337C3.89185 6.97827 3.89185 7.42335 4.16675 7.69824C4.44164 7.97313 4.88673 7.97313 5.16162 7.69824L7.98047 4.87793V14.3164C7.98047 14.7049 8.29506 15.0195 8.3125 15.0195Z" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
