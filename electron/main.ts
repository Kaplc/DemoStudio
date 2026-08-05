/**
 * DemoStudio Electron 主进程
 * 管理窗口生命周期、IPC 通信、原生菜单
 *
 * 启动流程:
 *   1. 创建无边框加载窗口 (loading.html)
 *   2. 等待 Vite 开发服务器就绪 / 直接加载打包文件
 *   3. 关闭加载窗口，创建有边框编辑器主窗口
 *   4. 加载完成后 React LoadingScreen 自动淡出
 */
import { app, BrowserWindow, ipcMain, Menu, dialog } from 'electron'
import path from 'path'
import fs from 'fs'
import http from 'http'
import net from 'net'

let mainWindow: BrowserWindow | null = null
let loadingWindow: BrowserWindow | null = null
let _gameRunning = false
let _gameScore = 0

// ─── 蓝图编辑 MCP 往返：requestId → 待解析的 HTTP 响应 ───
let _blueprintReqSeq = 0
interface PendingBlueprintReq {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}
const _blueprintPending = new Map<string, PendingBlueprintReq>()
const BLUEPRINT_REQ_TIMEOUT = 20000 // 渲染进程处理超时（含文件 IO）

const isDev = !app.isPackaged

// ─── 多实例支持 ───
// 每个实例使用独立的磁盘缓存目录，避免多实例同时读写 GPU/磁盘缓存导致冲突
// （必须在 app ready 之前设置）
app.commandLine.appendSwitch(
  'disk-cache-dir',
  path.join(app.getPath('userData'), 'disk-cache', `instance-${process.pid}`)
)

// 开发服务器地址：vite-plugin-electron 会注入 VITE_DEV_SERVER_URL（包含实际端口，
// 多实例时 Vite 自动递增端口：5173 → 5174 → ...）
const VITE_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'

const LOG_DIR = isDev
  ? path.join(__dirname, '..', 'logs')
  : path.join(app.getPath('userData'), 'logs')

// 每次启动生成独立的日志文件：console_2026-07-16_143025.log
const now = new Date()
const pad = (n: number) => String(n).padStart(2, '0')
const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
const CONSOLE_LOG_FILE = path.join(LOG_DIR, `console_${timestamp}.log`)

// 滚动删除：最多保留 10 个 console_ 日志文件 + 10 个日期日志文件
const MAX_CONSOLE_LOG_FILES = 10
const MAX_DAILY_LOG_FILES = 10

function cleanOldLogs() {
  try {
    ensureLogDir()
    const files = fs.readdirSync(LOG_DIR)

    // 清理 console_ 日志（按修改时间排序，保留最新的 10 个）
    const consoleLogs = files
      .filter(f => f.startsWith('console_') && f.endsWith('.log'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(LOG_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
    if (consoleLogs.length > MAX_CONSOLE_LOG_FILES) {
      for (const f of consoleLogs.slice(MAX_CONSOLE_LOG_FILES)) {
        fs.unlinkSync(path.join(LOG_DIR, f.name))
      }
    }

    // 清理日期日志（YYYY-MM-DD.log，保留最新的 10 个）
    const dailyLogs = files
      .filter(f => /^\d{4}-\d{2}-\d{2}\.log$/.test(f))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(LOG_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
    if (dailyLogs.length > MAX_DAILY_LOG_FILES) {
      for (const f of dailyLogs.slice(MAX_DAILY_LOG_FILES)) {
        fs.unlinkSync(path.join(LOG_DIR, f.name))
      }
    }
  } catch { /* 日志清理失败不影响主流程 */ }
}

// 启动时执行一次日志清理
cleanOldLogs()

// ═══════════════════════════════════════
//  第一阶段：无边框加载窗口
// ═══════════════════════════════════════

function showLoadingWindow() {
  loadingWindow = new BrowserWindow({
    width: 480,
    height: 320,
    frame: false,
    resizable: false,
    center: true,
    backgroundColor: '#1a1a2e',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  loadingWindow.loadFile(path.join(__dirname, '../electron/loading.html'))

  loadingWindow.once('ready-to-show', () => {
    loadingWindow?.show()
  })

  loadingWindow.on('closed', () => {
    loadingWindow = null
  })
}

// ═══════════════════════════════════════
//  第二阶段：有边框编辑器主窗口
// ═══════════════════════════════════════

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1536,
    height: 864,
    minWidth: 1024,
    minHeight: 600,
    title: 'DemoStudio Editor',
    backgroundColor: '#1e1e1e',
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    frame: true,
    show: false, // 由 app-ready 控制显示
  })

  // 使用 React 自定义菜单栏，隐藏 Electron 原生菜单
  Menu.setApplicationMenu(null)

  // 加载应用
  if (isDev) {
    mainWindow.loadURL(VITE_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 将浏览器控制台输出重定向到文件日志
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const logLevel = ['verbose', 'info', 'warning', 'error'][level] || 'info'
    const now = new Date().toISOString()
    const lineStr = `[${now}][CONSOLE:${logLevel.toUpperCase()}] ${message} (${sourceId}:${line})\n`
    try {
      ensureLogDir()
      fs.appendFileSync(CONSOLE_LOG_FILE, lineStr, 'utf-8')
    } catch {}
  })

  // 拦截方向键：Chromium 会消费方向键使 JS 收不到
  // before-input-event 在 Chromium 处理之前触发 → 直接 executeJavaScript 手动派发
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(input.key)) {
      const now = new Date().toISOString()
      try {
        ensureLogDir()
        // 第1层 log：主进程收到
        fs.appendFileSync(CONSOLE_LOG_FILE, `[${now}][MAIN] before-input-event: ${input.key}\n`, 'utf-8')
      } catch {}
      mainWindow?.webContents.executeJavaScript(`
        console.log('[MAIN→RENDER] executeJavaScript: ${input.key}');
        var evt = new KeyboardEvent('keydown', { key: '${input.key}', bubbles: true, cancelable: true });
        document.dispatchEvent(evt);
      `).catch(() => {})
    }
  })
}

// ═══════════════════════════════════════
//  等待 Vite 开发服务器就绪
// ═══════════════════════════════════════

const VITE_POLL_INTERVAL = 300

async function waitForDevServer(): Promise<void> {
  return new Promise((resolve) => {
    const check = async () => {
      try {
        const resp = await fetch(VITE_URL, { signal: AbortSignal.timeout(1000) })
        if (resp.ok || resp.status === 304) {
          resolve()
          return
        }
      } catch {}
      setTimeout(check, VITE_POLL_INTERVAL)
    }
    check()
  })
}

// ═══════════════════════════════════════
//  启动流程
// ═══════════════════════════════════════

async function startApp() {
  // 1. 显示无边框加载窗口（持续可见直到编辑器就绪）
  showLoadingWindow()

  // 2. 启动 MCP HTTP API（多实例自动分配端口）
  await startMCPServer()

  // 3. 等待开发服务器就绪（开发模式）
  if (isDev) {
    await waitForDevServer()
  }

  // 4. 后台创建主窗口（不显示、不关闭加载窗口）
  createMainWindow()

  // 5. 等待渲染进程发来 app-ready 信号
  ipcMain.once('app-ready', () => {
    // 关闭加载窗口
    if (loadingWindow && !loadingWindow.isDestroyed()) {
      loadingWindow.close()
    }
    // 显示主窗口（延迟一帧确保首次渲染完成）
    setTimeout(() => {
      mainWindow?.show()
    }, 100)
  })
}

// ─── IPC 处理器 ───

ipcMain.handle('get-app-info', () => {
  return {
    version: app.getVersion(),
    name: app.name,
    platform: process.platform,
    isDev,
  }
})

ipcMain.handle('open-file-dialog', async (_event, options: Electron.OpenDialogOptions) => {
  const result = await dialog.showOpenDialog(mainWindow!, options)
  return result
})

ipcMain.handle('save-file-dialog', async (_event, options: Electron.SaveDialogOptions) => {
  const result = await dialog.showSaveDialog(mainWindow!, options)
  return result
})

ipcMain.handle('show-message-box', async (_event, options: Electron.MessageBoxOptions) => {
  const result = await dialog.showMessageBox(mainWindow!, options)
  return result
})

ipcMain.handle('toggle-dev-tools', () => {
  const win = BrowserWindow.getFocusedWindow()
  if (win) {
    win.webContents.toggleDevTools()
  }
})

// ─── 日志文件写入 ───

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true })
  }
}

function getLogFilePath(): string {
  const date = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  return path.join(LOG_DIR, `${date}.log`)
}

ipcMain.handle('write-log-file', async (_event, level: string, message: string) => {
  try {
    ensureLogDir()
    const filePath = getLogFilePath()
    const line = `${message}\n`
    fs.appendFileSync(filePath, line, 'utf-8')
  } catch (err) {
    console.error('日志写入失败:', err)
  }
})

// ─── 读取日志 ───

ipcMain.handle('read-log-file', async (_event, options?: { tail?: number }) => {
  try {
    const filePath = CONSOLE_LOG_FILE
    if (!fs.existsSync(filePath)) return '暂无日志'
    const content = fs.readFileSync(filePath, 'utf-8')
    if (options?.tail) {
      const lines = content.split('\n')
      return lines.slice(-options.tail).join('\n')
    }
    return content
  } catch (err) {
    console.error('日志读取失败:', err)
    return '日志读取失败'
  }
})

// ─── 创建工程 ───

ipcMain.handle('create-project', async (_event, projectName: string, mode: '2d' | '3d' = '3d') => {
  try {
    const projectDir = path.join(__dirname, '..', 'src', 'projects', projectName.toLowerCase())
    if (fs.existsSync(projectDir)) {
      return { success: false, error: `工程 "${projectName}" 已存在` }
    }

    // 创建目录
    fs.mkdirSync(projectDir, { recursive: true })

    // project.json（2D 工程写入 renderMode: "2d"，编辑器据此启用正交相机）
    const projectJson: Record<string, unknown> = {
      name: projectName,
      description: `${projectName} 游戏项目`,
      version: '1.0.0',
      main: `src/projects/${projectName.toLowerCase()}/index.ts`,
      tags: ['game', mode === '2d' ? '2d' : '3d'],
      renderMode: mode === '2d' ? '2d' : '3d',
      defaultScene: `src/projects/${projectName.toLowerCase()}/${projectName.toLowerCase()}.scene.json`,
    }
    fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify(projectJson, null, 2), 'utf-8')

    // index.ts（2D 给出正交相机 + Sprite 用法注释骨架，3D 维持空模板）
    const indexTs = mode === '2d'
      ? `/**
 * ${projectName} — 2D 游戏入口（自动生成）
 *
 * 2D 约定：物体放在 XY 平面（z=0），正交相机沿 +Z 朝 -Z 看，x→右、y→上。
 * 引擎已就绪的 2D 能力：
 *   - 正交相机： new CameraComponent(this, 'GameCamera', 'orthographic')
 *                cam.SetOrtho(size, near, far)  （size=半高世界单位）
 *   - 2D 精灵： new SpriteComponent(this, w, h)
 *               .setTexture(path) / .setColor(hex) / .setOpacity(o)
 *   - 声明式场景： scene.json 用 { "type": "sprite", "size": [w,h], "texture": "..." }
 *
 * 参照 src/projects/demo2d 实现 GameMode/GameInstance/Pawn，
 * 随后在 src/App.tsx 注册 WorldRegistry + GameFactoryRegistry。
 */
export { }
`
      : `/**
 * ${projectName} — 游戏入口
 * 自动生成的工程模板
 */
export { }
`
    fs.writeFileSync(path.join(projectDir, 'index.ts'), indexTs, 'utf-8')

    return { success: true, path: projectDir }
  } catch (err) {
    console.error('创建工程失败:', err)
    return { success: false, error: String(err) }
  }
})

// ─── 读取 JSON 文件（场景资产等）───

ipcMain.handle('read-json-file', async (_event, relativePath: string) => {
  try {
    const fullPath = path.join(__dirname, '..', relativePath)
    if (!fs.existsSync(fullPath)) {
      return { success: false, error: `文件不存在: ${relativePath}` }
    }
    const content = fs.readFileSync(fullPath, 'utf-8')
    return { success: true, data: JSON.parse(content) }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

// ─── 写入 JSON 文件（蓝图资产编辑等）───

ipcMain.handle('write-json-file', async (_event, relativePath: string, data: unknown) => {
  try {
    if (typeof relativePath !== 'string' || !relativePath) {
      return { success: false, error: 'relativePath 必须是非空字符串' }
    }
    // 仅允许 .json，防止误写代码文件
    if (!relativePath.toLowerCase().endsWith('.json')) {
      return { success: false, error: '仅允许写入 .json 文件' }
    }
    const baseDir = path.join(__dirname, '..')
    const fullPath = path.resolve(baseDir, relativePath)
    // 路径逃逸防护：解析后必须仍在 baseDir 内
    const rel = path.relative(baseDir, fullPath)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return { success: false, error: `非法路径: ${relativePath}` }
    }
    fs.mkdirSync(path.dirname(fullPath), { recursive: true })
    fs.writeFileSync(fullPath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
    return { success: true }
  } catch (err) {
    console.error('写入 JSON 失败:', err)
    return { success: false, error: String(err) }
  }
})

// ─── 扫描工程目录 ───

ipcMain.handle('discover-projects', async () => {
  try {
    const projectsDir = path.join(__dirname, '..', 'src', 'projects')
    if (!fs.existsSync(projectsDir)) return []

    const entries = fs.readdirSync(projectsDir, { withFileTypes: true })
    const projects: Array<{ name: string; description: string; version: string; tags: string[]; folder: string; renderMode?: '2d' | '3d'; defaultScene?: string }> = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const jsonPath = path.join(projectsDir, entry.name, 'project.json')
      if (!fs.existsSync(jsonPath)) continue
      try {
        const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
        projects.push({
          name: data.name || entry.name,
          description: data.description || '',
          version: data.version || '1.0.0',
          tags: data.tags || [],
          folder: entry.name,
          renderMode: data.renderMode === '2d' ? '2d' : '3d',
          defaultScene: data.defaultScene || undefined,
        })
      } catch {
        // 单个 project.json 解析失败不影响其他
      }
    }

    return projects
  } catch (err) {
    console.error('扫描工程目录失败:', err)
    return []
  }
})

// ─── 列出项目资产文件（递归，排除代码扩展名）───

const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.d.ts']

ipcMain.handle('list-project-assets', async (_event, folder: string) => {
  try {
    const projectRoot = path.join(__dirname, '..', 'src', 'projects', folder, 'asset')
    if (!fs.existsSync(projectRoot)) return []

    const rootAbs = path.join(__dirname, '..')
    const result: Array<{ path: string; ext: string; size: number }> = []

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
          continue
        }
        if (!entry.isFile()) continue
        const ext = path.extname(entry.name).toLowerCase()
        if (CODE_EXTENSIONS.includes(ext)) continue
        const rel = path.relative(rootAbs, full).replace(/\\/g, '/')
        let size = 0
        try { size = fs.statSync(full).size } catch { /* ignore */ }
        result.push({ path: rel, ext, size })
      }
    }
    walk(projectRoot)
    return result
  } catch (err) {
    console.error('列出项目资产失败:', err)
    return []
  }
})

// ─── 资产目录监听：文件变化时通知渲染进程（替代定时轮询）───

let assetWatcher: fs.FSWatcher | null = null
let assetWatchDebounce: NodeJS.Timeout | null = null

/** 开始监听某工程 asset 目录（覆盖上一次监听）。仅 *.scene.json / *.blueprint.json / *.widget.json 变化才通知。 */
ipcMain.handle('watch-project-assets', async (_event, folder: string) => {
  if (assetWatcher) {
    try { assetWatcher.close() } catch { /* ignore */ }
    assetWatcher = null
  }
  if (assetWatchDebounce) {
    clearTimeout(assetWatchDebounce)
    assetWatchDebounce = null
  }

  const projectRoot = path.join(__dirname, '..', 'src', 'projects', folder, 'asset')
  if (!fs.existsSync(projectRoot)) return { ok: false }
  try {
    assetWatcher = fs.watch(projectRoot, { recursive: true }, (_eventType, filename) => {
      if (!filename) return
      // 只关心场景/蓝图/widget 资产；代码/其它文件忽略
      if (!/\.(scene|blueprint|widget)\.json$/i.test(filename)) return
      // 去抖：编辑器保存常触发多次事件
      if (assetWatchDebounce) clearTimeout(assetWatchDebounce)
      assetWatchDebounce = setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('asset-changed', { folder })
        }
      }, 300)
    })
    return { ok: true }
  } catch (err) {
    console.error('监听资产目录失败:', err)
    return { ok: false }
  }
})

/** 停止资产目录监听（关闭工程/切换工程时调用）。 */
ipcMain.handle('stop-watch-project-assets', async () => {
  if (assetWatcher) {
    try { assetWatcher.close() } catch { /* ignore */ }
    assetWatcher = null
  }
  if (assetWatchDebounce) {
    clearTimeout(assetWatchDebounce)
    assetWatchDebounce = null
  }
  return { ok: true }
})

// ─── 存档系统（userData-scoped，跨重装保留）───

const SAVES_DIR = path.join(app.getPath('userData'), 'saves')
const saveDirOf = (game: string) => path.join(SAVES_DIR, game)
const savePathOf = (game: string, slot: string) => path.join(saveDirOf(game), `${slot}.json`)

ipcMain.handle('save-game-file', async (_event, game: string, slot: string, data: unknown) => {
  try {
    fs.mkdirSync(saveDirOf(game), { recursive: true })
    fs.writeFileSync(savePathOf(game, slot), JSON.stringify(data, null, 2), 'utf-8')
    return { success: true, savedAt: (data as any)?.meta?.savedAt }
  } catch (err) {
    console.error('写入存档失败:', err)
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('load-game-file', async (_event, game: string, slot: string) => {
  try {
    const p = savePathOf(game, slot)
    if (!fs.existsSync(p)) return { success: false, error: '存档不存在' }
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'))
    return { success: true, data }
  } catch (err) {
    console.error('读取存档失败:', err)
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('list-game-saves', async (_event, game: string) => {
  try {
    const dir = saveDirOf(game)
    if (!fs.existsSync(dir)) return []
    const result: Array<{ slot: string; meta: unknown }> = []
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))
        result.push({ slot: f.replace(/\.json$/, ''), meta: data.meta })
      } catch {
        // 单个存档文件损坏则跳过，不影响其余槽位
      }
    }
    return result
  } catch (err) {
    console.error('列出存档失败:', err)
    return []
  }
})

ipcMain.handle('delete-game-save', async (_event, game: string, slot: string) => {
  try {
    const p = savePathOf(game, slot)
    if (fs.existsSync(p)) fs.unlinkSync(p)
    return { success: true }
  } catch (err) {
    console.error('删除存档失败:', err)
    return { success: false, error: String(err) }
  }
})

// ─── MCP 游戏状态 ───

ipcMain.handle('mcp-report-state', (_event, state: { running: boolean; score?: number }) => {
  _gameRunning = state.running
  if (state.score !== undefined) _gameScore = state.score
})

// ─── 蓝图编辑 MCP 往返：渲染进程回传结果，解析挂起的 HTTP 响应 ───

ipcMain.on('blueprint-response', (_event, payload: { requestId: string; result: unknown }) => {
  const pending = _blueprintPending.get(payload.requestId)
  if (!pending) return // 超时或已清理
  clearTimeout(pending.timer)
  _blueprintPending.delete(payload.requestId)
  pending.resolve(payload.result)
})

// MCP 往返响应（renderer → main，ai_event 等往返请求回传）
ipcMain.on('mcp-response', (_event, payload: { requestId: string; result: unknown }) => {
  const pending = _blueprintPending.get(payload.requestId)
  if (!pending) return // 超时或已清理
  clearTimeout(pending.timer)
  _blueprintPending.delete(payload.requestId)
  pending.resolve(payload.result)
})

// ─── MCP HTTP API 服务器 ───
// 让 MCP 服务器 (editor/mcp-server.mjs) 可以通过 HTTP 控制编辑器
// 多实例支持：端口从 9877 开始自动寻找空闲端口（9877 → 9878 → ...）

const MCP_API_PORT_START = 9877
const MCP_API_PORT_MAX = 9927 // 最多尝试 50 个端口
let MCP_API_PORT = MCP_API_PORT_START

interface MCPCommand {
  command: string
  params?: Record<string, any>
}

/** 从 start 开始寻找第一个可监听的端口（用于多实例自动分配 MCP 端口） */
function findFreePort(start: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (port: number) => {
      if (port > MCP_API_PORT_MAX) {
        reject(new Error(`未找到可用端口（${MCP_API_PORT_START}-${MCP_API_PORT_MAX} 均被占用）`))
        return
      }
      const srv = net.createServer()
      srv.unref()
      srv.once('error', () => tryPort(port + 1))
      srv.listen(port, '127.0.0.1', () => {
        const addr = srv.address() as net.AddressInfo
        srv.close(() => resolve(addr.port))
      })
    }
    tryPort(start)
  })
}

async function startMCPServer() {
  // 多实例：当前实例端口 = 9877 + 已占用数量（自动递增）
  MCP_API_PORT = await findFreePort(MCP_API_PORT_START)
  const server = http.createServer((req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (req.method === 'POST' && req.url === '/api/command') {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        try {
          const cmd: MCPCommand = JSON.parse(body)
          // ai_event：往返模式，等渲染进程处理完回传结果（AI 需要拿到事件返回值）
          if (cmd.command === 'ai_event') {
            if (!mainWindow || mainWindow.isDestroyed()) {
              res.writeHead(503, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ status: 'error', message: '编辑器窗口不可用' }))
              return
            }
            const requestId = `ai-${++_blueprintReqSeq}`
            const timer = setTimeout(() => {
              if (_blueprintPending.delete(requestId)) {
                try {
                  res.writeHead(504, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ status: 'error', message: `编辑器处理超时 (${BLUEPRINT_REQ_TIMEOUT}ms)` }))
                } catch { /* response already closed */ }
              }
            }, BLUEPRINT_REQ_TIMEOUT)
            _blueprintPending.set(requestId, {
              resolve: (result) => {
                try {
                  res.writeHead(200, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify(result))
                } catch { /* response already closed */ }
              },
              reject: (err) => {
                try {
                  res.writeHead(500, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ status: 'error', message: String(err) }))
                } catch { /* ignore */ }
              },
              timer,
            })
            mainWindow.webContents.send('mcp-command', { ...cmd, requestId })
            return
          }
          // 发送 IPC 给渲染进程
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('mcp-command', cmd)
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'ok', command: cmd.command }))
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'error', message: String(err) }))
        }
      })
      return
    }

    // ─── 蓝图编辑（往返）：外部 AI 经 MCP 服务器调用，渲染进程处理后回传结果 ───
    if (req.method === 'POST' && req.url === '/api/blueprint') {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        try {
          const { op, params } = JSON.parse(body) as { op: string; params?: Record<string, unknown> }
          if (!mainWindow || mainWindow.isDestroyed()) {
            res.writeHead(503, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: '编辑器窗口不可用' }))
            return
          }
          const requestId = `bp-${++_blueprintReqSeq}`
          // 超时兜底：渲染进程未回传则返回 504，避免 HTTP 挂起
          const timer = setTimeout(() => {
            if (_blueprintPending.delete(requestId)) {
              try {
                res.writeHead(504, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: `编辑器处理超时 (${BLUEPRINT_REQ_TIMEOUT}ms)` }))
              } catch { /* response already closed */ }
            }
          }, BLUEPRINT_REQ_TIMEOUT)
          _blueprintPending.set(requestId, {
            resolve: (result) => {
              try {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify(result))
              } catch { /* response already closed */ }
            },
            reject: (err) => {
              try {
                res.writeHead(500, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: String(err) }))
              } catch { /* ignore */ }
            },
            timer,
          })
          mainWindow.webContents.send('blueprint-request', { requestId, op, params: params ?? {} })
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: String(err) }))
        }
      })
      return
    }

    // 蛇游戏详细状态查询（从渲染进程实时读取）
    if (req.method === 'GET' && req.url === '/api/game-state') {
      if (!mainWindow || mainWindow.isDestroyed()) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'error', message: '编辑器窗口不可用' }))
        return
      }
      mainWindow.webContents.executeJavaScript(
        'JSON.stringify((window as any).__snakeGameData || null)'
      ).then((result) => {
        const data = result ? JSON.parse(result) : null
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          status: 'ok',
          data,
        }))
      }).catch((err) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'error', message: String(err) }))
      })
      return
    }

    if (req.method === 'GET' && req.url === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        status: 'running',
        editor: 'DemoStudio Editor v4.0.0',
        platform: process.platform,
        gameRunning: _gameRunning,
        gameScore: _gameScore,
      }))
      return
    }

    // 获取浏览器控制台日志
    if (req.method === 'GET' && req.url === '/api/console-logs') {
      try {
        ensureLogDir()
        if (fs.existsSync(CONSOLE_LOG_FILE)) {
          const content = fs.readFileSync(CONSOLE_LOG_FILE, 'utf-8')
          const lines = content.split('\n').filter(Boolean).slice(-50) // 最近50条
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'ok', logs: lines }))
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'ok', logs: [] }))
        }
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'error', message: String(err) }))
      }
      return
    }

    res.writeHead(404)
    res.end('Not found')
  })

  server.listen(MCP_API_PORT, '127.0.0.1', () => {
    console.log(`[MCP-API] HTTP 服务器已启动: http://127.0.0.1:${MCP_API_PORT}`)
    if (MCP_API_PORT !== MCP_API_PORT_START) {
      console.log(`[MCP-API] 注意：${MCP_API_PORT_START} 已被其他实例占用，本实例使用端口 ${MCP_API_PORT}`)
    }
  })

  server.on('error', (err) => {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EADDRINUSE') {
      console.error(`[MCP-API] 端口 ${MCP_API_PORT} 被占用且自动递增也失败，请稍后重试或检查残留进程`)
    } else {
      console.error('[MCP-API] 服务器启动失败:', err.message)
    }
  })
}

// ─── 应用生命周期 ───

// 多实例支持：不申请单实例锁，允许多个编辑器实例同时运行
// Vite 端口 (5173+) 与 MCP 端口 (9877+) 均自动递增分配，互不冲突
app.whenReady().then(() => {
  startApp()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    startApp()
  }
})
