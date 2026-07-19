/**
 * MockElectronAPI — 浏览器调试模式 Electron API 替代层
 *
 * 当 electronAPI 不可用时（纯浏览器开发模式），
 * 使用 import.meta.glob 预加载所有工程 JSON 和场景 JSON，
 * 提供与 Electron IPC 完全兼容的 Mock 实现。
 *
 * 特性：
 *  - discoverProjectsScan() → 自动扫描 src/projects/*\/project.json
 *  - readJsonFile(path)   → 返回预加载的场景/配置 JSON
 *  - LogFile 写入         → console 输出
 *  - 存档系统             → localStorage
 *
 * 用法：在 main.tsx 最顶部调用 injectMockElectronAPI()，
 *       仅在 window.electronAPI 不存在时生效。
 */
import type { ElectronAPI } from '../types/electron'

// ─── 预加载所有工程/场景 JSON（import.meta.glob eager） ───

const projectJsonModules = import.meta.glob<Record<string, unknown>>(
  '../projects/*/project.json',
  { eager: true, import: 'default' },
)

const sceneJsonModules = import.meta.glob<Record<string, unknown>>(
  '../projects/**/*.scene.json',
  { eager: true, import: 'default' },
)

// ─── 构建 JSON 路径 → 内容映射 ───

const jsonCache = new Map<string, unknown>()

function normalizePath(globPath: string): string {
  // import.meta.glob 返回 key 如 "../projects/fish/project.json"
  // readJsonFile 期望的路径如 "src/projects/fish/asset/fish_menu.scene.json"
  // 将 glob key 映射到 src/ 开头的路径
  return globPath.replace(/^\.\.\//, 'src/')
}

// 注册所有 project.json
for (const [key, data] of Object.entries(projectJsonModules)) {
  jsonCache.set(normalizePath(key), data)
}

// 注册所有 scene.json
for (const [key, data] of Object.entries(sceneJsonModules)) {
  jsonCache.set(normalizePath(key), data)
}

// ─── 工程发现（从 project.json 提取元数据） ───

interface ProjectMeta {
  name: string
  description: string
  version: string
  tags: string[]
  folder: string
  renderMode?: '2d' | '3d'
  defaultScene?: string
}

function scanProjects(): ProjectMeta[] {
  const projects: ProjectMeta[] = []
  for (const [key, data] of Object.entries(projectJsonModules)) {
    const d = data as Record<string, unknown>
    // key 如 "../projects/fish/project.json" → folder = "fish"
    const match = key.match(/\.\.\/projects\/([^/]+)\/project\.json$/)
    const folder = match?.[1] ?? ''
    projects.push({
      name: (d.name as string) ?? folder,
      description: (d.description as string) ?? '',
      version: (d.version as string) ?? '1.0.0',
      tags: Array.isArray(d.tags) ? d.tags as string[] : [],
      folder,
      renderMode: (d.renderMode as '2d' | '3d') ?? undefined,
      defaultScene: (d.defaultScene as string) ?? undefined,
    })
  }
  return projects
}

// ─── localStorage 存档辅助 ───

const SAVE_PREFIX = 'mock_save_'

function saveKey(game: string, slot: string): string {
  return `${SAVE_PREFIX}${game}_${slot}`
}

// ─── Mock API 实现 ───

const mockAPI: ElectronAPI = {
  getAppInfo: async () => ({
    version: '5.0.0-dev',
    name: 'DemoStudio (Browser Mock)',
    platform: 'browser',
    isDev: true,
  }),

  openFileDialog: async () => ({ canceled: true }),

  saveFileDialog: async () => ({ canceled: true }),

  showMessageBox: async () => ({ response: 0 }),

  onMenuAction: () => (() => {}),

  onGameInput: () => (() => {}),

  onMCPCommand: () => (() => {}),

  reportGameState: async () => {},

  sendAppReady: () => {},

  writeLogFile: async (level: string, message: string) => {
    console.log(`[MockLog:${level}] ${message}`)
  },

  readLogFile: async (options?: { tail?: number }) => {
    const lines = [
      '[Mock] DemoStudio Editor v5.0.0 已启动 (Browser Mode)',
      '[Mock] 所有功能均使用 import.meta.glob 预加载数据',
    ]
    return lines.join('\n')
  },

  toggleDevTools: async () => {
    console.log('[Mock] toggleDevTools — 在浏览器中按 F12 打开开发者工具')
  },

  createProject: async (_projectName: string, _mode?: '2d' | '3d') => {
    return { success: false, error: 'Browser mode: createProject not available' }
  },

  readJsonFile: async (relativePath: string) => {
    // 尝试直接命中缓存
    if (jsonCache.has(relativePath)) {
      return { success: true, data: jsonCache.get(relativePath) }
    }
    // 尝试相对于 src/ 的路径（去除前导 src/ 再匹配）
    const altPath = relativePath.replace(/^src\//, '')
    for (const [key, data] of jsonCache.entries()) {
      if (key.endsWith(altPath) || key === relativePath) {
        return { success: true, data }
      }
    }
    // 回退：通过 fetch 尝试加载（用于非预缓存的 JSON）
    try {
      const resp = await fetch(`/${relativePath}`)
      if (resp.ok) {
        const data = await resp.json()
        jsonCache.set(relativePath, data)
        return { success: true, data }
      }
    } catch { /* ignore */ }
    return { success: false, error: `Mock: file not found: ${relativePath}` }
  },

  discoverProjectsScan: async () => {
    return scanProjects()
  },

  // ─── 存档系统（localStorage） ───

  saveGameFile: async (game: string, slot: string, data: unknown) => {
    try {
      const savedAt = new Date().toISOString()
      const record = { data, savedAt }
      localStorage.setItem(saveKey(game, slot), JSON.stringify(record))
      return { success: true, savedAt }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  },

  loadGameFile: async (game: string, slot: string) => {
    try {
      const raw = localStorage.getItem(saveKey(game, slot))
      if (!raw) return { success: false, error: 'No save found' }
      const record = JSON.parse(raw)
      return { success: true, data: record.data }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  },

  listGameSaves: async (game: string) => {
    const saves: Array<{
      slot: string
      meta: {
        formatVersion: number
        game: string
        gameVersion?: string
        slot: string
        savedAt: string
        score: number
        phase?: string
        label?: string
      }
    }> = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(`${SAVE_PREFIX}${game}_`)) continue
      try {
        const raw = localStorage.getItem(key)
        if (!raw) continue
        const record = JSON.parse(raw)
        const meta = (record.data as any)?.meta
        saves.push({
          slot: key.replace(`${SAVE_PREFIX}${game}_`, ''),
          meta: {
            formatVersion: meta?.formatVersion ?? 1,
            game,
            gameVersion: meta?.gameVersion,
            slot: meta?.slot ?? 'quick',
            savedAt: record.savedAt ?? new Date().toISOString(),
            score: meta?.score ?? 0,
            phase: meta?.phase,
            label: meta?.label,
          },
        })
      } catch { /* ignore corrupt */ }
    }
    return saves
  },

  deleteGameSave: async (game: string, slot: string) => {
    localStorage.removeItem(saveKey(game, slot))
    return { success: true }
  },
}

// ─── 注入入口 ───

/**
 * 在浏览器环境中注入 Mock ElectronAPI。
 * 仅在 window.electronAPI 未定义时生效。
 * 应在 main.tsx 渲染前调用。
 */
export function injectMockElectronAPI(): void {
  if (typeof window === 'undefined') return
  if (window.electronAPI) return // Electron 环境，不做注入

  ;(window as any).electronAPI = mockAPI
  console.log(
    `[MockElectronAPI] 已注入 Mock API，预加载了 ${jsonCache.size} 个 JSON 文件，` +
    `发现 ${scanProjects().length} 个工程项目`,
  )
}

/**
 * 清除所有 Mock 存档（用于测试重置）
 */
export function clearMockSaves(): void {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(SAVE_PREFIX)) keys.push(key)
  }
  keys.forEach((k) => localStorage.removeItem(k))
  console.log(`[MockElectronAPI] 已清除 ${keys.length} 个 Mock 存档`)
}
