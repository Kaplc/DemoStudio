/**
 * PluginService - 插件管理服务
 * 
 * 负责发现、加载和管理编辑器插件
 * 通过 DSH RPC 获取已注册的插件信息
 */
import type { PluginInfo, PluginMetadata, PluginState, PluginStatus } from '../types/plugin'
import { agentService } from './AgentService'

/** 内置插件列表（从 dsh-plugin 同步） */
const BUILTIN_PLUGINS: PluginMetadata[] = [
  {
    id: '@demostudio/inspect-scene',
    name: '场景检查',
    description: '检查当前场景中的所有实体、组件和层级关系',
    version: '1.0.0',
    author: 'DemoStudio',
    type: 'tool',
    icon: '🔍',
    capabilities: ['inspect-scene', 'list-entities', 'get-hierarchy'],
  },
  {
    id: '@demostudio/spawn-entity',
    name: '实体生成',
    description: '在场景中动态生成 Actor、Pawn 或其他实体',
    version: '1.0.0',
    author: 'DemoStudio',
    type: 'tool',
    icon: '✨',
    capabilities: ['spawn-actor', 'spawn-pawn', 'create-component'],
  },
  {
    id: '@demostudio/run-scenario',
    name: '场景执行',
    description: '运行预定义的游戏场景或测试脚本',
    version: '1.0.0',
    author: 'DemoStudio',
    type: 'tool',
    icon: '▶️',
    capabilities: ['run-scenario', 'execute-script'],
  },
  {
    id: '@demostudio/get-game-state',
    name: '游戏状态',
    description: '获取当前游戏的运行状态、分数、生命值等信息',
    version: '1.0.0',
    author: 'DemoStudio',
    type: 'tool',
    icon: '📊',
    capabilities: ['get-state', 'get-score', 'get-health'],
  },
  {
    id: '@demostudio/set-game-speed',
    name: '游戏速度',
    description: '控制游戏运行速度，支持暂停、慢放、快进',
    version: '1.0.0',
    author: 'DemoStudio',
    type: 'tool',
    icon: '⚡',
    capabilities: ['set-speed', 'pause', 'resume'],
  },
  {
    id: '@demostudio/dsh-chat',
    name: 'DSH 聊天',
    description: '通过 WebSocket 与 DSH Agent 实时通信',
    version: '1.0.0',
    author: 'DemoStudio',
    type: 'integration',
    icon: '💬',
    capabilities: ['chat', 'streaming', 'tool-calls'],
  },
]

export class PluginService {
  private plugins: Map<string, PluginInfo> = new Map()
  private listeners: Set<(plugins: PluginInfo[]) => void> = new Set()

  constructor() {
    this.initBuiltinPlugins()
  }

  /** 初始化内置插件 */
  private initBuiltinPlugins(): void {
    for (const metadata of BUILTIN_PLUGINS) {
      this.plugins.set(metadata.id, {
        metadata,
        state: {
          id: metadata.id,
          status: 'inactive',
        },
      })
    }
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

      // 标记聊天插件为活跃（因为已连接）
      this.updatePluginState('@demostudio/dsh-chat', { status: 'active' })

      // 标记所有工具为活跃（DSH 已加载）
      for (const id of this.plugins.keys()) {
        if (id.startsWith('@demostudio/') && id !== '@demostudio/dsh-chat') {
          this.updatePluginState(id, { status: 'active' })
        }
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
