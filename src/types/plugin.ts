/**
 * 插件系统类型定义
 */

/** 插件状态 */
export type PluginStatus = 'active' | 'inactive' | 'error' | 'loading'

/** 插件类型 */
export type PluginType = 'tool' | 'service' | 'ui' | 'integration'

/** 插件元数据 */
export interface PluginMetadata {
  id: string
  name: string
  description: string
  version: string
  author?: string
  type: PluginType
  icon?: string
  /** 插件提供的功能列表 */
  capabilities?: string[]
  /** 插件依赖的其他插件 */
  dependencies?: string[]
  /** 配置项定义 */
  configSchema?: Record<string, unknown>
}

/** 插件运行时状态 */
export interface PluginState {
  id: string
  status: PluginStatus
  /** 启用/禁用时间 */
  enabledAt?: number
  /** 最后错误信息 */
  lastError?: string
  /** 运行时统计 */
  stats?: {
    calls?: number
    lastUsed?: number
  }
}

/** 完整插件信息（元数据 + 状态） */
export interface PluginInfo {
  metadata: PluginMetadata
  state: PluginState
}

/** 插件控制中心配置 */
export interface PluginControlConfig {
  /** 是否显示停用的插件 */
  showInactive?: boolean
  /** 是否按类型分组 */
  groupByType?: boolean
  /** 排序方式 */
  sortBy?: 'name' | 'status' | 'type'
}
