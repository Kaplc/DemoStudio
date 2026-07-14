/**
 * DemoStudio Preload 脚本
 * 通过 contextBridge 暴露安全的 IPC API 给渲染进程
 */
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // ─── 应用信息 ───
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),

  // ─── 文件对话框 ───
  openFileDialog: (options: any) => ipcRenderer.invoke('open-file-dialog', options),
  saveFileDialog: (options: any) => ipcRenderer.invoke('save-file-dialog', options),
  showMessageBox: (options: any) => ipcRenderer.invoke('show-message-box', options),

  // ─── 菜单事件 ───
  onMenuAction: (callback: (action: string) => void) => {
    ipcRenderer.on('menu-action', (_event, action: string) => callback(action))
    return () => {
      ipcRenderer.removeAllListeners('menu-action')
    }
  },
})
