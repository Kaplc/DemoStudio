/**
 * @demostudio/ds-editor-tools — 编辑器 UI 操控工具集
 *
 * 两条通路：
 * 1. CDP/Playwright：通过 playwright-core 连接编辑器 CDP 端口（9222），
 *    实现 UI 点击/输入/截图/读取等精细操作
 * 2. editor.* AI 事件：通过 CDP 在渲染进程中调用 window.__ai.emit，
 *    操作面板开关/视口切换/工程切换等结构化功能
 *
 * 与 ds-engine-tools 的分工：
 * - ds-engine-tools：游戏运行时操作（ai.spawnActor / ai.getState 等）
 * - ds-editor-tools：编辑器 UI 操作（点击按钮 / 切换面板 / 截图等）
 */
import { editorClickTool } from './tools/editorClick'
import { editorHoverTool } from './tools/editorHover'
import { editorTypeTool } from './tools/editorType'
import { editorReadTool } from './tools/editorRead'
import { editorEmitTool } from './tools/editorEvent'
import { editorRestartTool } from './tools/editorRestart'
import { disconnect as disconnectCDP } from './cdpBridge'

export const name = '@demostudio/ds-editor-tools'

/** 本插件访问的 Cordis 服务：tools（工具注册表） */
export const inject = ['tools']

const ALL_TOOLS = [
  editorClickTool,
  editorHoverTool,
  editorTypeTool,
  editorReadTool,
  editorEmitTool,
  editorRestartTool,
]

interface DSHContext {
  tools?: { register(tool: unknown): void }
  effect?(fn: () => void): void
}

export function apply(ctx: DSHContext): void {
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => {
      registerTools(ctx)
      // 卸载时断开 CDP 连接
      return () => { void disconnectCDP() }
    })
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

export { ALL_TOOLS }
export { disconnect as disconnectCDP } from './cdpBridge'
