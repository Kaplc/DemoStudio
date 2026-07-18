import React, { useEffect, useState, useRef } from 'react'
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
import { useEditorPrefsStore } from './stores/editorPrefsStore'
import { Editor } from './editor'

export default function App() {
  const { addConsoleOutput, setShowProjectSelector, launchGame, stopGame, gameState } = useEditorStore()
  const consoleVisible = useEditorPrefsStore((s) => s.consoleVisible)
  const layout = useEditorPrefsStore((s) => s.layout)
  const setLayout = useEditorPrefsStore((s) => s.setLayout)
  const [appInfo, setAppInfo] = useState({ fps: 0, project: 'No project' })
  const [loading, setLoading] = useState(true)
  const editorRef = useRef<Editor | null>(null)

  // ─── 编辑器初始化（仅执行一次） ───
  useEffect(() => {
    const editor = new Editor()
    editorRef.current = editor

    editor.init({
      addConsoleOutput,
      setShowProjectSelector,
      launchGame: () => {
        const state = useEditorStore.getState()
        if (state.gameState.gameOver || !state.gameState.running) {
          state.launchGame()
        } else {
          state.stopGame()
        }
      },
      stopGame: () => useEditorStore.getState().stopGame(),
      setAppInfo,
      setLoading,
    })

    return () => {
      editor.destroy()
      editorRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Viewport 就绪后通知 Electron 关闭加载窗口 ───
  useEffect(() => {
    if (!loading && window.electronAPI?.sendAppReady) {
      window.electronAPI.sendAppReady()
    }
  }, [loading])

  return (
    <div className="editor-layout">
      <LoadingScreen loading={loading} />
      <KeyboardShortcuts />
      <MenuBar />
      <div className="editor-main">
        <div style={{ width: layout.left, flexShrink: 0, position: 'relative' }} className="side-panel-left">
          <ProjectPanel />
          <ResizeHandle direction="horizontal" onResize={(delta) => {
            const cur = useEditorPrefsStore.getState().layout.left
            setLayout('left', Math.max(150, Math.min(500, cur + delta)))
          }} />
        </div>
        <div className="editor-content">
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <Viewport onReady={() => setLoading(false)} />
          </div>
          {consoleVisible && (
            <div style={{ height: layout.console, flexShrink: 0, position: 'relative' }}>
              <ResizeHandle direction="vertical" position="top" onResize={(delta) => {
                const cur = useEditorPrefsStore.getState().layout.console
                setLayout('console', Math.max(60, Math.min(600, cur - delta)))
              }} />
              <Console />
            </div>
          )}
        </div>
        <div style={{ width: layout.right, flexShrink: 0, position: 'relative' }} className="side-panel-right">
          <ResizeHandle direction="horizontal" position="left" onResize={(delta) => {
            const cur = useEditorPrefsStore.getState().layout.right
            setLayout('right', Math.max(200, Math.min(500, cur - delta)))
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
