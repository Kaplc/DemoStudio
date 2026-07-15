export interface ElectronAPI {
  getAppInfo: () => Promise<{
    version: string
    name: string
    platform: string
    isDev: boolean
  }>
  openFileDialog: (options: any) => Promise<any>
  saveFileDialog: (options: any) => Promise<any>
  showMessageBox: (options: any) => Promise<any>
  onMenuAction: (callback: (action: string) => void) => () => void
  onGameInput: (callback: (key: string) => void) => () => void
  onMCPCommand: (callback: (command: string, params: any) => void) => () => void
  reportGameState: (state: { running: boolean; score?: number }) => Promise<void>
  sendAppReady: () => void
  writeLogFile: (level: string, message: string) => Promise<void>
  readLogFile: (options?: { tail?: number }) => Promise<string>
  toggleDevTools?: () => Promise<void>
  createProject: (projectName: string) => Promise<{ success: boolean; error?: string; path?: string }>
  discoverProjectsScan: () => Promise<Array<{ name: string; description: string; version: string; tags: string[]; folder: string }>>
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
