import React, { useEffect } from 'react'
import { useEditorStore } from '../stores/editorStore'
import { useSaveStore } from '../stores/saveStore'

function formatSaveTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function Inspector() {
  const { currentProject, gameState, launchGame, stopGame } = useEditorStore()
  const slots = useSaveStore((s) => s.slots)
  const saveGame = useSaveStore((s) => s.saveGame)
  const loadGame = useSaveStore((s) => s.loadGame)
  const deleteSave = useSaveStore((s) => s.deleteSave)
  const refreshSlots = useSaveStore((s) => s.refreshSlots)

  // 项目切换或运行态变化时刷新存档槽列表
  useEffect(() => {
    if (currentProject) refreshSlots(currentProject.name)
  }, [currentProject, gameState.running, refreshSlots])

  return (
    <div className="panel">
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
                  onClick={() => gameState.running ? stopGame() : launchGame()}
                >
                  {gameState.running ? '■ Stop Game' : '▶ Launch Game'}
                </button>
              </div>
            </div>

            <div className="property-group">
              <div className="property-group-title">Save Game</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                <button
                  className="btn"
                  disabled={!gameState.running}
                  onClick={() => saveGame('quick')}
                >
                  💾 Quick Save (F6)
                </button>
                <button
                  className="btn"
                  disabled={slots.length === 0}
                  onClick={() => loadGame('quick')}
                >
                  📂 Quick Load (F9)
                </button>
              </div>
              {slots.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 11 }}>
                  <div style={{ color: 'var(--text-dim)', marginBottom: 4 }}>存档槽 ({slots.length})</div>
                  {slots.map((s) => (
                    <div key={s.slot} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                      <button
                        className="btn"
                        style={{ flex: 1, padding: '2px 6px', fontSize: 11, textAlign: 'left' }}
                        onClick={() => loadGame(s.slot)}
                        title={`恢复 ${s.slot}`}
                      >
                        {s.slot} · {formatSaveTime(s.meta.savedAt)} · {s.meta.score}分
                      </button>
                      <button
                        className="btn"
                        style={{ padding: '2px 6px', fontSize: 11, color: '#ff8888' }}
                        onClick={() => currentProject && deleteSave(currentProject.name, s.slot)}
                        title="删除"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
