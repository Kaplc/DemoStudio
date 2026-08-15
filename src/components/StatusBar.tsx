import React from 'react'
import { useEditorStore } from '../stores/editorStore'

interface StatusBarProps {
  fps: number
  projectName: string
}

export function StatusBar({ fps, projectName }: StatusBarProps) {
  const { gameState } = useEditorStore()

  return (
    <div className="status-bar">
      <div className="status-left">
        <span>{projectName}</span>
        <span>|</span>
        <span>
          <span className={`status-dot ${gameState.running ? 'running' : 'stopped'}`} style={{ marginRight: 4 }} />
          {gameState.running ? 'Running' : 'Stopped'}
        </span>
      </div>
      <div className="status-right">
        <span>FPS: {fps}</span>
      </div>
    </div>
  )
}
