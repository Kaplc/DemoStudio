/**
 * @demostudio/ds-plugin-manager
 *
 * DSH 插件管理器：提供 3 个核心工具让 agent 自动管理其他插件。
 *
 * 工具列表：
 * - create_plugin: 生成插件脚手架
 * - mount_plugin: 一键部署（build → junction → patch → validate）
 * - unmount_plugin: 卸载插件（移除 junction + patch）
 */
import { createPluginTool } from './tools/createPlugin.js'
import { mountPluginTool } from './tools/mountPlugin.js'
import { unmountPluginTool } from './tools/unmountPlugin.js'

export const name = '@demostudio/ds-plugin-manager'

/** 本插件访问的 Cordis 服务 */
export const inject = ['tools']

interface DSHContext {
  tools?: { register(tool: unknown): void }
  effect?(fn: () => void): void
}

const ALL_TOOLS = [
  createPluginTool,
  mountPluginTool,
  unmountPluginTool,
]

export function apply(ctx: DSHContext): void {
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => registerTools(ctx))
  } else {
    registerTools(ctx)
  }
}

function registerTools(ctx: DSHContext): void {
  const tools = ctx.tools
  if (!tools || typeof tools.register !== 'function') return
  for (const tool of ALL_TOOLS) {
    tools.register(tool)
  }
}
