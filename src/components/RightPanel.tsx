/**
 * RightPanel - 右侧面板容器
 * 
 * 提供 Inspector/Agent 标签切换
 */
import React from 'react'
import { useEditorStore } from '../stores/editorStore'
import { Inspector } from './Inspector'
import { AgentPanel } from './AgentPanel'

export const RightPanel: React.FC = () => {
  const rightPanelTab = useEditorStore((s) => s.rightPanelTab)
  const setRightPanelTab = useEditorStore((s) => s.setRightPanelTab)

  return (
    <div className="right-panel">
      <div className="right-panel__tabs">
        <button
          className={`right-panel__tab ${rightPanelTab === 'inspector' ? 'active' : ''}`}
          onClick={() => setRightPanelTab('inspector')}
        >
          Inspector
        </button>
        <button
          className={`right-panel__tab ${rightPanelTab === 'agent' ? 'active' : ''}`}
          onClick={() => setRightPanelTab('agent')}
        >
          Agent
        </button>
      </div>
      <div className="right-panel__content">
        {rightPanelTab === 'inspector' ? <Inspector /> : <AgentPanel />}
      </div>
    </div>
  )
}
