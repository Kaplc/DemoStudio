import React, { useState, useEffect, useRef } from 'react'
import { useProjectStore } from '../stores/projectStore'
import { useEditorStore } from '../stores/editorStore'
import { LogPoller } from '../editor'
import { Outline } from './Outline'

type PanelTab = 'project' | 'outline' | 'logs'

export function ProjectPanel() {
  const { projects, loading } = useProjectStore()
  const { currentProject, setCurrentProject, addConsoleOutput } = useEditorStore()

  const [activeTab, setActiveTab] = useState<PanelTab>('project')
  const [logContent, setLogContent] = useState('')
  const [logError, setLogError] = useState<string | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)
  const pollerRef = useRef<LogPoller | null>(null)

  // ─── 日志轮询 ───
  useEffect(() => {
    if (activeTab !== 'logs') {
      pollerRef.current?.stop()
      return
    }

    const poller = new LogPoller()
    pollerRef.current = poller
    poller.start((content, error) => {
      setLogContent(content)
      setLogError(error)
    })

    return () => {
      poller.stop()
      pollerRef.current = null
    }
  }, [activeTab])

  // ─── 自动滚动到底部 ───
  useEffect(() => {
    if (activeTab === 'logs') {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logContent, activeTab])

  return (
    <div className="panel">
      <div className="panel-header" style={{ display: 'flex', gap: 2, padding: '0 4px' }}>
        <button
          className={`viewport-tab${activeTab === 'project' ? ' active' : ''}`}
          onClick={() => setActiveTab('project')}
          style={{ flex: 1, fontSize: 10, justifyContent: 'center' }}
        >
          项目
        </button>
        <button
          className={`viewport-tab${activeTab === 'outline' ? ' active' : ''}`}
          onClick={() => setActiveTab('outline')}
          style={{ flex: 1, fontSize: 10, justifyContent: 'center' }}
        >
          大纲
        </button>
        <button
          className={`viewport-tab${activeTab === 'logs' ? ' active' : ''}`}
          onClick={() => setActiveTab('logs')}
          style={{ flex: 1, fontSize: 10, justifyContent: 'center' }}
        >
          日志
        </button>
      </div>

      {activeTab === 'outline' && (
        <Outline />
      )}

      {activeTab === 'project' && (
        <div className="panel-body">
          {loading ? (
            <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>扫描中...</div>
          ) : projects.length === 0 ? (
            <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>暂无工程</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {projects.map((p) => (
                <div
                  key={p.name}
                  className={`project-card ${currentProject?.name === p.name ? 'selected' : ''}`}
                  onClick={() => {
                    setCurrentProject(p)
                    addConsoleOutput(`切换到工程: ${p.name}`)
                  }}
                  style={{ borderWidth: 1, borderStyle: 'solid', borderColor: currentProject?.name === p.name ? 'var(--accent)' : 'transparent', ...(currentProject?.name === p.name ? { background: 'var(--bg-active)' } : {}) }}
                >
                  <div className="project-name">{p.name}</div>
                  <div className="project-desc">{p.description}</div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                    {p.tags.map((tag) => (
                      <span
                        key={tag}
                        style={{
                          fontSize: 10,
                          padding: '1px 6px',
                          borderRadius: 3,
                          background: 'var(--bg-tertiary)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'logs' && (
        <div className="panel-body" style={{ padding: 0, fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.5 }}>
          {logError ? (
            <div style={{ padding: 8, color: 'var(--error)' }}>{logError}</div>
          ) : (
            <pre style={{ margin: 0, padding: '4px 8px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--text-primary)' }}>
              {logContent || '等待日志...'}
              <div ref={logEndRef} />
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
