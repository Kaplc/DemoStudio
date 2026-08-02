import React, { useState, useEffect, useRef } from 'react'
import { LogPoller } from '../editor'
import { Outline } from './Outline'
import { AssetBrowser } from './AssetBrowser'
import { useEditorStore } from '../stores/editorStore'

type PanelTab = 'outline' | 'assets' | 'logs'

export function ProjectPanel() {
  // 左侧面板页签状态提升到 editorStore：资产双击打开时自动切到大纲
  const activeTab = useEditorStore((s) => s.leftPanelTab)
  const setActiveTab = useEditorStore((s) => s.setLeftPanelTab)
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
          className={`viewport-tab${activeTab === 'outline' ? ' active' : ''}`}
          onClick={() => setActiveTab('outline')}
          style={{ flex: 1, fontSize: 10, justifyContent: 'center' }}
        >
          大纲
        </button>
        <button
          className={`viewport-tab${activeTab === 'assets' ? ' active' : ''}`}
          onClick={() => setActiveTab('assets')}
          style={{ flex: 1, fontSize: 10, justifyContent: 'center' }}
        >
          资产
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

      {activeTab === 'assets' && (
        <div className="panel-body" style={{ padding: 0 }}>
          <AssetBrowser />
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
