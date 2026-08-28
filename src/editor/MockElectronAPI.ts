/// <reference types="vite/client" />

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

const blueprintJsonModules = import.meta.glob<Record<string, unknown>>(
  '../projects/**/*.blueprint.json',
  { eager: true, import: 'default' },
)

const widgetJsonModules = import.meta.glob<Record<string, unknown>>(
  '../projects/**/*.widget.json',
  { eager: true, import: 'default' },
)

const configJsonModules = import.meta.glob<Record<string, unknown>>(
  '../projects/**/{*.config.json,*.table.json}',
  { eager: true, import: 'default' },
)

// 所有项目文件路径（仅取 glob keys，不 import 内容；供 listProjectAssets 列资产用）
const allFileKeys = Object.keys(import.meta.glob('../projects/**/*.*'))

// 源码原始文本映射（codeLint readTextFile 用）：?raw 的 default 导出即文件内容字符串（纯文本）。
// 注意：不能 fetch('/path?raw') —— Vite dev 对 .ts 的 ?raw 响应是模块代码（export default "..." 包装），
// 而非纯文本；import.meta.glob 的 loader 在运行时解析模块取 default，才是真实文件内容。
const rawSrcModules = import.meta.glob<string>('../projects/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
})

/** 代码扩展名（列资产时排除） */
const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.d.ts']

// ─── 构建 JSON 路径 → 内容映射 ───

const jsonCache = new Map<string, unknown>()

function normalizePath(globPath: string): string {
  // import.meta.glob 返回 key 如 "../projects/fish/project.json"
  // readJsonFile 期望的路径如 "src/projects/fish/asset/fish_menu.scene.json"
  // Windows 上 glob key 可能含反斜杠 \，统一转正斜杠再处理
  return globPath.replace(/\\/g, '/').replace(/^\.\.\//, 'src/')
}

// 注册所有 project.json
for (const [key, data] of Object.entries(projectJsonModules)) {
  jsonCache.set(normalizePath(key), data)
}

// 注册所有 scene.json
for (const [key, data] of Object.entries(sceneJsonModules)) {
  jsonCache.set(normalizePath(key), data)
}

// 注册所有 blueprint.json（运行时由 register.ts 注册到 BlueprintRegistry，
// 此处预加载供编辑器 readJsonFile 读取蓝图资产）
for (const [key, data] of Object.entries(blueprintJsonModules)) {
  jsonCache.set(normalizePath(key), data)
}

// 注册所有 widget.json（UI widget 蓝图）
for (const [key, data] of Object.entries(widgetJsonModules)) {
  jsonCache.set(normalizePath(key), data)
}

// 注册所有 config.json / table.json（配置表：ConfigRegistry 经 readJsonFile 读取）
for (const [key, data] of Object.entries(configJsonModules)) {
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

// ─── Mock API 实现 ───

const mockAPI = {
  getAppInfo: async () => ({
    version: '5.0.0-dev',
    name: 'DemoStudio (Browser Mock)',
    platform: 'browser',
    isDev: true,
    // 真实值由 vite define 在构建/开发期注入（Electron 模式下本 mock 不生效，
    // 走 main 进程 get-app-info 提供同一字段）
    appRoot: __DEMOSTUDIO_ROOT__,
  }),

  openFileDialog: async () => ({ canceled: true }),

  saveFileDialog: async () => ({ canceled: true }),

  showMessageBox: async () => ({ response: 0 }),

  onMenuAction: () => (() => {}),

  onGameInput: () => (() => {}),

  onMCPCommand: () => (() => {}),

  sendMCPResponse: () => {},

  reportGameState: async () => {},

  sendAppReady: () => {},

  writeLogFile: async (level: string, message: string) => {
    console.log(`[MockLog:${level}] ${message}`)
  },

  startGameLog: async (projectName?: string) => {
    console.log(`[Mock] startGameLog${projectName ? `: ${projectName}` : ''} — browser mode, no file`)
    return null
  },

  writeGameLog: async (level: string, message: string) => {
    console.log(`[MockGameLog:${level}] ${message}`)
  },

  stopGameLog: async () => {
    console.log('[Mock] stopGameLog — browser mode, no file')
  },

  readLogFile: async (options?: { tail?: number }) => {
    // 浏览器调试模式：返回中性启动日志（不含伪造 ERROR/WARN，避免误导状态栏报错面板）
    const iso = new Date().toISOString()
    const lines = [
      `[${iso}][INFO][DemoStudio] DemoStudio Editor v0.1.0 已启动 (Browser Mode)`,
      `[${iso}][INFO][DemoStudio] 所有功能均使用 import.meta.glob 预加载数据`,
      `[${iso}][INFO][DemoStudio] [World] 等待选择工程...`,
    ]
    const result = options?.tail ? lines.slice(-options.tail) : lines
    return result.join('\n')
  },

  toggleDevTools: async () => {
    console.log('[Mock] toggleDevTools — 在浏览器中按 F12 打开开发者工具')
  },

  createProject: async (_projectName: string, _mode?: '2d' | '3d') => {
    // 浏览器调试模式：不实际创建文件，仅返回成功让 UI 走完创建流程
    console.log(`[Mock] createProject: "${_projectName}" (${_mode ?? '3d'}) — browser mode, skipping file creation`)
    return { success: true }
  },

  readJsonFile: async (relativePath: string) => {
    // 深拷贝返回，模拟真实 Electron IPC 序列化（防止调用方原地修改污染内存缓存）
    const clone = (v: unknown) => JSON.parse(JSON.stringify(v)) as unknown
    // 尝试直接命中缓存
    if (jsonCache.has(relativePath)) {
      return { success: true, data: clone(jsonCache.get(relativePath)) }
    }
    // 尝试相对于 src/ 的路径（去除前导 src/ 再匹配）
    const altPath = relativePath.replace(/^src\//, '')
    for (const [key, data] of jsonCache.entries()) {
      if (key.endsWith(altPath) || key === relativePath) {
        return { success: true, data: clone(data) }
      }
    }
    // 回退：通过 fetch 尝试加载（用于非预缓存的 JSON）
    try {
      const resp = await fetch(`/${relativePath}`)
      if (resp.ok) {
        const data = await resp.json()
        jsonCache.set(relativePath, data)
        return { success: true, data: clone(data) }
      }
    } catch { /* ignore */ }
    return { success: false, error: `Mock: file not found: ${relativePath}` }
  },

  writeJsonFile: async (relativePath: string, data: unknown) => {
    // 浏览器调试模式：写回内存缓存，使后续 readJsonFile 反映编辑（不落盘）
    if (typeof relativePath !== 'string' || !relativePath) {
      return { success: false, error: 'relativePath 必须是非空字符串' }
    }
    jsonCache.set(relativePath, data)
    console.log(`[Mock] writeJsonFile: ${relativePath}（仅写入内存缓存）`)
    return { success: true }
  },

  onBlueprintRequest: () => (() => { /* 浏览器调试模式无外部 MCP，忽略 */ }),

  sendBlueprintResponse: () => { /* no-op */ },

  discoverProjectsScan: async () => {
    return scanProjects()
  },

  listProjectAssets: async (folder: string) => {
    const prefix = `../projects/${folder}/asset/`
    const result: Array<{ path: string; ext: string; size: number }> = []
    for (const key of allFileKeys) {
      if (!key.startsWith(prefix)) continue
      const filename = key.slice(key.lastIndexOf('/') + 1)
      const dotIdx = filename.lastIndexOf('.')
      const ext = dotIdx >= 0 ? filename.slice(dotIdx).toLowerCase() : ''
      if (CODE_EXTENSIONS.includes(ext)) continue
      result.push({ path: normalizePath(key), ext, size: 0 })
    }
    return result
  },

  // 浏览器 Mock 无真实文件监听：watch 失败、onAssetChanged 永不触发
  watchProjectAssets: async () => ({ ok: false }),
  stopWatchProjectAssets: async () => ({ ok: false }),
  onAssetChanged: () => (() => {}),

  // ─── 源码扫描（codeLint；与 Electron 主进程同签名同语义）───

  listProjectSrc: async (folder: string) => {
    // 复用既有 allFileKeys（keys-only glob）按 folder 前缀过滤，不新增模块注册
    const prefix = `../projects/${folder}/`
    const result: string[] = []
    for (const key of allFileKeys) {
      if (!key.startsWith(prefix)) continue
      if (!/\.(ts|tsx)$/i.test(key)) continue
      if (/\.d\.ts$/i.test(key)) continue // 排除声明文件
      result.push(normalizePath(key)) // src/... 形式，与 Electron 通道一致
    }
    return result
  },

  readTextFile: async (relativePath: string) => {
    // 路径归一化为 glob key（src/projects/... → ../projects/...）
    const key = relativePath.replace(/^src\//, '../')
    const loader = rawSrcModules[key]
    if (loader) {
      try {
        return { success: true, data: await loader() }
      } catch (err) {
        return { success: false, error: `Mock: 读取失败: ${String(err)}` }
      }
    }
    return { success: false, error: `Mock: file not found: ${relativePath}` }
  },

  // 浏览器 Mock 无真实文件监听：onSrcChanged 永不触发
  onSrcChanged: () => (() => {}),

  // ─── AI 聊天 ───

  onAIChat: (callback: (requestId: string, message: string, history?: Array<{ role: string; content: string }>) => void) => {
    // Mock 实现：在浏览器模式下不处理
    return () => {}
  },

  sendAIChatResponse: (requestId: string, result: unknown) => {
    // Mock 实现：在浏览器模式下不处理
  },
  // DSH 相关方法不提供 → AgentService 回退到直接 fetch('/api/...')（Vite 代理到 DSH :3080）
} as unknown as ElectronAPI

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
