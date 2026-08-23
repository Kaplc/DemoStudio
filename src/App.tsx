import React, { useEffect, useState, useRef, useCallback } from 'react'
import { MenuBar } from './components/MenuBar'
import { ProjectPanel } from './components/ProjectPanel'
import { Viewport } from './components/Viewport'
import { Inspector } from './components/Inspector'
import { RightPanel } from './components/RightPanel'
import { Console } from './components/Console'
import { StatusBar } from './components/StatusBar'
import { ProjectSelector } from './components/ProjectSelector'
import { NewProjectDialog } from './components/NewProjectDialog'
import { ResizeHandle } from './components/ResizeHandle'
import { KeyboardShortcuts } from './components/KeyboardShortcuts'
import { LoadingScreen } from './components/LoadingScreen'
import { CodeLintPanel } from './components/CodeLintPanel'
import { ErrorStatusPanel } from './components/ErrorStatusPanel'
import { useEditorStore } from './stores/editorStore'
import { useEditorPrefsStore } from './stores/editorPrefsStore'
import { useProjectStore } from './stores/projectStore'
import { Editor } from './editor'

/**
 * 启动阶段：loading → selecting-project → editor
 */
type StartupPhase = 'loading' | 'selecting-project' | 'editor'

export default function App() {
  const { addConsoleOutput, setShowProjectSelector, setCurrentProject, launchGame, stopGame, gameState } = useEditorStore()
  const consoleVisible = useEditorPrefsStore((s) => s.consoleVisible)
  const layout = useEditorPrefsStore((s) => s.layout)
  const setLayout = useEditorPrefsStore((s) => s.setLayout)
  const projects = useProjectStore((s) => s.projects)
  const currentProject = useEditorStore((s) => s.currentProject)
  const [appInfo, setAppInfo] = useState({ renderFps: 0, logicFps: 0, project: 'No project' })
  const [loading, setLoading] = useState(true)
  const [phase, setPhase] = useState<StartupPhase>('loading')
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

  // ─── 加载完成 → 进入工程选择阶段 ───
  useEffect(() => {
    if (!loading && phase === 'loading') {
      setPhase('selecting-project')
    }
  }, [loading, phase])

  // ─── 选中工程 → 进入编辑器阶段 ───
  useEffect(() => {
    if (phase === 'selecting-project' && currentProject) {
      setPhase('editor')
    }
  }, [phase, currentProject])

  // ─── HMR 热重载回退：React 状态保留但 store 工程被重置 → 回到工程选择 ───
  useEffect(() => {
    if (phase === 'editor' && !currentProject) {
      setPhase('selecting-project')
    }
  }, [phase, currentProject])

  // ─── Viewport 就绪后通知 Electron 关闭加载窗口 ───
  useEffect(() => {
    if (!loading && window.electronAPI?.sendAppReady) {
      window.electronAPI.sendAppReady()
    }
  }, [loading])

  // ─── 打开工程（全屏选择器中的"打开"按钮） ───
  const handleStartupSelectProject = useCallback((project: typeof projects[number]) => {
    setCurrentProject(project)
    addConsoleOutput(`打开工程: ${project.name}`)
  }, [setCurrentProject, addConsoleOutput])

  return (
    <div className="editor-layout">
      <LoadingScreen loading={loading} />

      {/* 启动阶段的全屏工程选择器 */}
      {phase === 'selecting-project' && (
        <StartupProjectSelector
          projects={projects}
          onSelect={handleStartupSelectProject}
        />
      )}

      {/* 编辑器界面（选择工程前就已初始化，但被全屏选择器遮挡） */}
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
          <RightPanel />
        </div>
      </div>
      <StatusBar
        renderFps={appInfo.renderFps}
        logicFps={appInfo.logicFps}
        projectName={appInfo.project}
      />
      {/* codeLint tips 悬浮面板（fixed 定位，状态栏上方，不占布局） */}
      <CodeLintPanel />
      {/* 控制台报错悬浮面板（状态栏报错徽标控制，fixed 定位不占布局） */}
      <ErrorStatusPanel />
      <ProjectSelector />
      <NewProjectDialog />
    </div>
  )
}

// ─── 全屏启动工程选择器 ───
function StartupProjectSelector({
  projects,
  onSelect,
}: {
  projects: { name: string; description: string; version?: string; tags?: string[]; folder?: string }[]
  onSelect: (project: any) => void
}) {
  const setShowNewProjectDialog = useEditorStore((s) => s.setShowNewProjectDialog)
  const [selected, setSelected] = React.useState<string | null>(() => {
    const lastFolder = useEditorPrefsStore.getState().lastProjectFolder
    if (lastFolder) {
      return projects.find(p => p.folder === lastFolder)?.name ?? null
    }
    return null
  })

  return (
    <div className="startup-overlay">
      <div className="startup-container">
        <div className="startup-header">
          <div className="startup-title">DemoStudio</div>
          <div className="startup-subtitle">选择一个工程开始编辑</div>
        </div>
        <div className="startup-project-list">
          {projects.map((p) => (
            <div
              key={p.name}
              className={`startup-project-card ${selected === p.name ? 'selected' : ''}`}
              role="button"
              aria-label={p.name}
              onClick={() => setSelected(p.name)}
              onDoubleClick={() => selected === p.name && onSelect(p)}
            >
              <div className="startup-project-info">
                <div className="startup-project-name">{p.name}</div>
                <div className="startup-project-desc">{p.description}</div>
              </div>
              {selected === p.name && <div className="startup-checkmark">✓</div>}
            </div>
          ))}
        </div>
        <div className="startup-actions" style={{ gap: 12 }}>
          <button
            className="btn btn-primary startup-btn"
            disabled={!selected}
            onClick={() => {
              const project = projects.find(p => p.name === selected)
              if (project) onSelect(project)
            }}
          >
            打开工程
          </button>
          <button
            className="btn startup-btn startup-btn-new"
            onClick={() => setShowNewProjectDialog(true)}
          >
            + 新建工程
          </button>
        </div>
        <div className="startup-footer">
          提示: 你也可以通过菜单随时切换工程
        </div>
      </div>
    </div>
  )
}
