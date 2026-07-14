import React, { useEffect, useState } from 'react'
import { MenuBar } from './components/MenuBar'
import { ProjectPanel } from './components/ProjectPanel'
import { Viewport } from './components/Viewport'
import { Inspector } from './components/Inspector'
import { Console } from './components/Console'
import { StatusBar } from './components/StatusBar'
import { ProjectSelector } from './components/ProjectSelector'
import { ResizeHandle } from './components/ResizeHandle'
import { KeyboardShortcuts } from './components/KeyboardShortcuts'
import { useEditorStore } from './stores/editorStore'
import { useProjectStore } from './stores/projectStore'

export default function App() {
  const { consoleVisible, addConsoleOutput, toggleConsole, setShowProjectSelector, launchGame, stopGame, gameState } = useEditorStore()
  const { discoverProjects } = useProjectStore()
  const [appInfo, setAppInfo] = useState({ fps: 0, project: 'No project' })
  const [leftPanelWidth, setLeftPanelWidth] = useState(220)
  const [rightPanelWidth, setRightPanelWidth] = useState(280)
  const [consoleHeight, setConsoleHeight] = useState(180)

  useEffect(() => {
    discoverProjects()
    addConsoleOutput('DemoStudio Editor v4.0.0 已启动')
    addConsoleOutput('基于 Three.js + Electron + React')
    addConsoleOutput('')

    // 监听快捷键
    const onToggleConsole = () => toggleConsole()
    const onOpenProject = () => setShowProjectSelector(true)
    const onNewProject = () => addConsoleOutput('[菜单] New Project')
    const onSave = () => addConsoleOutput('[菜单] Save')
    const onSaveAs = () => addConsoleOutput('[菜单] Save As...')
    const onLaunchGame = () => {
      if (gameState.gameOver || !gameState.running) {
        launchGame()
      } else {
        stopGame()
      }
    }
    const onStopGame = () => stopGame()

    window.addEventListener('shortcut-toggle-console', onToggleConsole)
    window.addEventListener('shortcut-open-project', onOpenProject)
    window.addEventListener('shortcut-new-project', onNewProject)
    window.addEventListener('shortcut-save', onSave)
    window.addEventListener('shortcut-save-as', onSaveAs)
    window.addEventListener('shortcut-launch-game', onLaunchGame)
    window.addEventListener('shortcut-stop-game', onStopGame)

    // 监听 Electron 菜单事件
    if (window.electronAPI) {
      const cleanup = window.electronAPI.onMenuAction((action) => {
        switch (action) {
          case 'launch-game': onLaunchGame(); break
          case 'stop-game': onStopGame(); break
          default: addConsoleOutput(`[菜单] ${action}`)
        }
      })
      // 监听 MCP 命令
      let mcpCleanup: (() => void) | undefined
      if (window.electronAPI.onMCPCommand) {
        mcpCleanup = window.electronAPI.onMCPCommand((command, params) => {
          addConsoleOutput(`[MCP] 收到命令: ${command}`)
          switch (command) {
            case 'launchGame':
            case 'start_game':
              // 先选中 Snake 工程（加载竞技场），再启动游戏
              const project = useEditorStore.getState().projects.find(p => p.name === 'Snake')
              if (project) useEditorStore.getState().setCurrentProject(project)
              onLaunchGame()
              break
            case 'stopGame':
            case 'stop_game':
              onStopGame()
              break
            case 'toggle_game':
              onLaunchGame()
              break
            case 'addConsoleOutput':
              if (params?.text) addConsoleOutput(params.text)
              break
            case 'send_input':
              if (params?.key) {
                // 派发键盘事件到 window
                window.dispatchEvent(new KeyboardEvent('keydown', { key: params.key, bubbles: true }))
                addConsoleOutput(`[MCP] 发送按键: ${params.key}`)
              }
              break
            default:
              addConsoleOutput(`[MCP] 未知命令: ${command}`)
          }
        })
      }
      return () => {
        cleanup()
        mcpCleanup?.()
        window.removeEventListener('shortcut-toggle-console', onToggleConsole)
        window.removeEventListener('shortcut-open-project', onOpenProject)
        window.removeEventListener('shortcut-new-project', onNewProject)
        window.removeEventListener('shortcut-save', onSave)
        window.removeEventListener('shortcut-save-as', onSaveAs)
        window.removeEventListener('shortcut-launch-game', onLaunchGame)
        window.removeEventListener('shortcut-stop-game', onStopGame)
      }
    }

    return () => {
      window.removeEventListener('shortcut-toggle-console', onToggleConsole)
      window.removeEventListener('shortcut-open-project', onOpenProject)
      window.removeEventListener('shortcut-new-project', onNewProject)
      window.removeEventListener('shortcut-save', onSave)
      window.removeEventListener('shortcut-save-as', onSaveAs)
      window.removeEventListener('shortcut-launch-game', onLaunchGame)
      window.removeEventListener('shortcut-stop-game', onStopGame)
    }
  }, [gameState.running]) // eslint-disable-line react-hooks/exhaustive-deps

  // 实时状态更新 + 上报给 Electron main
  useEffect(() => {
    let frame = 0
    let lastTime = performance.now()
    // 上报游戏状态
    if (window.electronAPI?.reportGameState) {
      window.electronAPI.reportGameState({
        running: gameState.running,
        score: gameState.score,
      })
    }
    const id = setInterval(() => {
      const now = performance.now()
      const fps = Math.round((frame * 1000) / (now - lastTime))
      frame = 0
      lastTime = now
      setAppInfo((prev) => ({
        ...prev,
        fps,
        project: gameState.running ? `Snake (Score: ${gameState.score})` : 'No project',
      }))
    }, 1000)
    const countFrame = () => {
      frame++
      requestAnimationFrame(countFrame)
    }
    requestAnimationFrame(countFrame)
    return () => clearInterval(id)
  }, [gameState.score, gameState.running])

  return (
    <div className="editor-layout">
      <KeyboardShortcuts />
      <MenuBar />
      <div className="editor-main">
        <div style={{ width: leftPanelWidth, flexShrink: 0, position: 'relative' }} className="side-panel-left">
          <ProjectPanel />
          <ResizeHandle direction="horizontal" onResize={(delta) => {
            setLeftPanelWidth(w => Math.max(150, Math.min(500, w + delta)))
          }} />
        </div>
        <div className="editor-content">
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <Viewport />
          </div>
          {consoleVisible && (
            <div style={{ height: consoleHeight, flexShrink: 0, position: 'relative' }}>
              <ResizeHandle direction="vertical" position="top" onResize={(delta) => {
                setConsoleHeight(h => Math.max(60, Math.min(600, h - delta)))
              }} />
              <Console />
            </div>
          )}
        </div>
        <div style={{ width: rightPanelWidth, flexShrink: 0, position: 'relative' }} className="side-panel-right">
          <ResizeHandle direction="horizontal" position="left" onResize={(delta) => {
            setRightPanelWidth(w => Math.max(200, Math.min(500, w - delta)))
          }} />
          <Inspector />
        </div>
      </div>
      <StatusBar
        fps={appInfo.fps}
        projectName={appInfo.project}
      />
      <ProjectSelector />
    </div>
  )
}
