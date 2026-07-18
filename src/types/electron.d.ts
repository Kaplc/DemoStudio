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
  createProject: (projectName: string, mode?: '2d' | '3d') => Promise<{ success: boolean; error?: string; path?: string }>
  readJsonFile: (relativePath: string) => Promise<{ success: boolean; data?: any; error?: string }>
  discoverProjectsScan: () => Promise<Array<{ name: string; description: string; version: string; tags: string[]; folder: string; renderMode?: '2d' | '3d'; defaultScene?: string }>>

  // ─── 存档系统（userData-scoped；meta 结构与 ISaveData.SaveMeta 对齐）───
  saveGameFile: (game: string, slot: string, data: unknown) => Promise<{ success: boolean; error?: string; savedAt?: string }>
  loadGameFile: (game: string, slot: string) => Promise<{ success: boolean; data?: any; error?: string }>
  listGameSaves: (game: string) => Promise<Array<{
    slot: string
    meta: {
      formatVersion: number; game: string; gameVersion?: string
      slot: string; savedAt: string; score: number; phase?: string; label?: string
    }
  }>>
  deleteGameSave: (game: string, slot: string) => Promise<{ success: boolean; error?: string }>
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
