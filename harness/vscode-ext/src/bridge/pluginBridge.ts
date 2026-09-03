/**
 * ds-engine-tools 加载器：把插件包当作 npm 包 require 进来，把 EngineContext 塞进 ctx。
 *
 * 加载策略：
 * - vscode-ext 把插件预编译产物（dist/）作为 node module 引入，避免运行时 import ts
 * - 注入 ctx.engineBridge / ctx.fileBridge / ctx.guardPolicy
 * - 插件包 apply(ctx) 注册工具
 *
 * 调插件 / 调工具的所有权在 DSH runtime（嵌入式进程）；vscode-ext 仅作为 host：
 *   1) vscode-ext 启动 DSH runtime 通过 EmbeddedKernelAdapter（→ spawn 子进程）
 *   2) vscode-ext 通过 stdio 与 DSH runtime 通信
 *   3) DSH runtime 加载插件包 → 工具注册进 Cordis ctx
 *   4) DSH runtime 调用工具 → 工具实现经 EngineBridge 反向回调 vscode-ext
 *
 * 第一版简化：ds-engine-tools 工具不与 DSH runtime 真集成，而是由 vscode-ext 直接 import
 * 插件的 `ALL_TOOLS` 并通过一个轻量"AgentExecutor"绑定到 KernelAdapter 事件流。
 * 这样在 DSH 0.1.x 上线前即可完整跑通"改代码 → 启动游戏 → 读日志 → 迭代"闭环。
 *
 * 等 DSH SDK 提供 `defineTool` 工具装饰器（FR-4.1）稳定后，迁移到真 DSH registration。
 */
import type { EngineBridge } from './engineBridge'
import type { FileBridgeLike } from '../../../ds-engine-tools/src/engineContext'

export interface PluginTool {
  name: string
  description: string
  schema: { parse: (input: unknown) => unknown } | unknown
  execute: (args: unknown, ctx: unknown) => Promise<unknown>
}

export interface PluginBridgeOpts {
  outputChannel: { appendLine: (s: string) => void }
  bridge: EngineBridge
  fileBridge: FileBridgeLike
  guardPolicy: Record<string, 'allow' | 'deny' | 'ask'>
}

/**
 * 加载插件包工具（绝对路径 require ds-engine-tools 编译产物）。
 * 返回一组 (name → 工具定义) 给上层 AgentExecutor 用。
 */
export function loadPluginTools(pluginDistPath: string, opts: PluginBridgeOpts): PluginTool[] {
  let mod: { ALL_TOOLS?: PluginTool[] }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require(pluginDistPath)
  } catch (err) {
    opts.outputChannel.appendLine(`[plugin] require failed: ${err}`)
    return []
  }
  const tools: PluginTool[] = mod.ALL_TOOLS ?? []
  opts.outputChannel.appendLine(`[plugin] 加载 ${tools.length} 个工具：${tools.map((t) => t.name).join(', ')}`)
  // 把 ctx 构造逻辑挂到全局 hooks，供工具调用时一并带上
  ;(globalThis as { __dshEngineCtx?: { engineBridge: EngineBridgeLike; fileBridge: FileBridgeLike; guardPolicy?: Record<string, 'allow' | 'deny' | 'ask'> } }).__dshEngineCtx = {
    engineBridge: {
      callTool: (name, args) => opts.bridge.callTool(name, args),
      getStatus: () => opts.bridge.getStatus(),
      readConsoleLogs: () => opts.bridge.readConsoleLogs(),
    },
    fileBridge: opts.fileBridge,
    guardPolicy: opts.guardPolicy,
  }
  return tools
}

// ─── EngineBridge 鸭子类型（plugin 内 EngineBridgeLike 与 vscode-ext EngineBridge 同构）───
interface EngineBridgeLike {
  callTool(name: string, args?: Record<string, unknown>): Promise<unknown>
  getStatus(): Promise<{ running: boolean; gameRunning: boolean } | null>
  readConsoleLogs(): Promise<string[]>
}
