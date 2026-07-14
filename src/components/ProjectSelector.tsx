import React from 'react'
import { useEditorStore } from '../stores/editorStore'
import { useProjectStore } from '../stores/projectStore'

export function ProjectSelector() {
  const { showProjectSelector, setShowProjectSelector, setCurrentProject, addConsoleOutput } = useEditorStore()
  const { projects } = useProjectStore()
  const [selected, setSelected] = React.useState<string | null>(null)

  if (!showProjectSelector) return null

  const handleOpen = () => {
    const project = projects.find((p) => p.name === selected)
    if (project) {
      setCurrentProject(project)
      addConsoleOutput(`打开工程: ${project.name}`)
    }
    setShowProjectSelector(false)
  }

  return (
    <div className="modal-overlay" onClick={() => setShowProjectSelector(false)}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">选择工程</div>
        <div className="project-list">
          {projects.map((p) => (
            <div
              key={p.name}
              className={`project-card ${selected === p.name ? 'selected' : ''}`}
              onClick={() => setSelected(p.name)}
            >
              <div className="project-name">{p.name}</div>
              <div className="project-desc">{p.description}</div>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={() => setShowProjectSelector(false)}>
            取消
          </button>
          <button className="btn btn-primary" onClick={handleOpen} disabled={!selected}>
            打开
          </button>
        </div>
      </div>
    </div>
  )
}
