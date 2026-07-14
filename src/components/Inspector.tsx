import React from 'react'
import { useEditorStore } from '../stores/editorStore'

export function Inspector() {
  const { currentProject, gameState } = useEditorStore()

  return (
    <div className="panel side-panel-right" style={{ borderRight: 'none', borderLeft: '1px solid var(--border)' }}>
      <div className="panel-header">
        <span>Inspector</span>
      </div>
      <div className="panel-body">
        {!currentProject ? (
          <div style={{ color: 'var(--text-dim)', fontSize: 12, textAlign: 'center', marginTop: 20 }}>
            请先选择一个工程
          </div>
        ) : (
          <>
            <div className="property-group">
              <div className="property-group-title">Project</div>
              <div className="property-row">
                <span className="property-label">Name</span>
                <span className="property-value">{currentProject.name}</span>
              </div>
              <div className="property-row">
                <span className="property-label">Version</span>
                <span className="property-value">{currentProject.version}</span>
              </div>
              <div className="property-row">
                <span className="property-label">Description</span>
                <span className="property-value" style={{ fontSize: 11 }}>{currentProject.description}</span>
              </div>
            </div>

            <div className="property-group">
              <div className="property-group-title">Game State</div>
              <div className="property-row">
                <span className="property-label">Status</span>
                <span className="property-value">
                  <span style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: gameState.running ? 'var(--success)' : 'var(--text-dim)',
                    marginRight: 6,
                  }} />
                  {gameState.running ? 'Running' : 'Stopped'}
                </span>
              </div>
              {gameState.running && (
                <>
                  <div className="property-row">
                    <span className="property-label">Score</span>
                    <span className="property-value">{gameState.score}</span>
                  </div>
                  <div className="property-row">
                    <span className="property-label">Game Over</span>
                    <span className="property-value">{gameState.gameOver ? 'Yes' : 'No'}</span>
                  </div>
                </>
              )}
            </div>

            <div className="property-group">
              <div className="property-group-title">Actions</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                <button
                  className="btn btn-primary"
                  onClick={() => {}}
                >
                  {gameState.running ? '■ Stop Game' : '▶ Launch Game'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
