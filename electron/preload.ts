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
  onMCPCommand: (callback: (command: string, params: any) => void) => {
    ipcRenderer.on('mcp-command', (_event, data: { command: string; params?: any }) => {
      callback(data.command, data.params)
    })
    return () => {
      ipcRenderer.removeAllListeners('mcp-command')
    }
  },

  // ─── 日志 ───
  writeLogFile: (level: string, message: string) =>
    ipcRenderer.invoke('write-log-file', level, message),
  readLogFile: (options?: { tail?: number }) =>
    ipcRenderer.invoke('read-log-file', options),

  // ─── MCP 报告游戏状态 ───
  reportGameState: (state: { running: boolean; score?: number }) =>
    ipcRenderer.invoke('mcp-report-state', state),

  // ─── DevTools ───
  toggleDevTools: () => ipcRenderer.invoke('toggle-dev-tools'),

  // ─── 创建工程 ───
  createProject: (projectName: string) => ipcRenderer.invoke('create-project', projectName),

  // ─── 读取 JSON 文件（场景资产）───
  readJsonFile: (relativePath: string) => ipcRenderer.invoke('read-json-file', relativePath),

  // ─── 扫描工程目录 ───
  discoverProjectsScan: () => ipcRenderer.invoke('discover-projects'),
})
