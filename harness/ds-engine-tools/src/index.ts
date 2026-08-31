/**
 * DSH 插件包入口。
 *
 * 工具实现只依赖 EngineBridge / 编辑器 HTTP API，不依赖 DSH 内部 API（架构红线 FR-4.7）。
 */
import { emitAIEventTool } from './tools/emitAIEvent'
import { mouseClickTool, mouseMoveTool, mouseDragTool, keyPressTool } from './tools/mouseSimulation'
import { getHUDTool } from './tools/getHUD'

export const name = '@demostudio/ds-engine-tools'

/** 本插件访问的 Cordis 服务：tools（工具注册表）。logger 是 Context 内建属性，不走 inject。 */
export const inject = ['tools']

const ALL_TOOLS = [
  emitAIEventTool,
  mouseClickTool,
  mouseMoveTool,
  mouseDragTool,
  keyPressTool,
  getHUDTool,
]

interface DSHContext {
  tools?: { register(tool: unknown): void }
  effect?(fn: (ctx: DSHContext) => void): void
}

/**
 * 兼容 DSH 的多种注册入口（effect vs apply）。
 *
 * 注意：不要在 apply 内通过 `ctx.<任意属性>` 访问字段 — Cordis 的 ctx 是 Proxy，
 * 访问未声明的属性会抛 "cannot get property X without inject"。
 */
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

export { ALL_TOOLS }