/**
 * PluginControlCenter - 插件控制中心
 * 
 * 显示当前所有可用插件，支持启用/禁用、查看详情
 */
import React, { useState, useEffect, useCallback } from 'react'
import { pluginService } from '../editor/PluginService'
import type { PluginInfo, PluginStatus, PluginType } from '../types/plugin'

/** 状态图标映射（不再使用 emoji，改为 CSS 状态点） */
const STATUS_CLASS: Record<PluginStatus, string> = {
  active: 'active',
  inactive: 'inactive',
  error: 'error',
  loading: 'loading',
}

interface PluginCardProps {
  plugin: PluginInfo
  onToggle: (id: string) => void
}

/** 单个插件卡片 */
const PluginCard: React.FC<PluginCardProps> = ({ plugin, onToggle }) => {
  const { metadata, state } = plugin
  const isActive = state.status === 'active'

  return (
    <div className={`plugin-card ${isActive ? 'active' : 'inactive'}`}>
      <div className="plugin-card__header">
        <div className="plugin-card__info">
          <div className="plugin-card__name">{metadata.name}</div>
          <div className="plugin-card__id">{metadata.id}</div>
        </div>
        <span className={`plugin-card__status plugin-card__status--${STATUS_CLASS[state.status]}`}></span>
      </div>
      
      <div className="plugin-card__desc">{metadata.description}</div>

      {metadata.capabilities && metadata.capabilities.length > 0 && (
        <div className="plugin-card__capabilities">
          {metadata.capabilities.slice(0, 3).map((cap, i) => (
            <span key={i} className="plugin-card__cap-tag">{cap}</span>
          ))}
          {metadata.capabilities.length > 3 && (
            <span className="plugin-card__cap-more">+{metadata.capabilities.length - 3}</span>
          )}
        </div>
      )}

      <div className="plugin-card__actions">
        <button
          className={`btn btn-sm ${isActive ? 'btn-danger' : 'btn-primary'}`}
          onClick={() => onToggle(metadata.id)}
        >
          {isActive ? '停用' : '启用'}
        </button>
      </div>

      {state.lastError && (
        <div className="plugin-card__error">
          ⚠️ {state.lastError}
        </div>
      )}
    </div>
  )
}

interface PluginControlCenterProps {
  onClose?: () => void
}

export const PluginControlCenter: React.FC<PluginControlCenterProps> = ({ onClose }) => {
  const [plugins, setPlugins] = useState<PluginInfo[]>(pluginService.getPlugins())
  const [filter, setFilter] = useState<'all' | PluginType>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    // 订阅插件状态变化
    const unsub = pluginService.onPluginsChange(setPlugins)
    
    // 初始同步 DSH 状态
    pluginService.syncFromDSH()
    
    return unsub
  }, [])

  const handleToggle = useCallback((id: string) => {
    pluginService.togglePlugin(id)
  }, [])

  // 过滤插件
  const filteredPlugins = plugins.filter(p => {
    if (filter !== 'all' && p.metadata.type !== filter) return false
    if (search) {
      const s = search.toLowerCase()
      return (
        p.metadata.name.toLowerCase().includes(s) ||
        p.metadata.id.toLowerCase().includes(s) ||
        p.metadata.description.toLowerCase().includes(s)
      )
    }
    return true
  })

  const stats = pluginService.getStats()

  return (
    <div className="plugin-control-center">
      <div className="plugin-control-center__header">
        <h2>🔌 插件控制中心</h2>
        {onClose && (
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        )}
      </div>

      {/* 统计栏 */}
      <div className="plugin-control-center__stats">
        <span className="stat-item">
          <span className="stat-label">总计</span>
          <span className="stat-value">{stats.total}</span>
        </span>
        <span className="stat-item stat-active">
          <span className="stat-label">启用</span>
          <span className="stat-value">{stats.active}</span>
        </span>
        <span className="stat-item stat-inactive">
          <span className="stat-label">停用</span>
          <span className="stat-value">{stats.inactive}</span>
        </span>
        {stats.error > 0 && (
          <span className="stat-item stat-error">
            <span className="stat-label">错误</span>
            <span className="stat-value">{stats.error}</span>
          </span>
        )}
      </div>

      {/* 搜索和过滤 */}
      <div className="plugin-control-center__filters">
        <input
          type="text"
          className="plugin-search"
          placeholder="搜索插件..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="filter-tabs">
          {(['all', 'tool', 'service', 'ui', 'integration'] as const).map((t) => (
            <button
              key={t}
              className={`filter-tab ${filter === t ? 'active' : ''}`}
              onClick={() => setFilter(t)}
            >
              {t === 'all' ? '全部' : TYPE_NAMES[t]}
            </button>
          ))}
        </div>
      </div>

      {/* 插件列表 */}
      <div className="plugin-control-center__list">
        {filteredPlugins.length === 0 ? (
          <div className="plugin-empty">
            {search ? '没有找到匹配的插件' : '暂无插件'}
          </div>
        ) : (
          filteredPlugins.map((plugin) => (
            <PluginCard
              key={plugin.metadata.id}
              plugin={plugin}
              onToggle={handleToggle}
            />
          ))
        )}
      </div>
    </div>
  )
}
