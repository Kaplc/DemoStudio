/**
 * DSH 适配层共享上下文
 *
 * 适配层模块（auth/lifecycle/rpcProxy/streamBridge/adapters）不直接 import electron，
 * 全部环境依赖由 main.ts 启动时经 initDshContext 注入——模块保持可单测、可搬迁。
 */

export interface DshModuleContext {
  /** 仓库根（dist-electron 的上一级） */
  appRoot: string
  /** 日志目录（dsh-agent.log 所在） */
  logDir: string
  /** harness/dsh-source 源码参考仓（launcher cwd） */
  sourceDir: string
  /** 所有权协议状态目录（cache/dsh-runtime） */
  stateDir: string
  /** scripts 目录（dsh-agent-launcher.cmd 所在） */
  scriptsDir: string
  isDev: boolean
  /** MCP HTTP API 端口（多实例自动分配，spawn 时传给 launcher） */
  getMcpApiPort: () => number
  /** 向所有未销毁窗口的渲染进程广播帧（dsh-mux-frame / dsh-host-frame） */
  broadcast: (channel: string, payload: unknown) => void
}

let _ctx: DshModuleContext | null = null

/** DSH web 服务默认端口（探测/流桥/RPC 代理共用；多实例共享单 agent） */
export const DSH_PORT_DEFAULT = 3080

/** main.ts 启动时调用一次；必须在任何 DSH 适配层函数执行前完成 */
export function initDshContext(ctx: DshModuleContext): void {
  _ctx = ctx
}

export function dshCtx(): DshModuleContext {
  if (!_ctx) throw new Error('[dsh] 适配层上下文未初始化（initDshContext 未调用）')
  return _ctx
}

/** 仅测试用：注入/清除假上下文 */
export function __setDshContextForTest(ctx: DshModuleContext | null): void {
  _ctx = ctx
}
