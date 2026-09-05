import React, { useEffect, useState } from 'react'
import { Outline } from './Outline'
import { UiOutline } from './UiOutline'
import { AssetBrowser } from './AssetBrowser'
import { useEditorStore } from '../stores/editorStore'

type PanelTab = 'outline' | 'assets' | 'ui'

export function ProjectPanel() {
  // 左侧面板页签状态提升到 editorStore：资产双击打开时自动切到大纲
  const activeTab = useEditorStore((s) => s.leftPanelTab)
  const setActiveTab = useEditorStore((s) => s.setLeftPanelTab)
  // 顶部模糊搜索词按视口资产页签隔离：切到新页签为空（上一资产的过滤不带入），
  // 切回旧页签恢复该页签上次的输入（tabId 由 assetPath 确定性生成，关掉重开也能恢复）
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const projectName = useEditorStore((s) => s.currentProject?.name ?? null)
  const [queryMap, setQueryMap] = useState<Record<string, string>>({})
  // 换工程时整体清空：activeTabId 复位为 'scene' 等固定 id，不清会跨工程残留
  useEffect(() => {
    setQueryMap({})
  }, [projectName])
  const query = queryMap[activeTabId] ?? ''
  const setQuery = (q: string) => setQueryMap((m) => ({ ...m, [activeTabId]: q }))

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

      <div style={{ padding: '4px' }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '3px 6px',
            fontSize: 11,
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            borderRadius: 3,
            outline: 'none',
          }}
        />
      </div>

      {/* 三个页签内容常驻挂载，仅切 display 显隐：切换页签不丢展开层级/折叠/滚动状态 */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: activeTab === 'outline' ? 'flex' : 'none',
          flexDirection: 'column',
        }}
      >
        <Outline query={query} />
      </div>

      <div
        className="panel-body"
        style={{ padding: 0, display: activeTab === 'assets' ? 'block' : 'none' }}
      >
        <AssetBrowser query={query} />
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: activeTab === 'ui' ? 'flex' : 'none',
          flexDirection: 'column',
        }}
      >
        <UiOutline query={query} />
      </div>
    </div>
  )
}
