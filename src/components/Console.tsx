import React, { useRef, useEffect } from 'react'
import { useEditorStore } from '../stores/editorStore'
import { logger } from '../engine'

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

    const parts = cmd.split(/\s+/)
    const command = parts[0].toLowerCase()
    const args = parts.slice(1)

    switch (command) {
      case 'help':
        addConsoleOutput('可用命令:')
        addConsoleOutput('  help           - 显示此帮助')
        addConsoleOutput('  clear          - 清空控制台')
        addConsoleOutput('  echo <text>    - 输出文字')
        addConsoleOutput('  status         - 显示编辑器状态')
        addConsoleOutput('  start_game     - 启动贪吃蛇游戏')
        addConsoleOutput('  stop_game      - 停止贪吃蛇游戏')
        addConsoleOutput('  toggle_game    - 切换游戏运行状态')
        addConsoleOutput('')
        addConsoleOutput(`当前游戏状态: ${gameState.running ? '🎮 运行中' : '⏹ 已停止'}`)
        addConsoleOutput(`  Ctrl+Enter - 启动/停止 | Shift+F5 - 停止`)
        break
      case 'clear':
        clearConsole()
        break
      case 'echo':
        addConsoleOutput(args.join(' '))
        break
      case 'status':
        addConsoleOutput('DemoStudio Editor v4.0.0')
        addConsoleOutput('Engine: Three.js + Electron + React')
        addConsoleOutput(`游戏状态: ${gameState.running ? '🎮 运行中 (分数: ' + gameState.score + ')' : '⏹ 已停止'}`)
        break
      case 'start_game':
        if (gameState.running) {
          addConsoleOutput('⚠ 游戏已在运行中')
        } else {
          launchGame()
        }
        break
      case 'stop_game':
        if (!gameState.running) {
          addConsoleOutput('⚠ 游戏未在运行')
        } else {
          stopGame()
        }
        break
      case 'toggle_game':
        if (gameState.running) {
          stopGame()
        } else {
          launchGame()
        }
        break
      default:
        addConsoleOutput(`未知命令: ${command}。输入 help 查看可用命令。`)
    }
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
