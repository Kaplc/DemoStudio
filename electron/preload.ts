/**
 * DemoStudio Preload 脚本
 * 通过 contextBridge 暴露安全的 IPC API 给渲染进程
 */
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // ─── 应用信息 ───
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),

  // ─── 应用就绪通知（关闭加载窗口） ───
  sendAppReady: () => ipcRenderer.send('app-ready'),

  // ─── 文件对话框 ───
  openFileDialog: (options: any) => ipcRenderer.invoke('open-file-dialog', options),
  saveFileDialog: (options: any) => ipcRenderer.invoke('save-file-dialog', options),
  showMessageBox: (options: any) => ipcRenderer.invoke('show-message-box', options),

  // ─── 游戏输入事件（方向键，从 main process before-input-event 转发）───
  onGameInput: (callback: (key: string) => void) => {
    ipcRenderer.on('game-input', (_event, key: string) => callback(key))
    return () => {
      ipcRenderer.removeAllListeners('game-input')
    }
  },

  // ─── 菜单事件 ───
  onMenuAction: (callback: (action: string) => void) => {
    ipcRenderer.on('menu-action', (_event, action: string) => callback(action))
    return () => {
      ipcRenderer.removeAllListeners('menu-action')
    }
  },

  // ─── MCP 命令（从 Electron main → renderer） ───
  onMCPCommand: (callback: (command: string, params: any, requestId?: string) => void) => {
    ipcRenderer.on('mcp-command', (_event, data: { command: string; params?: any; requestId?: string }) => {
      callback(data.command, data.params, data.requestId)
    })
    return () => {
      ipcRenderer.removeAllListeners('mcp-command')
    }
  },

  // ─── MCP 响应（renderer → main，往返请求回传） ───
  sendMCPResponse: (requestId: string, result: unknown) => {
    ipcRenderer.send('mcp-response', { requestId, result })
  },

  // ─── 日志 ───
  writeLogFile: (level: string, message: string) =>
    ipcRenderer.invoke('write-log-file', level, message),
  readLogFile: (options?: { tail?: number }) =>
    ipcRenderer.invoke('read-log-file', options),

  // ─── 游戏日志（每次启动游戏独立文件）───
  startGameLog: (projectName?: string) =>
    ipcRenderer.invoke('start-game-log', projectName),
  writeGameLog: (level: string, message: string) =>
    ipcRenderer.invoke('write-game-log', level, message),
  stopGameLog: () =>
    ipcRenderer.invoke('stop-game-log'),

  // ─── MCP 报告游戏状态 ───
  reportGameState: (state: { running: boolean; score?: number }) =>
    ipcRenderer.invoke('mcp-report-state', state),

  // ─── DevTools ───
  toggleDevTools: () => ipcRenderer.invoke('toggle-dev-tools'),

  // ─── 创建工程 ───
  createProject: (projectName: string, mode: '2d' | '3d' = '3d') =>
    ipcRenderer.invoke('create-project', projectName, mode),

  // ─── 读取 JSON 文件（场景资产）───
  readJsonFile: (relativePath: string) => ipcRenderer.invoke('read-json-file', relativePath),

  // ─── 写入 JSON 文件（蓝图资产编辑等）───
  writeJsonFile: (relativePath: string, data: unknown) =>
    ipcRenderer.invoke('write-json-file', relativePath, data),

  // ─── 蓝图编辑 MCP 往返：主进程 → 渲染进程 ───
  onBlueprintRequest: (callback: (requestId: string, op: string, params: any) => void) => {
    const handler = (_event: unknown, payload: { requestId: string; op: string; params?: any }) => {
      callback(payload.requestId, payload.op, payload.params ?? {})
    }
    ipcRenderer.on('blueprint-request', handler)
    return () => {
      ipcRenderer.removeListener('blueprint-request', handler)
    }
  },

  // ─── 蓝图编辑 MCP 往返：渲染进程 → 主进程（回传结果）───
  sendBlueprintResponse: (requestId: string, result: unknown) =>
    ipcRenderer.send('blueprint-response', { requestId, result }),

  // ─── AI 聊天：主进程 → 渲染进程 ───
  onAIChat: (callback: (requestId: string, message: string, history?: Array<{ role: string; content: string }>) => void) => {
    const handler = (_event: unknown, payload: { requestId: string; message: string; history?: Array<{ role: string; content: string }> }) => {
      callback(payload.requestId, payload.message, payload.history)
    }
    ipcRenderer.on('ai-chat', handler)
    return () => {
      ipcRenderer.removeListener('ai-chat', handler)
    }
  },

  // ─── AI 聊天：渲染进程 → 主进程（回传结果）───
  sendAIChatResponse: (requestId: string, result: unknown) =>
    ipcRenderer.send('ai-chat-response', { requestId, result }),

  // ─── 扫描工程目录 ───
  discoverProjectsScan: () => ipcRenderer.invoke('discover-projects'),

  // ─── 列出项目资产文件（排除代码）───
  listProjectAssets: (folder: string) => ipcRenderer.invoke('list-project-assets', folder),

  // ─── 列出工程源码文件（.ts/.tsx，排除 .d.ts；codeLint 用）───
  listProjectSrc: (folder: string) => ipcRenderer.invoke('list-project-src', folder),

  // ─── 读取文本文件（codeLint 源码扫描用）───
  readTextFile: (relativePath: string) => ipcRenderer.invoke('read-text-file', relativePath),

  // ─── 工程目录监听：文件变化通知（资产→AssetLint / 源码→codeLint，替代定时轮询）───
  watchProjectAssets: (folder: string) => ipcRenderer.invoke('watch-project-assets', folder),
  stopWatchProjectAssets: () => ipcRenderer.invoke('stop-watch-project-assets'),
  onAssetChanged: (callback: (folder: string) => void) => {
    const handler = (_event: unknown, payload: { folder: string }) => callback(payload?.folder)
    ipcRenderer.on('asset-changed', handler)
    return () => {
      ipcRenderer.removeListener('asset-changed', handler)
    }
  },
  onSrcChanged: (callback: (folder: string) => void) => {
    const handler = (_event: unknown, payload: { folder: string }) => callback(payload?.folder)
    ipcRenderer.on('src-changed', handler)
    return () => {
      ipcRenderer.removeListener('src-changed', handler)
    }
  },

  // ─── DSH 服务状态（让 AgentPanel 能拿到 DSH 端口/IPC）───
  dshStatus: () => ipcRenderer.invoke('dsh-status'),

  // ─── DSH RPC 代理（绕过 CORS，通过 main 进程转发到 DSH :3080）───
  dshRpc: (method: string, payload: unknown) => ipcRenderer.invoke('dsh-rpc', method, payload),

  // ─── DSH Mux WS 下行桥（question/requested 等事件帧推送） ───
  dshMuxConnect: () => ipcRenderer.invoke('dsh-mux-connect'),
  dshMuxDisconnect: () => ipcRenderer.invoke('dsh-mux-disconnect'),
  onDshMuxFrame: (callback: (frame: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, frame: unknown) => callback(frame)
    ipcRenderer.on('dsh-mux-frame', handler)
    return () => { ipcRenderer.removeListener('dsh-mux-frame', handler) }
  },

  // DSH Respond 代理（client-response 信封，用于 question 回答）
  dshRespond: (message: unknown) => ipcRenderer.invoke('dsh-respond', message),

  // DSH 手动重启（degraded 终态的恢复入口）
  dshRestart: () => ipcRenderer.invoke('dsh-restart'),

  // Agent 独立窗口（编辑器自身 AgentUI 全屏承载，单例；随主窗口关闭级联关闭）
  dshOpenAgentWindow: () => ipcRenderer.invoke('dsh-open-agent-window'),

  // DSH 内核版本管理
  dshListVersions: () => ipcRenderer.invoke('dsh-list-versions'),
  dshSwitchVersion: (target: string) => ipcRenderer.invoke('dsh-switch-version', target),
  // DSH 更新进度事件推送
  onDshUpdateProgress: (callback: (progress: { step: string; detail?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: { step: string; detail?: string }) => callback(progress)
    ipcRenderer.on('dsh-update-progress', handler)
    return () => { ipcRenderer.removeListener('dsh-update-progress', handler) }
  },
})
