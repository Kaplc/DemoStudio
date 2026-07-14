import React, { useRef, useEffect, useState } from 'react'
import { SceneManager } from '../engine'

export function Viewport() {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<SceneManager | null>(null)
  const [activeTab, setActiveTab] = useState<'scene' | 'game'>('scene')

  useEffect(() => {
    if (!containerRef.current) return

    const manager = new SceneManager(containerRef.current)
    sceneRef.current = manager
    manager.start()

    return () => {
      manager.dispose()
      sceneRef.current = null
    }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div className="viewport-tabs">
        <button
          className={`viewport-tab ${activeTab === 'scene' ? 'active' : ''}`}
          onClick={() => setActiveTab('scene')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          </svg>
          Scene
        </button>
        <button
          className={`viewport-tab ${activeTab === 'game' ? 'active' : ''}`}
          onClick={() => setActiveTab('game')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <path d="M6 12h4" /><path d="M8 10v4" />
          </svg>
          Game
        </button>
      </div>
      <div
        ref={containerRef}
        className="viewport-container"
        style={{ flex: 1 }}
      >
        <div className="viewport-overlay">
          {activeTab === 'scene' ? '场景视图 · 鼠标拖拽旋转 · 滚轮缩放' : '游戏视图'}
        </div>
      </div>
    </div>
  )
}
