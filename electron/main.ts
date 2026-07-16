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

let mainWindow: BrowserWindow | null = null
let loadingWindow: BrowserWindow | null = null
let _gameRunning = false
let _gameScore = 0

const isDev = !app.isPackaged

const LOG_DIR = isDev
  ? path.join(__dirname, '..', 'logs')
  : path.join(app.getPath('userData'), 'logs')

// 每次启动生成独立的日志文件：console_2026-07-16_143025.log
const now = new Date()
const pad = (n: number) => String(n).padStart(2, '0')
const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
const CONSOLE_LOG_FILE = path.join(LOG_DIR, `console_${timestamp}.log`)

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
    mainWindow.loadURL('http://localhost:5173')
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

const VITE_URL = 'http://localhost:5173'
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

  // 2. 启动 MCP HTTP API
  startMCPServer()

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

// ─── 扫描工程目录 ───

ipcMain.handle('discover-projects', async () => {
  try {
    const projectsDir = path.join(__dirname, '..', 'src', 'projects')
    if (!fs.existsSync(projectsDir)) return []

    const entries = fs.readdirSync(projectsDir, { withFileTypes: true })
    const projects: Array<{ name: string; description: string; version: string; tags: string[]; folder: string; renderMode?: '2d' | '3d' }> = []

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

// ─── MCP 游戏状态 ───

ipcMain.handle('mcp-report-state', (_event, state: { running: boolean; score?: number }) => {
  _gameRunning = state.running
  if (state.score !== undefined) _gameScore = state.score
})

// ─── MCP HTTP API 服务器 ───
// 让 MCP 服务器 (editor/mcp-server.mjs) 可以通过 HTTP 控制编辑器

const MCP_API_PORT = 9877

interface MCPCommand {
  command: string
  params?: Record<string, any>
}

function startMCPServer() {
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
  })

  server.on('error', (err) => {
    console.error('[MCP-API] 服务器启动失败:', err.message)
  })
}

// ─── 应用生命周期 ───

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
