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
import { normalizeGlobPath } from './mockPath'
import { scanProjectsFrom } from './mockProjectScan'

// ─── 预加载所有工程/场景 JSON（import.meta.glob eager） ───
// 双工程根：内置 src/projects/*（相对本目录 ../projects/）+ 外部 projects/*（相对本目录 ../../projects/）
// 外部根可能不存在 → glob 用 <root>/{,**/} 兼容形态，目录不存在时匹配为空

const projectJsonModules = import.meta.glob<Record<string, unknown>>(
  ['../projects/*/project.json', '../../projects/*/project.json'],
  { eager: true, import: 'default' },
)

const sceneJsonModules = import.meta.glob<Record<string, unknown>>(
  ['../projects/**/*.scene.json', '../../projects/**/*.scene.json'],
  { eager: true, import: 'default' },
)

const blueprintJsonModules = import.meta.glob<Record<string, unknown>>(
  ['../projects/**/*.blueprint.json', '../../projects/**/*.blueprint.json'],
  { eager: true, import: 'default' },
)

const widgetJsonModules = import.meta.glob<Record<string, unknown>>(
  ['../projects/**/*.widget.json', '../../projects/**/*.widget.json'],
  { eager: true, import: 'default' },
)

const configJsonModules = import.meta.glob<Record<string, unknown>>(
  ['../projects/**/{*.config.json,*.table.json}', '../../projects/**/{*.config.json,*.table.json}'],
  { eager: true, import: 'default' },
)

// 所有项目文件路径（仅取 glob keys，不 import 内容；供 listProjectAssets 列资产用）
const allFileKeys = Object.keys(import.meta.glob(
  ['../projects/**/*.*', '../../projects/**/*.*'],
))

// 源码原始文本映射（codeLint readTextFile 用）：?raw 的 default 导出即文件内容字符串（纯文本）。
// 注意：不能 fetch('/path?raw') —— Vite dev 对 .ts 的 ?raw 响应是模块代码（export default "..." 包装），
// 而非纯文本；import.meta.glob 的 loader 在运行时解析模块取 default，才是真实文件内容。
const rawSrcModules = import.meta.glob<string>(
  ['../projects/**/*.{ts,tsx,html}', '../../projects/**/*.{ts,tsx,html}'],
  { query: '?raw', import: 'default' },
)

/** 代码扩展名（列资产时排除） */
const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.d.ts']

// ─── 构建 JSON 路径 → 内容映射 ───

const jsonCache = new Map<string, unknown>()

// 文本文件缓存（writeTextFile 用：浏览器调试模式 HTML 源回写仅入内存，不落盘）
const textCache = new Map<string, string>()

function normalizePath(globPath: string): string {
  // 双前缀翻译（tests/externalRoots.test.ts 锁定）：
  //   "../../projects/foo/..."（外部工程）→ "projects/foo/..."
  //   "../projects/fish/..."（内置工程）  → "src/projects/fish/..."
  // Windows 上 glob key 可能含反斜杠 \，统一转正斜杠再处理
  return normalizeGlobPath(globPath)
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
  /** 工程轨道（外部根目录工程支持）：builtin=内置案例，external=外部工程 */
  source: 'builtin' | 'external'
}

function scanProjects(): ProjectMeta[] {
  // 双前缀 key 都能被发现（内置 ../projects/ + 外部 ../../projects/），带 source 字段
  return scanProjectsFrom(Object.entries(projectJsonModules)) as ProjectMeta[]
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

  writeTextFile: async (relativePath: string, content: string) => {
    // 浏览器调试模式：HTML 源回写仅入内存缓存（vite dev server 不提供任意文件写）
    if (typeof relativePath !== 'string' || !relativePath) {
      return { success: false, error: 'relativePath 必须是非空字符串' }
    }
    textCache.set(relativePath, content)
    console.log(`[Mock] writeTextFile: ${relativePath}（仅写入内存缓存）`)
    return { success: true }
  },

  onBlueprintRequest: () => (() => { /* 浏览器调试模式无外部 MCP，忽略 */ }),

  sendBlueprintResponse: () => { /* no-op */ },

  discoverProjectsScan: async () => {
    return scanProjects()
  },

  listProjectAssets: async (folder: string) => {
    // 双工程根前缀：内置 ../projects/<folder>/ + 外部 ../../projects/<folder>/
    const prefixes = [`../projects/${folder}/asset/`, `../../projects/${folder}/asset/`]
    const result: Array<{ path: string; ext: string; size: number }> = []
    for (const key of allFileKeys) {
      if (!prefixes.some(p => key.startsWith(p))) continue
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

  // ─── 资产文件操作（浏览器 Mock：delete/rename 只操作内存缓存与 glob 键映射）───
  assetFileOps: async (op: 'delete' | 'rename' | 'reveal' | 'copy-path', path: string, newName?: string) => {
    if (op === 'delete') {
      jsonCache.delete(path)
      console.log(`[Mock] assetFileOps.delete: ${path}（内存缓存）`)
      return { success: true }
    }
    if (op === 'rename') {
      const data = jsonCache.get(path)
      const dir = path.slice(0, path.lastIndexOf('/') + 1)
      const target = `${dir}${newName}`
      if (!data || jsonCache.has(target)) return { success: false, error: '重命名失败：目标已存在或源未缓存' }
      jsonCache.delete(path)
      jsonCache.set(target, data)
      console.log(`[Mock] assetFileOps.rename: ${path} → ${target}（内存缓存）`)
      return { success: true }
    }
    if (op === 'copy-path') {
      // 浏览器模式无真实绝对路径，复制相对路径；localhost 属安全上下文，navigator.clipboard 可用
      try { await navigator.clipboard.writeText(path) } catch { /* 剪贴板不可用时静默跳过 */ }
      console.log(`[Mock] assetFileOps.copy-path: ${path}（相对路径）`)
      return { success: true }
    }
    console.log(`[Mock] assetFileOps.reveal: ${path} — browser mode`)
    return { success: true }
  },

  // ─── 源码扫描（codeLint；与 Electron 主进程同签名同语义）───

  listProjectSrc: async (folder: string) => {
    // 复用既有 allFileKeys（keys-only glob）按 folder 前缀过滤，不新增模块注册
    // 双工程根前缀：内置 ../projects/<folder>/ + 外部 ../../projects/<folder>/
    const prefixes = [`../projects/${folder}/`, `../../projects/${folder}/`]
    const result: string[] = []
    for (const key of allFileKeys) {
      if (!prefixes.some(p => key.startsWith(p))) continue
      if (!/\.(ts|tsx)$/i.test(key)) continue
      if (/\.d\.ts$/i.test(key)) continue // 排除声明文件
      result.push(normalizePath(key)) // src/... 形式，与 Electron 通道一致
    }
    return result
  },

  readTextFile: async (relativePath: string) => {
    // writeTextFile 写入的文本缓存优先（UI 源回写后再读的闭环）
    if (textCache.has(relativePath)) {
      return { success: true, data: textCache.get(relativePath)! }
    }
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
    // 兜底 fetch vite raw（注意：Vite dev 对 .html?raw 返回 react-refresh 包装的模块代码而非纯文本，
    // 因此 .html 必须走上方 rawSrcModules 通道；此处仅覆盖 ts/tsx 之外的其余文本类型）
    if (!/\.html?$/i.test(relativePath)) {
      try {
        const resp = await fetch(`/${relativePath.replace(/^src\//, '')}?raw`)
        if (resp.ok) {
          return { success: true, data: await resp.text() }
        }
      } catch { /* ignore */ }
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
  // Agent 窗口日志转发（浏览器 Mock 模式无跨窗口 IPC，直接丢弃）
  forwardAgentLog: () => {},
  onAgentLog: () => (() => {}),

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
