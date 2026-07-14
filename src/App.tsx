import React, { useEffect, useState } from 'react'
import { MenuBar } from './components/MenuBar'
import { ProjectPanel } from './components/ProjectPanel'
import { Viewport } from './components/Viewport'
import { Inspector } from './components/Inspector'
import { Console } from './components/Console'
import { StatusBar } from './components/StatusBar'
import { ProjectSelector } from './components/ProjectSelector'
import { useEditorStore } from './stores/editorStore'
import { useProjectStore } from './stores/projectStore'

export default function App() {
  const { consoleVisible, addConsoleOutput } = useEditorStore()
  const { discoverProjects } = useProjectStore()
  const [appInfo, setAppInfo] = useState({ fps: 0, project: 'No project' })

  useEffect(() => {
    discoverProjects()
    addConsoleOutput('DemoStudio Editor v4.0.0 已启动')
    addConsoleOutput('基于 Three.js + Electron + React')
    addConsoleOutput('')

    // 监听 Electron 菜单事件
    if (window.electronAPI) {
      const cleanup = window.electronAPI.onMenuAction((action) => {
        addConsoleOutput(`[菜单] ${action}`)
      })
      return cleanup
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Simulate FPS counter
  useEffect(() => {
    let frame = 0
    let lastTime = performance.now()
    const id = setInterval(() => {
      const now = performance.now()
      const fps = Math.round((frame * 1000) / (now - lastTime))
      frame = 0
      lastTime = now
      setAppInfo((prev) => ({ ...prev, fps }))
    }, 1000)
    const countFrame = () => {
      frame++
      requestAnimationFrame(countFrame)
    }
    requestAnimationFrame(countFrame)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="editor-layout">
      <MenuBar />
      <div className="editor-main">
        <div className="side-panel-left">
          <ProjectPanel />
        </div>
        <div className="editor-content">
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <Viewport />
          </div>
          {consoleVisible && <Console />}
        </div>
        <div className="side-panel-right">
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
