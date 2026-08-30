/**
 * PluginService - 插件管理服务
 * 
 * 负责发现、加载和管理编辑器插件
 * 从 harness 目录动态加载插件信息
 */
import type { PluginInfo, PluginMetadata, PluginState, PluginStatus } from '../types/plugin'
import { agentService } from './AgentService'

export class PluginService {
  private plugins: Map<string, PluginInfo> = new Map()
  private listeners: Set<(plugins: PluginInfo[]) => void> = new Set()
  private loading: boolean = false

  constructor() {
    // 异步加载插件，不阻塞构造函数
    this.loadPluginsFromHarness()
  }

  /** 从 harness 目录加载插件 */
  private async loadPluginsFromHarness(): Promise<void> {
    if (this.loading) return
    this.loading = true

    try {
      // 检查 electronAPI 是否可用
      if (!window.electronAPI?.listHarnessPlugins) {
        console.warn('[PluginService] electronAPI 不可用，使用本地插件状态')
        return
      }

      const result = await window.electronAPI.listHarnessPlugins()
      if (!result.success) {
        console.error('[PluginService] 获取 harness 插件列表失败:', result.error)
        return
      }

      // 清空现有插件
      this.plugins.clear()

      // 加载插件
      for (const pluginData of result.plugins) {
        const metadata: PluginMetadata = {
          id: pluginData.id,
          name: pluginData.name,
          description: pluginData.description,
          version: pluginData.version,
          author: pluginData.author,
          type: pluginData.type as any,
          icon: pluginData.icon,
          capabilities: pluginData.capabilities,
        }

        this.plugins.set(metadata.id, {
          metadata,
          state: {
            id: metadata.id,
            status: 'inactive',
          },
        })
      }

      console.log(`[PluginService] 从 harness 加载了 ${this.plugins.size} 个插件`)
      this.notifyListeners()
    } catch (error) {
      console.error('[PluginService] 加载插件失败:', error)
    } finally {
      this.loading = false
    }
  }

  /** 重新加载插件 */
  async reloadPlugins(): Promise<void> {
    await this.loadPluginsFromHarness()
  }

  /** 获取所有插件 */
  getPlugins(): PluginInfo[] {
    return Array.from(this.plugins.values())
  }

  /** 按类型获取插件 */
  getPluginsByType(type: string): PluginInfo[] {
    return this.getPlugins().filter(p => p.metadata.type === type)
  }

  /** 获取单个插件 */
  getPlugin(id: string): PluginInfo | undefined {
    return this.plugins.get(id)
  }

  /** 激活插件 */
  activatePlugin(id: string): void {
    const plugin = this.plugins.get(id)
    if (!plugin) return

    plugin.state.status = 'active'
    plugin.state.enabledAt = Date.now()
    plugin.state.lastError = undefined
    this.notifyListeners()
  }

  /** 停用插件 */
  deactivatePlugin(id: string): void {
    const plugin = this.plugins.get(id)
    if (!plugin) return

    plugin.state.status = 'inactive'
    this.notifyListeners()
  }

  /** 切换插件状态 */
  togglePlugin(id: string): void {
    const plugin = this.plugins.get(id)
    if (!plugin) return

    if (plugin.state.status === 'active') {
      this.deactivatePlugin(id)
    } else {
      this.activatePlugin(id)
    }
  }

  /** 更新插件状态（由 DSH 回调触发） */
  updatePluginState(id: string, state: Partial<PluginState>): void {
    const plugin = this.plugins.get(id)
    if (!plugin) return

    plugin.state = { ...plugin.state, ...state }
    this.notifyListeners()
  }

  /** 从 DSH 同步插件状态 */
  async syncFromDSH(): Promise<void> {
    try {
      // 通过 agentService 检查连接状态
      if (!agentService.isConnected()) {
        console.log('[PluginService] DSH 未连接，使用本地插件状态')
        return
      }

      // 标记所有插件为活跃（DSH 已连接）
      for (const id of this.plugins.keys()) {
        this.updatePluginState(id, { status: 'active' })
      }
    } catch (error) {
      console.error('[PluginService] 同步失败:', error)
    }
  }

  /** 订阅插件状态变化 */
  onPluginsChange(listener: (plugins: PluginInfo[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notifyListeners(): void {
    const plugins = this.getPlugins()
    this.listeners.forEach(l => l(plugins))
  }

  /** 获取插件统计摘要 */
  getStats(): { total: number; active: number; inactive: number; error: number } {
    const plugins = this.getPlugins()
    return {
      total: plugins.length,
      active: plugins.filter(p => p.state.status === 'active').length,
      inactive: plugins.filter(p => p.state.status === 'inactive').length,
      error: plugins.filter(p => p.state.status === 'error').length,
    }
  }
}

export const pluginService = new PluginService()
