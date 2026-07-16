import React, { useEffect, useState } from 'react'
import { MenuBar } from './components/MenuBar'
import { ProjectPanel } from './components/ProjectPanel'
import { Viewport } from './components/Viewport'
import { Inspector } from './components/Inspector'
import { Console } from './components/Console'
import { StatusBar } from './components/StatusBar'
import { ProjectSelector } from './components/ProjectSelector'
import { NewProjectDialog } from './components/NewProjectDialog'
import { ResizeHandle } from './components/ResizeHandle'
import { KeyboardShortcuts } from './components/KeyboardShortcuts'
import { LoadingScreen } from './components/LoadingScreen'
import { useEditorStore } from './stores/editorStore'
import { useProjectStore } from './stores/projectStore'
import { WorldRegistry, GameFactoryRegistry, FileSceneAssetBuilder } from './engine'
import { SnakeGameInstance } from './projects/snake'
import { EatFishGameInstance, EatFishWorldBuilder } from './projects/eatfish'
import { Demo2DGameInstance } from './projects/demo2d'
import { RacingGameInstance, RacingWorldBuilder } from './projects/racing'
import { FishGameInstance } from './projects/fish'

export default function App() {
  const { consoleVisible, addConsoleOutput, toggleConsole, setShowProjectSelector, launchGame, stopGame, gameState } = useEditorStore()
  const { discoverProjects } = useProjectStore()
  const [appInfo, setAppInfo] = useState({ fps: 0, project: 'No project' })
  const [leftPanelWidth, setLeftPanelWidth] = useState(220)
  const [rightPanelWidth, setRightPanelWidth] = useState(280)
  const [consoleHeight, setConsoleHeight] = useState(180)
  const [loading, setLoading] = useState(true)

  // ─── Viewport 就绪后通知 Electron 关闭加载窗口 ───
  useEffect(() => {
    if (!loading && window.electronAPI?.sendAppReady) {
      window.electronAPI.sendAppReady()
    }
  }, [loading])

  useEffect(() => {
    discoverProjects()
    addConsoleOutput('DemoStudio Editor v4.0.0 已启动')

    // 注册 Snake 世界构建器（场景内容从文件路径加载，支持热更新）
    WorldRegistry.register('Snake', new FileSceneAssetBuilder('src/projects/snake/snake.scene.json'))
    addConsoleOutput('[World] Snake 世界构建器已注册')

    // 注册 Snake 游戏实例工厂
    GameFactoryRegistry.register('Snake', (scene) => new SnakeGameInstance(scene))
    addConsoleOutput('[Game] Snake 游戏工厂已注册')

    // 注册 EatFish 世界构建器（水下场景）
    WorldRegistry.register('EatFish', new EatFishWorldBuilder())
    addConsoleOutput('[World] EatFish 世界构建器已注册')

    // 注册 EatFish 游戏实例工厂
    GameFactoryRegistry.register('EatFish', (scene) => new EatFishGameInstance(scene))
    addConsoleOutput('[Game] EatFish 游戏工厂已注册')

    // 注册 Demo2D 世界构建器（2D 场景，声明式 JSON 资产，支持热更新）
    WorldRegistry.register('Demo2D', new FileSceneAssetBuilder('src/projects/demo2d/demo2d.scene.json'))
    addConsoleOutput('[World] Demo2D 世界构建器已注册')

    // 注册 Demo2D 游戏实例工厂（2D 正交相机 + Sprite）
    GameFactoryRegistry.register('Demo2D', (scene) => new Demo2DGameInstance(scene))
    addConsoleOutput('[Game] Demo2D 游戏工厂已注册')

    // 注册 Racing 世界构建器（赛道场景）
    WorldRegistry.register('Racing', new RacingWorldBuilder())
    addConsoleOutput('[World] Racing 世界构建器已注册')

    // 注册 Racing 游戏实例工厂
    GameFactoryRegistry.register('Racing', (scene) => new RacingGameInstance(scene))
    addConsoleOutput('[Game] Racing 游戏工厂已注册')

    // 注册 FishMaster 世界构建器（捕鱼达人，2D 正交 + 鼠标瞄准）
    WorldRegistry.register('FishMaster', new FileSceneAssetBuilder('src/projects/fish/fish.scene.json'))
    addConsoleOutput('[World] FishMaster 世界构建器已注册')

    // 注册 FishMaster 游戏实例工厂
    GameFactoryRegistry.register('FishMaster', (scene) => new FishGameInstance(scene))
    addConsoleOutput('[Game] FishMaster 游戏工厂已注册')

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
              // 选中当前工程（加载竞技场），再启动游戏
              const projects = useEditorStore.getState().projects
              const current = useEditorStore.getState().currentProject
              if (!current && projects.length > 0) {
                useEditorStore.getState().setCurrentProject(projects[0])
              }
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
        project: gameState.running ? (useEditorStore.getState().currentProject?.name ?? 'Game') : 'No project',
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
      <LoadingScreen loading={loading} />
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
            <Viewport onReady={() => setLoading(false)} />
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
      <NewProjectDialog />
    </div>
  )
}
