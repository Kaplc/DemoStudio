/**
 * PluginControlCenter - 插件控制中心
 * 
 * 单行列表风格：每项仅展示「名称 + 介绍」，右侧为 iOS 风格开关（无图标）
 */
import React, { useState, useEffect, useCallback } from 'react'
import { pluginService } from '../editor/PluginService'
import { logger } from '../engine'
import type { PluginInfo, PluginStatus, PluginType } from '../types/plugin'

/** 插件类型中文名映射 */
const TYPE_NAMES: Record<PluginType, string> = {
  tool: '工具',
  service: '服务',
  ui: 'UI',
  integration: '集成',
}

/** loading 态开关不可操作，避免与同步流程冲突 */
const isStatusLockable = (status: PluginStatus): boolean => status === 'loading'

interface PluginRowProps {
  plugin: PluginInfo
  onToggle: (id: string) => void
}

/** 单个插件行（单行：名称 + 介绍 + iOS 开关） */
const PluginRow: React.FC<PluginRowProps> = ({ plugin, onToggle }) => {
  const { metadata, state } = plugin
  const isActive = state.status === 'active'
  const locked = isStatusLockable(state.status)

  const handleClick = () => {
    if (locked) return
    logger.info(`[PluginControlCenter] 切换插件: ${metadata.id} → ${isActive ? '停用' : '启用'}`)
    onToggle(metadata.id)
  }

  return (
    <div className={`plugin-row ${isActive ? 'active' : 'inactive'}`}>
      <button
        className="plugin-row__main"
        onClick={handleClick}
        disabled={locked}
        title={locked ? '插件加载中，暂不可切换' : (isActive ? '点击停用' : '点击启用')}
      >
        <span className="plugin-row__name">{metadata.name}</span>
        <span className="plugin-row__desc">{metadata.description}</span>
      </button>

      <button
        type="button"
        role="switch"
        aria-checked={isActive}
        aria-label={`${metadata.name} ${isActive ? '已启用' : '已停用'}`}
        disabled={locked}
        className={`plugin-switch ${isActive ? 'on' : 'off'} ${locked ? 'locked' : ''}`}
        onClick={handleClick}
      >
        <span className="plugin-switch__knob" />
      </button>
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
        <h2>插件</h2>
        {onClose && (
          <button
            className="plugin-control-center__close"
            onClick={onClose}
            title="关闭"
            aria-label="关闭插件面板"
          >✕</button>
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

      {/* 插件列表（单行） */}
      <div className="plugin-control-center__list">
        {filteredPlugins.length === 0 ? (
          <div className="plugin-empty">
            {search ? '没有找到匹配的插件' : '暂无插件'}
          </div>
        ) : (
          filteredPlugins.map((plugin) => (
            <PluginRow
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
