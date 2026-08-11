import React from 'react'
import { Outline } from './Outline'
import { UiOutline } from './UiOutline'
import { AssetBrowser } from './AssetBrowser'
import { useEditorStore } from '../stores/editorStore'

type PanelTab = 'outline' | 'assets' | 'ui'

export function ProjectPanel() {
  // 左侧面板页签状态提升到 editorStore：资产双击打开时自动切到大纲
  const activeTab = useEditorStore((s) => s.leftPanelTab)
  const setActiveTab = useEditorStore((s) => s.setLeftPanelTab)

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
          className={`viewport-tab${activeTab === 'ui' ? ' active' : ''}`}
          onClick={() => setActiveTab('ui')}
          style={{ flex: 1, fontSize: 10, justifyContent: 'center' }}
        >
          UI 大纲
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

      {activeTab === 'ui' && (
        <UiOutline />
      )}
    </div>
  )
}
