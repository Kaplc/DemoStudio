import React from 'react'
import { useProjectStore } from '../stores/projectStore'
import { useEditorStore } from '../stores/editorStore'

export function ProjectPanel() {
  const { projects, loading } = useProjectStore()
  const { currentProject, setCurrentProject, addConsoleOutput } = useEditorStore()

  return (
    <div className="panel">
      <div className="panel-header">
        <span>Project</span>
      </div>
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
                style={{ border: '1px solid transparent', ...(currentProject?.name === p.name ? { borderColor: 'var(--accent)', background: 'var(--bg-active)' } : {}) }}
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
    </div>
  )
}
