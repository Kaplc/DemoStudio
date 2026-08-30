/**
 * @demostudio/dsh-plugin-manager
 *
 * DSH 插件管理器：提供 7 个工具让 agent 自动创建、构建、挂载、卸载其他插件。
 *
 * 工具列表：
 * - create_plugin: 生成插件脚手架
 * - build_plugin: 编译插件
 * - mount_plugin: 挂载到 profile（junction + patch）
 * - unmount_plugin: 卸载
 * - list_plugins: 列出所有插件
 * - deploy_plugin: 一键部署（build + mount + validate）
 * - validate_plugin: 验证插件状态
 */
import { createPluginTool } from './tools/createPlugin.js'
import { buildPluginTool } from './tools/buildPlugin.js'
import { mountPluginTool } from './tools/mountPlugin.js'
import { unmountPluginTool } from './tools/unmountPlugin.js'
import { listPluginsTool } from './tools/listPlugins.js'
import { deployPluginTool } from './tools/deployPlugin.js'
import { validatePluginTool } from './tools/validatePlugin.js'

export const name = '@demostudio/dsh-plugin-manager'

/** 本插件访问的 Cordis 服务 */
export const inject = ['tools']

interface DSHContext {
  tools?: { register(tool: unknown): void }
  effect?(fn: () => void): void
}

const ALL_TOOLS = [
  createPluginTool,
  buildPluginTool,
  mountPluginTool,
  unmountPluginTool,
  listPluginsTool,
  deployPluginTool,
  validatePluginTool,
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
