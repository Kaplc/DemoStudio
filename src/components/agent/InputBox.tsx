/**
 * 输入框组件 —— 对齐 DSH Web UI 风格
 *
 * 胶囊圆角 + 圆形发送按钮 + 自动扩展 + 停止按钮 + 斜杠命令
 */
import React, { useState, useRef, useEffect, useCallback } from 'react'
import { ModelSelector } from './ModelSelector'
import { SlashMenu, useSlashCommand, registerDshCommandSource, registerDshSkillSource } from './slash-command'
import { logger } from '../../engine/Logger'

interface InputBoxProps {
  onSend: (text: string) => void
  onStop?: () => void
  disabled?: boolean
  running?: boolean
  placeholder?: string
  currentModel?: { provider: string; model: string } | null
  onModelChange?: (provider: string, model: string) => void
  /** Agent 服务实例（用于获取 DSH commands 和 skills） */
  agentService?: any
}

export const InputBox: React.FC<InputBoxProps> = ({
  onSend,
  onStop,
  disabled = false,
  running = false,
  placeholder = '向 Agent 提问...（Enter 发送 / Shift+Enter 换行）',
  currentModel = null,
  onModelChange,
  agentService,
}) => {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)

  // 注册 DSH command 和 skill 来源（如果有 agentService）
  useEffect(() => {
    if (!agentService) return
    const disposeCommand = registerDshCommandSource(() => agentService)
    const disposeSkill = registerDshSkillSource(() => agentService)
    return () => {
      disposeCommand()
      disposeSkill()
    }
  }, [agentService])

  // 斜杠命令系统
  const {
    isMenuOpen,
    hit,
    candidates,
    highlightIndex,
    handleInput: handleSlashInput,
    handleKeyDown: handleSlashKeyDown,
    selectCommand,
    closeMenu,
    moveHighlight,
  } = useSlashCommand({
    inputRef: textareaRef,
    onCommand: (command, args, newText) => {
      logger.debug(`[InputBox] 命令选择: /${command.name}`)
      // 更新 React state 和 textarea
      if (newText !== undefined) {
        setText(newText)
        // 同步更新 textarea（React controlled component）
        if (textareaRef.current) {
          textareaRef.current.value = newText
          // 设置光标位置
          const cursorPos = newText.indexOf(' ') + 1
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = cursorPos
        }
      }
    },
  })

  const submit = () => {
    const trimmed = text.trim()
    logger.debug(`[InputBox] submit: text="${text}", trimmed="${trimmed}"`)
    if (!trimmed || disabled) {
      logger.debug('[InputBox] submit 跳过: 空文本或禁用')
      return
    }
    // 允许在 running 状态下发送（steer 模式）
    logger.info(`[InputBox] 发送消息: "${trimmed}" (running=${running})`)
    onSend(trimmed)
    setText('')
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 先让斜杠命令系统处理
    if (handleSlashKeyDown(e)) {
      return
    }

    // 原有的 Enter 发送逻辑
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    setText(newValue)

    // 触发斜杠命令检测
    const caret = e.target.selectionStart ?? newValue.length
    handleSlashInput(newValue, caret)
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

  // 动态 placeholder：AI 运行时显示 steer 提示
  const dynamicPlaceholder = running
    ? 'AI 运行中，输入消息将引导 AI（Enter 发送）...'
    : placeholder

  return (
    <div className="composer">
      <div className={`composer__card ${running ? 'composer__card--steer' : ''}`}>
        <div className="composer__scroll">
          <div className="composer__grow">
            <div className="composer__mirror" ref={mirrorRef} aria-hidden="true" />
            <textarea
              ref={textareaRef}
              className="composer__input"
              value={text}
              onChange={handleInput}
              onKeyDown={onKeyDown}
              placeholder={dynamicPlaceholder}
              rows={1}
              disabled={disabled}
            />
            {/* 斜杠命令菜单 */}
            <SlashMenu
              open={isMenuOpen}
              hit={hit}
              candidates={candidates}
              highlightIndex={highlightIndex}
              onSelect={selectCommand}
              onClose={closeMenu}
              onMove={moveHighlight}
              targetRef={textareaRef}
            />
          </div>
        </div>

        <div className="composer__row">
          <div className="composer__tools">
            {/* 预留：+ 按钮、权限选择器 */}
          </div>
          <div className="composer__trailing">
            {/* 模型选择器 - 发送按钮左侧 */}
            <ModelSelector
              currentModel={currentModel}
              onModelChange={onModelChange || (() => {})}
              disabled={disabled}
            />
            {/* AI 运行时：有内容显示发送+停止，无内容只显示停止 */}
            {running && onStop && (
              <button
                className="composer__stop"
                onClick={onStop}
                title="停止生成"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <rect x="3" y="3" width="10" height="10" rx="2" />
                </svg>
              </button>
            )}
            {/* 发送按钮：AI 运行时只在有内容时显示，AI 空闲时始终显示 */}
            {(!running || !isEmpty) && (
              <button
                className={`composer__send ${isEmpty ? 'composer__send--disabled' : ''} ${running ? 'composer__send--steer' : ''}`}
                onClick={submit}
                disabled={disabled || isEmpty}
                title={running ? '引导 AI (Enter)' : '发送 (Enter)'}
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
