/**
 * DemoStudio Electron 主进程
 * 管理窗口生命周期、IPC 通信、原生菜单
 */
import { app, BrowserWindow, ipcMain, Menu, dialog } from 'electron'
import path from 'path'
import fs from 'fs'
import http from 'http'

let mainWindow: BrowserWindow | null = null
let _gameRunning = false
let _gameScore = 0

const isDev = !app.isPackaged

const LOG_DIR = isDev
  ? path.join(__dirname, '..', 'logs')       // 开发 → 项目根目录/logs/
  : path.join(app.getPath('userData'), 'logs') // 生产 → userData/logs/

const CONSOLE_LOG_FILE = path.join(LOG_DIR, 'console.log')

function createWindow() {
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
    show: false,
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

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

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
  createWindow()
  startMCPServer()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
