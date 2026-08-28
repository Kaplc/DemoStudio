/**
 * DSH 插件包入口。
 *
 * 工具实现只依赖 EngineBridge / 编辑器 HTTP API，不依赖 DSH 内部 API（架构红线 FR-4.7）。
 *
 * DSH 注册模式：
 * - DSH 暴露 `ctx.tools.register(tool)` API（具体见 DSH 文档 / SDK protocol）
 * - 我们用鸭子类型调用 `register` / `effect`，避免硬依赖未发布的 DSH 接口
 *
 * 引擎上下文注入（关键）：
 * - 编辑器侧常驻化引导链路（electron/main.ts → dsh-agent-watcher）在 agent 启动前
 *   通过 env / globalThis.__dshEngineCtx 提供 bridges
 * - 我们的 tools 通过 `engineContext.getEngineContext` 优先读 ctx、再读 globalThis
 * - apply 阶段不直接读 ctx.engineBridge / ctx.fileBridge（避免触发 Cordis 反射错误），
 *   而是直接把 globalThis 里的 __dshEngineCtx 提供给 tools ；
 *   tools 调用时再通过 engineContext.ts 统一来源（ctx 注入 / globalThis）
 */
import { inspectSceneTool } from './tools/inspectScene'
import { spawnEntityTool } from './tools/spawnEntity'
import { runScenarioTool } from './tools/runScenario'
import { getGameStateTool } from './tools/getGameState'
import { setGameSpeedTool } from './tools/setGameSpeed'
import { cordisDefineRobustTool, cordisUnwrapDemoTool } from './tools/robustDefine'
import { apply as applyChatPlugin } from './chatPlugin'

export const name = '@demostudio/dsh-engine-tools'

const ALL_TOOLS = [inspectSceneTool, spawnEntityTool, runScenarioTool, getGameStateTool, setGameSpeedTool, cordisDefineRobustTool, cordisUnwrapDemoTool]

interface DSHContext {
  tools?: { register(tool: unknown): void }
  effect?(fn: (ctx: DSHContext) => void): void
  session?: {
    run(prompt: string, options?: any): Promise<any>
  }
  on?(event: string, handler: (...args: any[]) => void): void
}

/**
 * 兼容 DSH 的多种注册入口（effect vs apply）。
 *
 * 注意：不要在 apply 内通过 `ctx.<任意属性>` 访问字段 — Cordis 的 ctx 是 Proxy，
 * 访问未声明的属性会抛 "cannot get property X without inject"。
 * 我们只在 globalThis 上读写 __dshEngineCtx，绕过 ctx proxy。
 */
export function apply(ctx: DSHContext): void {
  // 注册工具（ctx.tools / ctx.effect 是通过 inject 显式声明的合法属性）
  if (typeof ctx.effect === 'function') {
    ctx.effect((inner: DSHContext) => registerTools(inner))
  } else {
    registerTools(ctx)
  }

  // 启动聊天插件
  applyChatPlugin(ctx)
}

function registerTools(ctx: DSHContext): void {
  // 同样：只用 inject 声明过的属性（ctx.tools / ctx.effect）
  const tools = ctx.tools
  if (!tools || typeof tools.register !== 'function') return
  for (const tool of ALL_TOOLS) {
    // 包装 tool.execute：把 ctx（可能为空）传入；tools 内部从 globalThis 读 __dshEngineCtx
    const wrapped = wrapTool(tool)
    tools.register(wrapped)
  }
}

function wrapTool(tool: any): any {
  const original = tool.execute
  if (typeof original !== 'function') return tool
  return {
    ...tool,
    execute: (args: unknown, callCtx?: unknown) => {
      return original(args, callCtx)
    },
  }
}

export { ALL_TOOLS }