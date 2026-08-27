/**
 * 引擎工具通用：定义通过 EngineBridge / HTTP 调用编辑器 API。
 *
 * 关键设计：
 * - 不依赖 DSH 内部 API（架构红线 §FR-4.7）
 * - 通过 `globalThis.__dshEngineCtx` 或 `ctx` 注入的 `engineBridge` / `fileBridge` 对象与编辑器通信
 *   （DSH runtime 不知道 vscode 的存在；上层 host 把 bridge 桥接到 ctx）
 *
 * 注入路径优先级：
 *   1. `ctx.engineBridge` / `ctx.fileBridge`（如果 DSH 提供了 ctx 注入机制）
 *   2. `globalThis.__dshEngineCtx`（DSH Agent Service 启动时设置的全局对象，跨进程通过 env 传递）
 */

export interface EngineBridgeLike {
  /**
   * 调编辑器工具：MCP 通道（首选）或 HTTP 通道（兜底）。
   * 返回任意 JSON。
   */
  callTool(name: string, args?: Record<string, unknown>): Promise<unknown>
  /** 编辑器侧 get_status；可读 gameRunning/gameScore 字段 */
  getStatus(): Promise<{ running: boolean; gameRunning: boolean; gameScore?: number } | null>
  /** 编辑器侧 console-logs（最近 50 行） */
  readConsoleLogs(): Promise<string[]>
}

export interface FileBridgeLike {
  /** 经 vscode.workspace.fs 读场景 JSON */
  readJsonFile(path: string): Promise<unknown | null>
  /** 经 vscode.workspace.fs 写场景 JSON；返回 { ok, error? } */
  writeJsonFile(path: string, data: unknown): Promise<{ ok: boolean; error?: string }>
}

/** 注入到 Cordis ctx 的能力（host 在加载插件包前塞入 ctx） */
export interface EngineContext {
  engineBridge: EngineBridgeLike
  fileBridge: FileBridgeLike
  guardPolicy?: Record<string, 'allow' | 'deny' | 'ask'>
}

/**
 * 从 DSH 启动 env / globalThis 提取 workspace 根。
 * DSH 由 electron/main.ts 以 `dsh-cli --profile web` 拉起时注入 DSH_ENGINE_PORT 等 env；
 * workspace 根通过 DSH_PLUGIN_DIST 反推。
 */
function getWorkspaceRootFromEnv(): string | null {
  const distPath = process.env.DSH_PLUGIN_DIST
  if (!distPath) return null
  // harness/dsh-plugin/dist → workspace root
  const m = distPath.match(/^(.*[\\/])harness[\\/]dsh-plugin[\\/]dist[\\/]?$/)
  if (!m) return null
  return m[1].replace(/[\\/]+$/, '') || '/'
}

/**
 * 暴露给 DSH 插件包：自动选择 bridge 来源。
 * @param ctx DSH 传入的 cordis 上下文（可能是 Cordis ctx / 任意对象）
 */
export function getEngineContext(ctx: unknown): EngineContext | null {
  // 来源 1：ctx 直接注入
  if (ctx && typeof ctx === 'object') {
    const c = ctx as Record<string, unknown>
    if (c.engineBridge && c.fileBridge) {
      return {
        engineBridge: c.engineBridge as EngineBridgeLike,
        fileBridge: c.fileBridge as FileBridgeLike,
        guardPolicy: c.guardPolicy as EngineContext['guardPolicy'],
      }
    }
  }

  // 来源 2：globalThis.__dshEngineCtx（dsh-agent-service 启动时注入）
  const g = globalThis as Record<string, unknown>
  const injected = g.__dshEngineCtx as Record<string, unknown> | undefined
  if (injected && injected.engineBridge && injected.fileBridge) {
    return {
      engineBridge: injected.engineBridge as EngineBridgeLike,
      fileBridge: injected.fileBridge as FileBridgeLike,
      guardPolicy: injected.guardPolicy as EngineContext['guardPolicy'],
    }
  }

  return null
}

/** 调试：当前 bridges 来源 */
export function describeEngineContextSource(): string {
  const g = globalThis as Record<string, unknown>
  if (g.__dshEngineCtx) return 'globalThis.__dshEngineCtx'
  return 'none'
}

export { getWorkspaceRootFromEnv }