export interface ElectronAPI {
  getAppInfo: () => Promise<{
    version: string
    name: string
    platform: string
    isDev: boolean
    /** 应用根目录绝对路径（Agent 面板默认工作区） */
    appRoot: string
  }>
  openFileDialog: (options: any) => Promise<any>
  saveFileDialog: (options: any) => Promise<any>
  showMessageBox: (options: any) => Promise<any>
  onMenuAction: (callback: (action: string) => void) => () => void
  onGameInput: (callback: (key: string) => void) => () => void
  onMCPCommand: (callback: (command: string, params: any, requestId?: string) => void) => () => void
  /** MCP 往返响应（renderer → main，ai_event 等往返请求回传） */
  sendMCPResponse: (requestId: string, result: unknown) => void
  reportGameState: (state: { running: boolean; score?: number }) => Promise<void>
  sendAppReady: () => void
  writeLogFile: (level: string, message: string) => Promise<void>
  readLogFile: (options?: { tail?: number }) => Promise<string>
  /** 开始游戏日志：创建独立 game_*.log 文件，返回文件路径（失败返回 null） */
  startGameLog: (projectName?: string) => Promise<string | null>
  /** 写入游戏日志（需先 startGameLog；无活跃文件时忽略） */
  writeGameLog: (level: string, message: string) => Promise<void>
  /** 结束游戏日志：关闭当前 game 文件（文件保留，滚动清理） */
  stopGameLog: () => Promise<void>
  toggleDevTools?: () => Promise<void>
  createProject: (projectName: string, mode?: '2d' | '3d') => Promise<{ success: boolean; error?: string; path?: string }>
  readJsonFile: (relativePath: string) => Promise<{ success: boolean; data?: any; error?: string }>
  writeJsonFile: (relativePath: string, data: unknown) => Promise<{ success: boolean; error?: string }>
  /** 蓝图编辑 MCP 往返：主进程转发外部请求到渲染进程处理 */
  onBlueprintRequest: (callback: (requestId: string, op: string, params: any) => void) => () => void
  /** 蓝图编辑 MCP 往返：渲染进程回传结果给主进程 */
  sendBlueprintResponse: (requestId: string, result: unknown) => void
  discoverProjectsScan: () => Promise<Array<{ name: string; description: string; version: string; tags: string[]; folder: string; renderMode?: '2d' | '3d'; defaultScene?: string }>>
  listProjectAssets: (folder: string) => Promise<Array<{ path: string; ext: string; size: number }>>
  /** 列出工程源码文件（.ts/.tsx，排除 .d.ts），返回相对项目根的路径列表（codeLint 用） */
  listProjectSrc: (folder: string) => Promise<string[]>
  /** 读取文本文件（codeLint 源码扫描用），返回 {success, data?, error?} 信封 */
  readTextFile: (relativePath: string) => Promise<{ success: boolean; data?: string; error?: string }>
  /** 监听某工程目录（asset + src，覆盖上一次监听）；返回是否成功 */
  watchProjectAssets: (folder: string) => Promise<{ ok: boolean }>
  /** 停止工程目录监听 */
  stopWatchProjectAssets: () => Promise<{ ok: boolean }>
  /** 资产文件变化回调（返回取消订阅函数）。folder 为发生变化的工程目录名 */
  onAssetChanged: (callback: (folder: string) => void) => () => void
  /** 源码文件变化回调（返回取消订阅函数）。folder 为发生变化的工程目录名 */
  onSrcChanged: (callback: (folder: string) => void) => () => void

  // ─── AI 聊天 ───
  /** AI 聊天请求（主进程转发到渲染进程处理） */
  onAIChat: (callback: (requestId: string, message: string, history?: Array<{ role: string; content: string }>) => void) => () => void
  /** AI 聊天响应（渲染进程回传结果给主进程） */
  sendAIChatResponse: (requestId: string, result: unknown) => void

  // DSH 服务状态查询（agent 常驻化：含主进程生命周期阶段）
  /** DshLifecycle: off=未引导 probing=探测中 claimed=已认领幸存实例 spawning=启动中 running=运行中 restart-wait=自愈重启等待 degraded=终态故障 */
  dshStatus: () => Promise<{
    ready: boolean
    port: number
    enginePort: number
    lifecycle: 'off' | 'probing' | 'claimed' | 'spawning' | 'running' | 'restart-wait' | 'degraded'
    agentPid: number | null
  }>

  // DSH RPC 代理（绕过 CORS，通过 main 进程转发到 DSH :3080）
  dshRpc: (method: string, payload: unknown) => Promise<{ type: string; result?: { ok?: boolean; value?: unknown; error?: { message?: string } } }>

  // --- DSH Mux WS 下行桥（question/requested 等事件帧推送） ---
  dshMuxConnect: () => Promise<void>
  dshMuxDisconnect: () => Promise<void>
  onDshMuxFrame: (callback: (frame: unknown) => void) => () => void

  // DSH Respond 代理（client-response 信封，用于 question 回答）
  dshRespond: (message: unknown) => Promise<{ accepted?: boolean; reason?: string }>

  // DSH 手动重启（degraded 终态的恢复入口）
  dshRestart: () => Promise<{ ok: boolean }>

  // Agent 独立窗口（编辑器自身 AgentUI 全屏承载，单例；随主窗口关闭级联关闭）
  dshOpenAgentWindow: () => Promise<{ ok: boolean }>
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
