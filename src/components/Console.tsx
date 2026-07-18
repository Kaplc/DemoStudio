import React, { useRef, useEffect } from 'react'
import { useEditorStore } from '../stores/editorStore'
import { logger } from '../engine'
import { executeCommand } from '../editor'

export function Console() {
  const { consoleOutput, addConsoleOutput, clearConsole, gameState, launchGame, stopGame } = useEditorStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const outputRef = useRef<HTMLDivElement>(null)

  // 将 Logger 输出连接到 Console 面板
  useEffect(() => {
    logger.setOutputCallback(addConsoleOutput)
  }, [addConsoleOutput])

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [consoleOutput])

  useEffect(() => {
    // Focus input when console becomes visible
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [])

  const handleCommand = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    const cmd = e.currentTarget.value.trim()
    e.currentTarget.value = ''

    if (!cmd) return

    addConsoleOutput(`> ${cmd}`)
    executeCommand(cmd, {
      output: addConsoleOutput,
      clear: clearConsole,
      gameState,
      launchGame,
      stopGame,
    })
  }

  return (
    <div className="bottom-panel">
      <div className="panel-header">
        <span>Console</span>
        <div className="panel-header-actions">
          <button
            className="menu-item"
            onClick={clearConsole}
            style={{ height: 22, padding: '0 8px', fontSize: 11 }}
          >
            清空
          </button>
        </div>
      </div>
      <div className="console-output" ref={outputRef}>
        {consoleOutput.map((line, i) => {
          let cls = 'console-line'
          if (line.startsWith('>')) cls += ' info'
          else if (line.startsWith('错误') || line.startsWith('Error')) cls += ' error'
          else if (line.startsWith('警告') || line.startsWith('Warn')) cls += ' warning'
          else if (line.startsWith('✓') || line.startsWith('成功')) cls += ' success'
          else cls += ' dim'

          return (
            <div key={i} className={cls}>
              {line}
            </div>
          )
        })}
      </div>
      <div className="console-input-row">
        <span className="console-prompt">❯</span>
        <input
          ref={inputRef}
          className="console-input"
          placeholder="输入命令..."
          onKeyDown={handleCommand}
          spellCheck={false}
          autoComplete="off"
        />
      </div>
    </div>
  )
}
