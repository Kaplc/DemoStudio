/**
 * DemoStudio Electron 主进程
 * 管理窗口生命周期、IPC 通信、原生菜单
 *
 * 启动流程:
 *   1. app 就绪后立即创建无边框加载窗口 (loading.html)，纯色底即时出窗
 *   2. 等待 Vite 开发服务器就绪 / 直接加载打包文件
 *   3. 就绪后关闭加载窗口，创建有边框编辑器主窗口
 *   4. 加载完成后 React LoadingScreen 自动淡出
 */
import { app, BrowserWindow, ipcMain, Menu, dialog, shell, clipboard } from 'electron'
import path from 'path'
import fs from 'fs'
import http from 'http'
import net from 'net'
import { spawn, exec, execSync, type ChildProcess } from 'child_process'

let mainWindow: BrowserWindow | null = null
let loadingWindow: BrowserWindow | null = null
let _gameRunning = false

// ─── DSH 服务管理（agent 常驻化：探测 → 认领 → 孤儿进程独立运行） ───
// 生命周期状态机：off → probing → claimed(复用旧实例) | spawning → running → restart-wait(自愈中) | degraded(自愈超限终态)
type DshLifecycle = 'off' | 'probing' | 'claimed' | 'spawning' | 'running' | 'restart-wait' | 'degraded'
let _dshLifecycle: DshLifecycle = 'off'
let _dshPort = 0
let _dshChild: ChildProcess | null = null   // 本实例 spawn 的 agent 子进程（认领的旧 agent 无此句柄）
let _dshShuttingDown = false                // 主动停机标志：抑制 exit 回调触发自愈
let _dshBootstrapInFlight = false           // 探测/spawn 流程防重入（activate 重复 startApp 场景）
let _dshRestartCount = 0                    // 自愈已重试次数
let _dshRestartTimer: NodeJS.Timeout | null = null
let _dshHeartbeatTimer: NodeJS.Timeout | null = null


const DSH_SOURCE_DIR = path.join(__dirname, '..', 'harness', 'dsh-source')

// 优先全局 npm 安装的 DSH
function getDshCliPath(): string {
  const candidates: string[] = []
  try {
    const { execSync } = require('child_process')
    const globalDir = execSync('npm root -g', { encoding: 'utf-8' }).trim()
    candidates.push(path.join(globalDir, '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
  } catch {
    // npm 可能因 node 不在 PATH 无法运行，继续尝试其他来源
  }
  // 回退：where npm.cmd 推导全局 node_modules（npm shim 目录 + node_modules）
  try {
    const where = execSync(process.platform === 'win32' ? 'where npm.cmd' : 'which npm', {
      encoding: 'utf-8', timeout: 5000,
    }).trim().split('\n')[0]
    if (where) {
      candidates.push(path.join(path.dirname(where), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
    }
  } catch { /* ignore */ }
  const cli = candidates.find((p) => fs.existsSync(p))
  if (cli) console.log(`[DSH] 使用 DSH CLI: ${cli}`)
  return cli || ''
}

// 所有权协议目录与关键参数（watcher 与本文件共享同一套语义）
const DSH_PORT_DEFAULT = 3080
const DSH_STATE_DIR = path.join(__dirname, '..', 'cache', 'dsh-runtime')
const DSH_EDITOR_HEARTBEAT_MS = 2000    // 编辑器心跳周期
const DSH_OWNER_GRACE_MS = 30000        // 孤儿宽限时长：全部编辑器消失后 watcher 再等这么久才收割 agent
const DSH_PROBE_TIMEOUT_MS = 1500       // /api/session.list 探测超时
const DSH_SPAWN_READY_TIMEOUT_MS = 30000 // spawn 后等待端口就绪上限
const DSH_AGENT_MAX_RESTARTS = 5        // 崩溃自愈次数上限，超限进入 degraded 终态
const DSH_AGENT_RESTART_BASE_MS = 2000  // 自愈退避基础延迟
const DSH_AGENT_RESTART_MAX_MS = 60000  // 自愈退避延迟上限

/**
 * 获取系统 Node.js 路径
 * DSH 要求 Node.js ^22.19.0 || >=24.0.0，而 Electron 内置的 Node.js 版本较低
 * 因此需要使用系统安装的 Node.js 来启动 DSH
 */
function getSystemNodePath(): string {
  // 候选来源：where/which 结果 + Windows 注册表 InstallPath（Node 安装器写入，可能不在 PATH 中）
  const candidates: string[] = []
  try {
    const cmd = process.platform === 'win32' ? 'where node' : 'which node'
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim()
    // Windows 的 where 命令可能返回多行，每行都是候选
    candidates.push(...result.split('\n').map((l) => l.trim()).filter(Boolean))
  } catch {
    // where/which 未找到，继续尝试注册表
  }
  if (process.platform === 'win32') {
    for (const key of [
      'HKLM\\SOFTWARE\\Node.js',
      'HKLM\\SOFTWARE\\WOW6432Node\\Node.js',
      'HKCU\\SOFTWARE\\Node.js',
    ]) {
      try {
        const reg = execSync(`reg query "${key}" /v InstallPath`, { encoding: 'utf-8', timeout: 5000 })
        const m = reg.match(/InstallPath\s+REG_SZ\s+(.+)/)
        if (m) candidates.push(path.join(m[1].trim().replace(/\\$/, ''), 'node.exe'))
      } catch {
        // 注册表键不存在，继续下一个
      }
    }
  }
  const nodePath = candidates.find((p) => fs.existsSync(p))
  if (nodePath) {
    console.log(`[DSH] 使用系统 Node.js: ${nodePath}`)
    return nodePath
  }
  console.warn('[DSH] 无法找到系统 Node.js，将使用 Electron 内置 Node.js（可能版本不兼容）')
  return process.execPath
}

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

// ─── 屏蔽 Chromium DevTools 内部噪音 ───
// Autofill.enable / Unknown VE context 等错误来自 DevTools 协议层，非应用错误
const _origStderrWrite = process.stderr.write.bind(process.stderr)
const DEVTOOLS_NOISE_RE = /(?:Autofill\.\w+|Unknown VE context|visual_logging)/
process.stderr.write = function (chunk: any, ...args: any[]) {
  const str = typeof chunk === 'string' ? chunk : String(chunk)
  if (DEVTOOLS_NOISE_RE.test(str)) return true
  return _origStderrWrite(chunk, ...args)
} as typeof process.stderr.write

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

// 游戏日志：每次启动游戏（Game.launch）创建独立文件 game_*.log，停止时关闭
let GAME_LOG_FILE: string | null = null

// 滚动删除：最多保留 10 个 console_ 日志 + 10 个 game_ 日志 + 10 个历史日期日志
const MAX_CONSOLE_LOG_FILES = 10
const MAX_GAME_LOG_FILES = 10
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

    // 清理 game_ 日志（按修改时间排序，保留最新的 10 个）
    const gameLogs = files
      .filter(f => f.startsWith('game_') && f.endsWith('.log'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(LOG_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
    if (gameLogs.length > MAX_GAME_LOG_FILES) {
      for (const f of gameLogs.slice(MAX_GAME_LOG_FILES)) {
        fs.unlinkSync(path.join(LOG_DIR, f.name))
      }
    }

    // 清理历史遗留的日期日志（YYYY-MM-DD.log，已废弃：日志改由 console_/game_ 轮转文件承载）
    const dailyLogs = files
      .filter(f => /^\d{4}-\d{2}-\d{2}\.log$/.test(f))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(LOG_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
    // 保留最新的 10 个（与旧行为一致），超出删除
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
    // 即时显示：不等页面加载，backgroundColor 纯色底先出窗（Electron 最早绘制时机）
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  loadingWindow.loadFile(path.join(__dirname, '../electron/loading.html'))

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
      // 后台不停摆：最小化/被遮挡时仍持续产帧（rAF 不断），游戏循环/预览全速运行。
      // 副作用：Page Visibility API 恒为 visible（document.hidden 恒 false）。
      backgroundThrottling: false,
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
    // 主窗口关闭：级联关闭独立 WebUI 窗口
    // 随后 window-all-closed 触发 stopDSHService 注销本实例（agent 由 watchdog 管理）
    if (_dshWebuiWindow && !_dshWebuiWindow.isDestroyed()) {
      console.log('[DSH] 主窗口关闭，级联关闭 WebUI 独立窗口')
      _dshWebuiWindow.close()
    }
  })

  // 将浏览器控制台输出重定向到文件日志
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    // 过滤 DevTools 面板自身的内部噪音（如 "Unknown VE context" / "Autofill.* failed"），
    // 这些来自 devtools:// 源，与应用代码无关
    if (sourceId.startsWith('devtools://')) return

    const logLevel = ['verbose', 'info', 'warning', 'error'][level] || 'info'
    const now = new Date().toISOString()
    const lineStr = `[${now}][CONSOLE:${logLevel.toUpperCase()}] ${message} (${sourceId}:${line})\n`
    try {
      ensureLogDir()
      fs.appendFileSync(CONSOLE_LOG_FILE, lineStr, 'utf-8')
    } catch {}
    // game.error 事件：仅推送 error / warning，过滤 devtools 噪音已在外层完成
    if (level >= 2 /* warning|error */) {
      publishSSE('game.error', {
        level: logLevel,
        message,
        source: sourceId,
        line,
        ts: Date.now(),
      })
    }
  })

  // 渲染进程崩溃（含 WebGL context lost）：game.lifecycle.crash
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    publishSSE('game.lifecycle', {
      event: 'crash',
      reason: details.reason,
      exitCode: details.exitCode,
      ts: Date.now(),
    })
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

// ─── DSH agent 常驻化管理（探测 → 认领 → 所有权 watchdog → 崩溃自愈） ───

interface DshOwner {
  port?: number
  agentPid?: number
  watchdogPid?: number
  claimedAt?: number
  /** 认领来源：spawn=本实例新拉起 claim=接管幸存实例 auto-restart=崩溃自愈 */
  source?: string
}

function ensureDshStateDir(): string {
  const editorsDir = path.join(DSH_STATE_DIR, 'editors')
  if (!fs.existsSync(editorsDir)) fs.mkdirSync(editorsDir, { recursive: true })
  return DSH_STATE_DIR
}

/** 平台无关 PID 存活检测（signal 0 探活；EPERM 视为存活） */
function isPidAlive(pid?: number | null): boolean {
  if (!pid || !Number.isFinite(pid)) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** 强制结束进程树（Windows taskkill /T /F），返回是否发出了终止命令 */
function killProcessTree(pid?: number | null): boolean {
  if (!isPidAlive(pid)) return false
  console.log(`[DSH] 终止进程树: ${pid}`)
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      try { process.kill(pid!, 'SIGTERM') } catch { /* already gone */ }
    }
  } catch (err) {
    console.error(`[DSH] 终止进程树失败(PID=${pid}): ${String(err)}`)
  }
  return true
}

/** 通过 netstat 反查监听指定端口（127.0.0.1）的进程 PID，用于认领旧 agent 时登记其 PID */
function findDshAgentPidByPort(port: number): number | null {
  try {
    const out = execSync('netstat -ano -p tcp', { encoding: 'utf-8', timeout: 5000 })
    for (const line of out.split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/)
      // 形如: TCP  127.0.0.1:3080  0.0.0.0:0  LISTENING  12345
      if (cols.length >= 5 && cols[0] === 'TCP' && cols[3] === 'LISTENING') {
        const local = cols[1]
        const addr = local.split(':')
        const p = Number(addr[addr.length - 1])
        const hostPart = local.slice(0, local.length - String(p || '').length - 1)
        if (p === port && (hostPart === '127.0.0.1' || hostPart === '0.0.0.0')) {
          return Number(cols[4])
        }
      }
    }
  } catch (err) {
    console.warn(`[DSH] netstat 反查端口 ${port} 失败: ${String(err)}`)
  }
  return null
}

/** 编辑器心跳：向注册表写入/续期本实例的心跳文件（watcher 据此判断编辑器存活性） */
function writeDshEditorHeartbeat(): void {
  try {
    ensureDshStateDir()
    const file = path.join(DSH_STATE_DIR, 'editors', `${process.pid}.json`)
    fs.writeFileSync(file, JSON.stringify({
      pid: process.pid,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
    }))
  } catch (err) {
    console.error(`[DSH] 写入编辑器心跳失败: ${String(err)}`)
  }
}

function startDshEditorHeartbeat(): void {
  writeDshEditorHeartbeat()
  if (_dshHeartbeatTimer) clearInterval(_dshHeartbeatTimer)
  _dshHeartbeatTimer = setInterval(writeDshEditorHeartbeat, DSH_EDITOR_HEARTBEAT_MS)
  _dshHeartbeatTimer.unref?.()
}

/** 停止心跳并注销自己的心跳文件 */
function stopDshEditorHeartbeat(): void {
  if (_dshHeartbeatTimer) { clearInterval(_dshHeartbeatTimer); _dshHeartbeatTimer = null }
  try {
    fs.rmSync(path.join(DSH_STATE_DIR, 'editors', `${process.pid}.json`), { force: true })
  } catch { /* ignore */ }
}

/**
 * 探测 DSH 是否存活：POST /api/session.list（与 renderer 同一 RPC 协议，零内核假设）。
 * 返回 true 表示 :3080 上有可用的 DSH web 服务。
 */
async function probeDshAlive(port: number = DSH_PORT_DEFAULT, timeoutMs = DSH_PROBE_TIMEOUT_MS): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/session.list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: `probe-${process.pid}`, method: 'session.list', payload: {} }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return false
    await res.json()
    return true
  } catch {
    return false
  }
}

function readDshOwner(): DshOwner | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(DSH_STATE_DIR, 'owner.json'), 'utf-8')) as DshOwner
  } catch { return null }
}

function writeDshOwner(patch: Partial<DshOwner>): void {
  try {
    ensureDshStateDir()
    const next: DshOwner = { ...(readDshOwner() || {}), ...patch }
    fs.writeFileSync(path.join(DSH_STATE_DIR, 'owner.json'), JSON.stringify(next, null, 2))
  } catch (err) {
    console.error(`[DSH] 写入 owner.json 失败: ${String(err)}`)
  }
}

/** 确保存在存活的 watcher 进程守护当前 agent（认领旧 agent 后必须调用） */
/**
 * spawn 新的 DSH agent 并等待就绪；成功后进入 running 并认领登记。
 *
 * 关键设计：通过 scripts/dsh-agent-launcher.cmd 间接启动 node 进程。
 * launcher 立即退出 → DSH agent 成为孤儿进程（被系统收养）→ 脱离 Electron 进程树。
 * 这样 vite-plugin-electron 的 treeKillSync（taskkill /T /F）不会连带杀死 DSH。
 */
async function spawnDshAgent(): Promise<void> {
  const cliPath = getDshCliPath()
  if (!fs.existsSync(cliPath)) {
    throw new Error(`DSH CLI 不存在（本地和全局均未找到）`)
  }

  const launcherPath = path.join(__dirname, '..', 'scripts', 'dsh-agent-launcher.cmd')
  if (!fs.existsSync(launcherPath)) {
    throw new Error(`DSH launcher 脚本不存在: ${launcherPath}`)
  }

  console.log(`[DSH] 启动 DSH 内核 (web profile, port ${DSH_PORT_DEFAULT})...`)
  _dshLifecycle = 'spawning'

  // DSH 输出写入日志文件（不再 pipe 到主进程，因为进程将脱离）
  const dshLogFile = path.join(LOG_DIR, 'dsh-agent.log')
  try { fs.writeFileSync(dshLogFile, '', 'utf-8') } catch { /* ignore */ }

  const nodePath = getSystemNodePath()
  // 通过 launcher.cmd 间接启动：cmd.exe → start /b node → cmd.exe 退出 → node 成为孤儿
  const launcher = spawn('cmd.exe', ['/c', launcherPath,
    nodePath, cliPath, DSH_SOURCE_DIR, dshLogFile,
    isDev ? 'development' : 'production',
    String(MCP_API_PORT),
  ], {
    cwd: DSH_SOURCE_DIR,
    stdio: 'ignore',        // launcher 自身的 stdio 不需要（DSH 输出已重定向到日志文件）
    windowsHide: true,
  })

  // launcher 会立即退出（start /b 是 fire-and-forget），不绑定生命周期
  launcher.on('error', (err) => {
    console.error(`[DSH] launcher 启动失败: ${err.message}`)
  })
  launcher.on('exit', (code) => {
    if (code !== 0) {
      console.error(`[DSH] launcher 异常退出: code=${code}`)
    }
  })

  // 就绪等待：RPC 探测（launcher 退出后无法通过 stdout 检测就绪）
  const deadline = Date.now() + DSH_SPAWN_READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (_dshShuttingDown) {
      console.log('[DSH] 就绪等待期间触发停机，中止启动流程')
      return
    }
    if (_dshPort === 0) {
      const ok = await probeDshAlive()
      if (ok) _dshPort = DSH_PORT_DEFAULT
    }
    if (_dshPort !== 0) break
    await new Promise(r => setTimeout(r, 500))
  }

  if (_dshPort === 0) {
    throw new Error(`agent 在 ${DSH_SPAWN_READY_TIMEOUT_MS}ms 内未就绪（端口 ${DSH_PORT_DEFAULT} 无响应）`)
  }

  registerDshOwnership('spawn')
  _dshLifecycle = 'running'
  _dshRestartCount = 0
  connectMuxWs()
  const owner = readDshOwner()
  console.log(`[DSH] 内核运行中: http://127.0.0.1:${_dshPort} (agentPid=${owner?.agentPid ?? '?'})`)

  // 定期将 DSH 日志回显到主进程控制台（方便调试，不阻塞）
  void tailDshLog(dshLogFile)
}

/** 后台尾随 DSH 日志文件，将新内容回显到主进程控制台 */
async function tailDshLog(logFile: string): Promise<void> {
  let pos = 0
  const readNew = () => {
    try {
      const stat = fs.statSync(logFile)
      if (stat.size <= pos) return
      const fd = fs.openSync(logFile, 'r')
      const buf = Buffer.alloc(stat.size - pos)
      fs.readSync(fd, buf, 0, buf.length, pos)
      fs.closeSync(fd)
      pos = stat.size
      const text = buf.toString('utf-8')
      text.split(/\r?\n/).forEach(line => {
        const t = line.trim()
        if (t) console.log(`[DSH:log] ${t}`)
      })
    } catch { /* 文件可能尚未创建 */ }
  }
  // 每秒检查一次新日志，直到 DSH 停止或进程关闭
  while (!_dshShuttingDown && _dshLifecycle !== 'off') {
    readNew()
    await new Promise(r => setTimeout(r, 1000))
  }
}

/** 认领登记：反查 agent PID → 写 owner.json */
function registerDshOwnership(source: string): void {
  let agentPid = _dshChild?.pid ?? null
  if (!agentPid) agentPid = findDshAgentPidByPort(_dshPort || DSH_PORT_DEFAULT)
  writeDshOwner({ port: _dshPort, agentPid: agentPid ?? undefined, claimedAt: Date.now(), source })
  if (!agentPid) {
    console.warn('[DSH] 未能确定 agent PID（netstat 反查失败），优雅停机时将退化为按端口收尾')
  }
}

/** 崩溃自愈入口：非主动停机的 exit 回调统一走这里 */
function onDshChildExited(code: number | null): void {
  if (_dshShuttingDown) return           // 主动停机中，不需要自愈
  if (_dshLifecycle !== 'running') return // 自愈路径上被再次 kill 属预期，忽略

  _dshPort = 0
  disconnectMuxWs()

  if (_dshRestartCount >= DSH_AGENT_MAX_RESTARTS) {
    _dshLifecycle = 'degraded'
    console.error(`[DSH] 自愈重试已达上限(${DSH_AGENT_MAX_RESTARTS})，进入 degraded 终态。可在 Agent 面板手动重启。`)
    return
  }

  const delay = Math.min(DSH_AGENT_RESTART_BASE_MS * Math.pow(2, _dshRestartCount), DSH_AGENT_RESTART_MAX_MS)
  _dshRestartCount++
  _dshLifecycle = 'restart-wait'
  console.warn(`[DSH] agent 异常退出(code=${code})，${delay}ms 后进行第 ${_dshRestartCount}/${DSH_AGENT_MAX_RESTARTS} 次自愈重启`)
  _dshRestartTimer = setTimeout(async () => {
    _dshRestartTimer = null
    if (_dshShuttingDown) return
    try {
      await bootstrapDSH('auto-restart')
    } catch (err) {
      console.error(`[DSH] 自愈重启失败: ${String(err)}`)
      onDshChildExited(null) // 以新一轮退出继续计数/终态判定
    }
  }, delay)
  _dshRestartTimer.unref?.()
}

/**
 * DSH 引导入口：探测 :3080 存活则认领，否则 spawn 新 agent。
 * 非阻塞、可重入安全（bootstrapInFlight 保护）；每次成功后都会建立/确认所有权。
 */
async function bootstrapDSH(source: string = 'startup'): Promise<void> {
  if (_dshBootstrapInFlight) {
    console.log(`[DSH] 引导流程进行中，忽略本次触发 (${source})`)
    return
  }
  _dshBootstrapInFlight = true
  _dshShuttingDown = false

  try {
    startDshEditorHeartbeat()
    _dshLifecycle = 'probing'
    const alive = await probeDshAlive()

    if (alive) {
      // ── 认领幸存 agent ──
      _dshPort = DSH_PORT_DEFAULT
      console.log(`[DSH] 探测到幸存 agent (port=${_dshPort})，执行认领 (${source})`)
      registerDshOwnership('claim')
      _dshLifecycle = 'claimed'
      connectMuxWs()
      console.log(`[DSH] 认领完成: http://127.0.0.1:${_dshPort} (agentPid=${readDshOwner()?.agentPid ?? '?'})`)
      return
    }

    // ── spawn 新 agent ──
    await spawnDshAgent()
  } catch (err) {
    // 引导失败（如 dsh-cli 缺失 / 就绪超时）：清理残留子进程后终态降级，不阻断编辑器其余功能
    if (_dshChild) { killProcessTree(_dshChild.pid); _dshChild = null }
    _dshLifecycle = 'degraded'
    _dshPort = 0
    console.error(`[DSH] 引导失败(${source}) → degraded: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    _dshBootstrapInFlight = false
  }
}

/**
 * 优雅停机：注销本实例心跳，断开 mux WS，重置本地状态。
 * agent 为孤儿进程独立运行，编辑器退出不影响其生命周期。
 * 需要停止 agent 请使用 stop-dsh.bat。
 */
async function stopDSHService(): Promise<void> {
  if (_dshLifecycle === 'off') return
  console.log('[DSH] 编辑器关闭，注销本实例（agent 为孤儿进程，继续运行）')
  _dshShuttingDown = true
  _dshLifecycle = 'off'
  if (_dshRestartTimer) { clearTimeout(_dshRestartTimer); _dshRestartTimer = null }
  disconnectMuxWs()
  stopDshEditorHeartbeat()
  _dshChild = null
  _dshPort = 0
}

// ═══════════════════════════════════════
//  启动流程
// ═══════════════════════════════════════

async function startApp() {
  // 1. 显示开屏：loading.html 加载窗口（纯色底即时出窗， Electron 唯一开屏）
  showLoadingWindow()

  // 2. 启动 MCP HTTP API（多实例自动分配端口）
  await startMCPServer()

  // 3. DSH agent 常驻引导：探测 :3080 → 认领幸存实例 / spawn 新实例（后台异步，不阻塞编辑器启动）
  void bootstrapDSH('startup')

  // 4. 等待开发服务器就绪（开发模式）
  if (isDev) {
    await waitForDevServer()
  }

  // 5. 后台创建主窗口（不显示、不关闭加载窗口）
  createMainWindow()

  // 6. 等待渲染进程发来 app-ready 信号
  ipcMain.once('app-ready', () => {
    // 主窗口就绪 → 关闭 loading.html 加载窗口
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
    // 应用根目录绝对路径（dist-electron 的上一级），Agent 面板以它作为 DSH 会话默认工作区
    appRoot: path.join(__dirname, '..'),
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

// ─── DSH 内核版本管理（异步，不阻塞主进程） ───
const execAsync = (cmd: string, opts: { cwd?: string; timeout?: number }) =>
  new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    exec(cmd, { encoding: 'utf-8', ...opts }, (err, stdout, stderr) => {
      if (err) reject(err)
      else resolve({ stdout, stderr })
    })
  })

// 获取 DSH 版本信息（只从 npm registry 获取最新版本）
ipcMain.handle('dsh-list-versions', async () => {
  try {
    if (!fs.existsSync(path.join(DSH_SOURCE_DIR, '.git'))) {
      return { current: '', latestNpm: '', error: 'DSH 源码目录不存在' }
    }

    // 当前版本
    let current = ''
    try {
      const { stdout } = await execAsync('git describe --tags --exact-match 2>nul', { cwd: DSH_SOURCE_DIR, timeout: 5000 })
      current = stdout.trim()
    } catch { /* 不在 tag 上 */ }

    // 从 npm registry 获取最新版本
    let latestNpm = ''
    try {
      const { stdout } = await execAsync('npm view @deepseek-ai/dsh version --registry=https://registry.npmmirror.com 2>nul', { cwd: DSH_SOURCE_DIR, timeout: 10000 })
      latestNpm = stdout.trim()
    } catch { /* 网络不可用或包不存在 */ }

    return { current, latestNpm }
  } catch (err) {
    return { current: '', latestNpm: '', error: String(err) }
  }
})

// 快速检查是否有新版本（只查 npm registry）
ipcMain.handle('dsh-check-update', async () => {
  try {
    // npm 最新版本
    let latestNpm = ''
    try {
      const { stdout } = await execAsync('npm view @deepseek-ai/dsh version --registry=https://registry.npmmirror.com 2>nul', { cwd: DSH_SOURCE_DIR, timeout: 10000 })
      latestNpm = stdout.trim()
    } catch { /* 网络不可用 */ }

    return { hasUpdate: !!latestNpm, latestNpm }
  } catch (err) {
    return { hasUpdate: false, latestNpm: '', error: String(err) }
  }
})

// 切换到指定 tag/branch：git checkout + install + build（进度通过 dsh-update-progress 事件推送）
ipcMain.handle('dsh-switch-version', async (event, target: string) => {
  const sendProgress = (step: string, detail?: string) => {
    event.sender.send('dsh-update-progress', { step, detail })
  }
  try {
    sendProgress('checkout', `正在切换到 ${target}...`)
    await execAsync(`git checkout ${target}`, { cwd: DSH_SOURCE_DIR, timeout: 30000 })

    sendProgress('install', '正在安装依赖...')
    try {
      await execAsync('pnpm install --prefer-offline --registry=https://registry.npmmirror.com', { cwd: DSH_SOURCE_DIR, timeout: 120000 })
    } catch { /* 依赖安装失败不中断 */ }

    sendProgress('build', '正在构建 DSH 内核...')
    await execAsync('pnpm run build', { cwd: DSH_SOURCE_DIR, timeout: 120000 })

    sendProgress('restart', '正在重启 DSH 服务...')
    await stopDSHService()
    _dshRestartCount = 0
    _dshShuttingDown = false
    void bootstrapDSH('version-switch')

    sendProgress('done', `已切换到 ${target}，更新完成！`)
    return { ok: true }
  } catch (err) {
    sendProgress('error', String(err))
    return { ok: false, error: String(err) }
  }
})

// DSH 服务状态查询（让渲染进程能即时知道 DSH 是否可用 + 端口 + 生命周期阶段）
ipcMain.handle('dsh-status', () => ({
  ready: _dshPort !== 0,
  port: _dshPort,
  enginePort: MCP_API_PORT,
  lifecycle: _dshLifecycle,
  agentPid: readDshOwner()?.agentPid ?? null,
}))

// DSH 手动重启（degraded 终态的恢复入口：杀旧进程 → 等端口释放 → 重新引导）
ipcMain.handle('dsh-restart', async () => {
  console.log('[DSH] 收到手动重启请求')
  // 先杀旧 agent 进程（stopDSHService 只注销心跳不杀进程）
  const owner = readDshOwner()
  if (owner?.agentPid) {
    console.log(`[DSH] 手动重启：终止旧 agent PID=${owner.agentPid}`)
    killProcessTree(owner.agentPid)
  }
  await stopDSHService()
  _dshRestartCount = 0
  _dshShuttingDown = false
  // 等待端口 3080 释放
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const alive = await probeDshAlive(DSH_PORT_DEFAULT, 500).catch(() => false)
    if (!alive) break
    await new Promise(r => setTimeout(r, 300))
  }
  console.log('[DSH] 手动重启：端口已释放，启动新 agent')
  void bootstrapDSH('manual-restart')
  return { ok: true }
})

// Agent 独立窗口（编辑器自身 AgentUI 全屏承载，单例；随主窗口关闭级联关闭）
ipcMain.handle('dsh-open-agent-window', () => {
  openAgentWindow()
  return { ok: true }
})

// DSH RPC 代理：渲染进程 → main → DSH :3080（绕过 CORS）
ipcMain.handle('dsh-rpc', async (_event, method: string, payload: unknown) => {
  const rpcId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  try {
    const res = await fetch(`http://127.0.0.1:3080/api/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
      signal: AbortSignal.timeout(30000),
    })
    return await res.json()
  } catch (err) {
    return { type: 'server-response', rpcId, result: { ok: false, error: { message: String(err) } } }
  }
})

// --- DSH Mux WS 下行桥 ---
// 事件下行流（question/requested、session/event 等）走 WebSocket，
// main 进程连接 DSH WS → 解析 JSON 帧 → IPC 转发渲染进程
let _muxWs: import('ws').WebSocket | null = null
let _muxReconnectTimer: ReturnType<typeof setTimeout> | null = null

function connectMuxWs(): void {
  if (_muxWs) return
  try {
    const WebSocket = require('ws') as typeof import('ws').default
    const ws = new WebSocket('ws://127.0.0.1:3080/api/events.mux', { headers: { Origin: 'http://127.0.0.1:3080' } })
    _muxWs = ws

    ws.on('open', () => { console.log('[DSH-mux] WS 已连接') })

    ws.on('message', (raw: Buffer) => {
      try {
        const frame = JSON.parse(raw.toString())
        // 广播到所有渲染进程
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('dsh-mux-frame', frame)
        }
      } catch { /* 解析失败忽略 */ }
    })

    ws.on('close', () => {
      console.log('[DSH-mux] WS 已断开，5s 后重连')
      _muxWs = null
      _muxReconnectTimer = setTimeout(connectMuxWs, 5000)
    })

    ws.on('error', (err: Error) => {
      console.error('[DSH-mux] WS 错误:', err.message)
      ws.close()
    })
  } catch (err) {
    console.error('[DSH-mux] WS 初始化失败:', err)
    _muxReconnectTimer = setTimeout(connectMuxWs, 5000)
  }
}

function disconnectMuxWs(): void {
  if (_muxReconnectTimer) { clearTimeout(_muxReconnectTimer); _muxReconnectTimer = null }
  if (_muxWs) { _muxWs.close(); _muxWs = null }
}

// DSH 内核启动后自动连 mux WS（在 dsh-status 查询 ready 时触发也可）
ipcMain.handle('dsh-mux-connect', () => { connectMuxWs() })
ipcMain.handle('dsh-mux-disconnect', () => { disconnectMuxWs() })

// DSH Respond 代理（client-response 信封，type 不是 client-request）
// 用于回答 question/requested 等需要 client-response 的场景
ipcMain.handle('dsh-respond', async (_event, message: unknown) => {
  try {
    const res = await fetch('http://127.0.0.1:3080/api/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(15000),
    })
    return await res.json()
  } catch (err) {
    return { accepted: false, reason: String(err) }
  }
})

// 切换当前焦点窗口的 DevTools（开发用）
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

// ─── 旧日期日志写入已废弃：日志改由 console_（编辑器启动）/ game_（游戏启动）轮转文件承载 ───
// 保留空实现以兼容旧 renderer 调用（writeLogFile IPC 不再写盘）
ipcMain.handle('write-log-file', async () => {})

// ─── Agent 窗口日志转发（agent renderer → 主窗口 Console 面板 + 文件）───
ipcMain.on('agent-log', (_event, data: { level: string; message: string }) => {
  // 写入文件日志
  const now = new Date().toISOString()
  const lineStr = `[${now}][AGENT:${data.level.toUpperCase()}] ${data.message}\n`
  try {
    ensureLogDir()
    fs.appendFileSync(CONSOLE_LOG_FILE, lineStr, 'utf-8')
  } catch {}
  // 转发给主窗口 Console 面板
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('agent-log', data)
  }
})

// ─── 游戏日志（每次启动游戏独立文件，滚动删除）───

/** 开始游戏日志：创建 game_YYYY-MM-DD_HHmmss.log 并写入 header；返回文件路径（失败返回 null） */
ipcMain.handle('start-game-log', async (_event, projectName?: string) => {
  try {
    ensureLogDir()
    const now = new Date()
    const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    GAME_LOG_FILE = path.join(LOG_DIR, `game_${ts}.log`)
    fs.appendFileSync(
      GAME_LOG_FILE,
      `[${now.toISOString()}][GAME] === 游戏启动 ===${projectName ? ` 项目: ${projectName}` : ''}\n`,
      'utf-8',
    )
    // 滚动删除：每次创建游戏日志后清理一次，保证 game_ 日志最多保留 10 个（含当前文件）
    cleanOldLogs()
    return GAME_LOG_FILE
  } catch (err) {
    console.error('游戏日志文件创建失败:', err)
    GAME_LOG_FILE = null
    return null
  }
})

/** 写入游戏日志（无活跃 game 文件时忽略） */
ipcMain.handle('write-game-log', async (_event, _level: string, message: string) => {
  if (!GAME_LOG_FILE) return
  try {
    fs.appendFileSync(GAME_LOG_FILE, `${message}\n`, 'utf-8')
  } catch {}
})

/** 结束游戏日志：关闭当前 game 文件（文件保留，滚动清理） */
ipcMain.handle('stop-game-log', async () => {
  GAME_LOG_FILE = null
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
    // 容错：strip UTF-8 BOM（\uFEFF），否则 JSON.parse 报 "Unexpected token '﻿'"
    return { success: true, data: JSON.parse(content.replace(/^\uFEFF/, '')) }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

// ─── 读取文本文件（codeLint 源码扫描等）───

ipcMain.handle('read-text-file', async (_event, relativePath: string) => {
  try {
    if (typeof relativePath !== 'string' || !relativePath) {
      return { success: false, error: 'relativePath 必须是非空字符串' }
    }
    const baseDir = path.join(__dirname, '..')
    const fullPath = path.resolve(baseDir, relativePath)
    // 路径逃逸防护：解析后必须仍在项目根内
    const rel = path.relative(baseDir, fullPath)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return { success: false, error: `非法路径: ${relativePath}` }
    }
    if (!fs.existsSync(fullPath)) {
      return { success: false, error: `文件不存在: ${relativePath}` }
    }
    const content = fs.readFileSync(fullPath, 'utf-8')
    return { success: true, data: content.replace(/^\uFEFF/, '') }
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

// ─── 列出目录下的文件（返回 {name, size, mtime}[]，仅顶层 .md 文件）───

ipcMain.handle('list-dir-files', async (_event, relativePath: string) => {
  try {
    if (typeof relativePath !== 'string' || !relativePath) {
      return { success: false, error: 'relativePath 必须是非空字符串' }
    }
    const baseDir = path.join(__dirname, '..')
    const fullPath = path.resolve(baseDir, relativePath)
    const rel = path.relative(baseDir, fullPath)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return { success: false, error: `非法路径: ${relativePath}` }
    }
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
      return { success: false, error: `目录不存在: ${relativePath}` }
    }
    const entries = fs.readdirSync(fullPath, { withFileTypes: true })
    const files = entries
      .filter(e => e.isFile() && e.name.endsWith('.md') && e.name !== 'MEMORY.md' && e.name !== 'INDEX.md')
      .map(e => {
        const stat = fs.statSync(path.join(fullPath, e.name))
        return { name: e.name, size: stat.size, mtime: stat.mtimeMs }
      })
      .sort((a, b) => b.mtime - a.mtime)
    return { success: true, data: files }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

// ─── 写入文本文件（UI 源格式 .widget.html 反编译回写等）───

ipcMain.handle('write-text-file', async (_event, relativePath: string, content: string) => {
  try {
    if (typeof relativePath !== 'string' || !relativePath) {
      return { success: false, error: 'relativePath 必须是非空字符串' }
    }
    // 仅允许文本类扩展名（UI 源格式回写 .html；避免误写二进制/代码）
    if (!/\.(html|htm|txt|css|md)$/i.test(relativePath)) {
      return { success: false, error: '仅允许写入文本类文件（.html/.htm/.txt/.css/.md）' }
    }
    const baseDir = path.join(__dirname, '..')
    const fullPath = path.resolve(baseDir, relativePath)
    // 路径逃逸防护：解析后必须仍在 baseDir 内
    const rel = path.relative(baseDir, fullPath)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return { success: false, error: `非法路径: ${relativePath}` }
    }
    fs.mkdirSync(path.dirname(fullPath), { recursive: true })
    fs.writeFileSync(fullPath, content, 'utf-8')
    return { success: true }
  } catch (err) {
    console.error('写入文本文件失败:', err)
    return { success: false, error: String(err) }
  }
})

// ─── 获取 harness 目录下的插件列表 ───

ipcMain.handle('list-harness-plugins', async () => {
  try {
    const harnessDir = path.join(__dirname, '..', 'harness')
    if (!fs.existsSync(harnessDir)) {
      return { success: true, plugins: [] }
    }

    const plugins: Array<{
      id: string
      name: string
      description: string
      version: string
      author: string
      type: string
      icon: string
      capabilities: string[]
      path: string
    }> = []

    const entries = fs.readdirSync(harnessDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      
      const pluginDir = path.join(harnessDir, entry.name)
      const packageJsonPath = path.join(pluginDir, 'package.json')
      
      if (!fs.existsSync(packageJsonPath)) continue
      
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
        
        // 检查是否是有效的插件（有 name 字段）
        if (!packageJson.name) continue
        
        // 提取插件信息，提供默认值
        const plugin = {
          id: packageJson.name,
          name: packageJson.name.split('/').pop() || entry.name,
          description: packageJson.description || `${entry.name} 插件`,
          version: packageJson.version || '1.0.0',
          author: packageJson.author || 'DemoStudio',
          type: guessPluginType(entry.name, packageJson),
          icon: guessPluginIcon(entry.name, packageJson),
          capabilities: extractCapabilities(packageJson),
          path: `harness/${entry.name}`,
        }
        
        plugins.push(plugin)
      } catch (err) {
        console.warn(`读取插件 ${entry.name} 的 package.json 失败:`, err)
      }
    }

    return { success: true, plugins }
  } catch (err) {
    console.error('获取 harness 插件列表失败:', err)
    return { success: false, error: String(err), plugins: [] }
  }
})

/** 根据目录名和 package.json 猜测插件类型 */
function guessPluginType(dirName: string, packageJson: any): string {
  const name = dirName.toLowerCase()
  const keywords = packageJson.keywords || []
  
  if (name.includes('tool') || keywords.includes('tools')) return 'tool'
  if (name.includes('ui') || keywords.includes('ui')) return 'ui'
  if (name.includes('service') || keywords.includes('service')) return 'service'
  if (name.includes('integration') || keywords.includes('integration')) return 'integration'
  
  return 'tool' // 默认为工具类型
}

/** 根据目录名和 package.json 猜测插件图标 */
function guessPluginIcon(dirName: string, packageJson: any): string {
  const name = dirName.toLowerCase()
  
  if (name.includes('engine')) return '⚙️'
  if (name.includes('plugin') && name.includes('manager')) return '📦'
  if (name.includes('instruction')) return '📋'
  if (name.includes('memory')) return '🧠'
  if (name.includes('sync')) return '🔄'
  if (name.includes('test')) return '🧪'
  if (name.includes('ui')) return '🎨'
  
  return '🔧' // 默认图标
}

/** 从 package.json 中提取 capabilities */
function extractCapabilities(packageJson: any): string[] {
  const capabilities: string[] = []
  
  // 从 keywords 中提取
  if (packageJson.keywords) {
    capabilities.push(...packageJson.keywords)
  }
  
  // 从 description 中提取关键能力
  const desc = (packageJson.description || '').toLowerCase()
  if (desc.includes('工具')) capabilities.push('tools')
  if (desc.includes('场景')) capabilities.push('scene')
  if (desc.includes('实体')) capabilities.push('entity')
  if (desc.includes('游戏')) capabilities.push('game')
  
  // 去重
  return [...new Set(capabilities)]
}

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

// ─── 资产文件操作（删除/重命名/系统定位；仅限 src/projects/*/asset/** 内）───

ipcMain.handle('asset-file-ops', async (_event, op: string, relPath: string, newName?: string) => {
  try {
    if (op !== 'delete' && op !== 'rename' && op !== 'reveal' && op !== 'copy-path') {
      return { success: false, error: `未知操作: ${op}` }
    }
    if (typeof relPath !== 'string' || !relPath) {
      return { success: false, error: 'path 必须是非空字符串' }
    }
    const baseDir = path.join(__dirname, '..')
    const fullPath = path.resolve(baseDir, relPath)
    // 路径逃逸防护：解析后必须仍在项目根内
    const rel = path.relative(baseDir, fullPath)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return { success: false, error: `非法路径: ${relPath}` }
    }
    // 仅允许操作项目资产目录内的文件/目录（与 AssetBrowser 可见范围一致；
    // 最低要求 <folder>/asset，reveal asset 根目录也允许）
    const assetRel = path.relative(path.join(baseDir, 'src', 'projects'), fullPath)
    if (assetRel.startsWith('..') || path.isAbsolute(assetRel)
      || assetRel.split(path.sep).length < 2 || assetRel.split(path.sep)[1] !== 'asset') {
      return { success: false, error: `仅允许操作 src/projects/*/asset/ 下的文件: ${relPath}` }
    }

    if (op === 'reveal') {
      shell.showItemInFolder(fullPath)
      console.log(`[asset-file-ops] reveal: ${relPath}`)
      return { success: true }
    }

    if (op === 'copy-path') {
      clipboard.writeText(fullPath)
      console.log(`[asset-file-ops] copy-path: ${relPath}`)
      return { success: true }
    }

    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      return { success: false, error: `文件不存在: ${relPath}` }
    }

    if (op === 'delete') {
      fs.unlinkSync(fullPath)
      console.log(`[asset-file-ops] delete: ${relPath}`)
      return { success: true }
    }

    // rename：newName 必须是纯文件名（不含路径分隔符），且目标不存在
    if (typeof newName !== 'string' || !newName.trim() || /[\\/]/.test(newName)) {
      return { success: false, error: `非法文件名: ${newName}` }
    }
    const targetPath = path.join(path.dirname(fullPath), newName)
    if (fs.existsSync(targetPath)) {
      return { success: false, error: `目标已存在: ${newName}` }
    }
    fs.renameSync(fullPath, targetPath)
    console.log(`[asset-file-ops] rename: ${relPath} → ${newName}`)
    return { success: true }
  } catch (err) {
    console.error('资产文件操作失败:', err)
    return { success: false, error: String(err) }
  }
})

// ─── 列出工程源码文件（递归，仅 .ts/.tsx，排除 .d.ts；codeLint 扫描用）───

ipcMain.handle('list-project-src', async (_event, folder: string) => {
  try {
    const projectRoot = path.join(__dirname, '..', 'src', 'projects', folder)
    if (!fs.existsSync(projectRoot)) return []

    const rootAbs = path.join(__dirname, '..')
    const result: string[] = []

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
          continue
        }
        if (!entry.isFile()) continue
        if (!/\.(ts|tsx)$/i.test(entry.name)) continue
        if (/\.d\.ts$/i.test(entry.name)) continue // 排除声明文件
        result.push(path.relative(rootAbs, full).replace(/\\/g, '/'))
      }
    }
    walk(projectRoot)
    return result
  } catch (err) {
    console.error('列出工程源码失败:', err)
    return []
  }
})

// ─── 工程目录监听：资产（asset-changed）+ 源码（src-changed）双通道，替代定时轮询 ───

let assetWatcher: fs.FSWatcher | null = null
let assetWatchDebounce: NodeJS.Timeout | null = null
let srcWatcher: fs.FSWatcher | null = null
let srcWatchDebounce: NodeJS.Timeout | null = null

/** 关闭全部目录监听与去抖定时器（重新监听 / 停止监听时调用）。 */
function closeProjectWatchers(): void {
  if (assetWatcher) {
    try { assetWatcher.close() } catch { /* ignore */ }
    assetWatcher = null
  }
  if (assetWatchDebounce) {
    clearTimeout(assetWatchDebounce)
    assetWatchDebounce = null
  }
  if (srcWatcher) {
    try { srcWatcher.close() } catch { /* ignore */ }
    srcWatcher = null
  }
  if (srcWatchDebounce) {
    clearTimeout(srcWatchDebounce)
    srcWatchDebounce = null
  }
}

/**
 * 开始监听某工程目录（覆盖上一次监听）：
 *   1. asset 子目录：仅 *.scene.json / *.blueprint.json / *.widget.json 变化 → asset-changed（assetLint 用）
 *   2. 工程根目录：仅 .ts/.tsx（排除 .d.ts）变化 → src-changed（codeLint 用）
 */
ipcMain.handle('watch-project-assets', async (_event, folder: string) => {
  closeProjectWatchers()

  const projectRoot = path.join(__dirname, '..', 'src', 'projects', folder)
  if (!fs.existsSync(projectRoot)) return { ok: false }
  try {
    // 1) 资产目录监听（只在 asset 目录存在时建立）
    const assetRoot = path.join(projectRoot, 'asset')
    if (fs.existsSync(assetRoot)) {
      assetWatcher = fs.watch(assetRoot, { recursive: true }, (_eventType, filename) => {
        if (!filename) return
        // 只关心场景/蓝图/widget 资产；代码/其它文件忽略
        if (!/\.(scene|blueprint|widget)\.json$/i.test(filename)) return
        // 去抖：编辑器保存常触发多次事件
        if (assetWatchDebounce) clearTimeout(assetWatchDebounce)
        assetWatchDebounce = setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('asset-changed', { folder })
          }
          // scene.change 事件：资产文件变更（场景/蓝图/widget）
          const kind = filename.toLowerCase().endsWith('.scene.json')
            ? 'scene'
            : filename.toLowerCase().endsWith('.blueprint.json')
            ? 'blueprint'
            : 'widget'
          publishSSE('scene.change', {
            event: 'asset-changed',
            folder,
            filename,
            kind,
            ts: Date.now(),
          })
        }, 300)
      })
    }

    // 2) 源码目录监听（工程根目录递归，含 asset/ 下的 *.script.ts；JSON 资产被扩展名过滤自然忽略）
    srcWatcher = fs.watch(projectRoot, { recursive: true }, (_eventType, filename) => {
      if (!filename) return
      if (!/\.(ts|tsx)$/i.test(filename)) return
      if (/\.d\.ts$/i.test(filename)) return // 排除声明文件
      if (srcWatchDebounce) clearTimeout(srcWatchDebounce)
      srcWatchDebounce = setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('src-changed', { folder })
        }
      }, 300)
    })
    return { ok: true }
  } catch (err) {
    console.error('监听工程目录失败:', err)
    return { ok: false }
  }
})

/** 停止工程目录监听（关闭工程/切换工程时调用）。 */
ipcMain.handle('stop-watch-project-assets', async () => {
  closeProjectWatchers()
  return { ok: true }
})

// ─── MCP 游戏状态 ───

ipcMain.handle('mcp-report-state', (_event, state: { running: boolean }) => {
  const wasRunning = _gameRunning
  _gameRunning = state.running
  // game.lifecycle 事件：编辑器层最早能感知到游戏启停变更的接入点（MCP 报告语义相同）
  if (state.running !== wasRunning) {
    publishSSE('game.lifecycle', {
      event: state.running ? 'launch' : 'stop',
      reason: 'mcp-report-state',
      ts: Date.now(),
    })
  }
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

// AI 聊天响应（renderer → main）
ipcMain.on('ai-chat-response', (_event, payload: { requestId: string; result: unknown }) => {
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

// ─── SSE 事件总线（DSH 扩展订阅入口） ───
// 类型：game.lifecycle | game.error | scene.change | ai.event
// 仅绑定 127.0.0.1；环形缓冲 100 条；客户端 Last-Event-ID 续传重放
type SSEEventType = 'game.lifecycle' | 'game.error' | 'scene.change' | 'ai.event'
interface SSEEvent {
  id: number
  type: SSEEventType
  ts: number
  data: unknown
}
const SSE_BUFFER_CAP = 100
const sseBuffer: SSEEvent[] = []
let sseNextId = 1
const sseClients = new Set<{
  res: http.ServerResponse
  cursor: number
  heartbeat: NodeJS.Timeout
}>()

function ssePublish(type: SSEEventType, data: unknown): void {
  const event: SSEEvent = { id: sseNextId++, type, ts: Date.now(), data }
  // 环形缓冲
  sseBuffer.push(event)
  if (sseBuffer.length > SSE_BUFFER_CAP) sseBuffer.shift()
  const payload = `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
  for (const client of sseClients) {
    try {
      client.res.write(payload)
    } catch {
      /* 客户端写入失败，交给 cleanupSSEClient 处理 */
    }
  }
}

function cleanupSSEClient(client: { res: http.ServerResponse; heartbeat: NodeJS.Timeout }): void {
  clearInterval(client.heartbeat)
  sseClients.delete(client as any)
  try {
    client.res.end()
  } catch {
    /* ignore */
  }
}

/** 业务层调用入口（封装 + 容错；业务代码不必感知缓冲区 / 客户端集合）。 */
export function publishSSE(type: SSEEventType, data: unknown): void {
  try {
    ssePublish(type, data)
  } catch (err) {
    console.error('[SSE] publish failed:', err)
  }
}

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

let _mcpServer: http.Server | null = null

async function startMCPServer() {
  // 防重入：activate 重入 startApp 时不得重复创建 server（端口已被占用）
  if (_mcpServer) return
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
          // 往返模式：等渲染进程处理完回传结果（AI 需要拿到返回值）
          if (cmd.command === 'ai_event' || cmd.command === 'ai_list_events' || cmd.command === 'run_asset_lint' || cmd.command === 'run_code_lint' || cmd.command === 'ui_compile' || cmd.command === 'ui_decompile' || cmd.command === 'get_scene_outline' || cmd.command === 'get_ui_outline' || cmd.command === 'get_assets') {
            // ai.event 转发（仅 ai_event 有事件语义；用于 ds-engine-tools 订阅；不影响原有的 renderer 往返）
            if (cmd.command === 'ai_event') {
              publishSSE('ai.event', {
                event: cmd.params?.event ?? cmd.params ?? 'unknown',
                payload: cmd.params?.payload,
                source: 'editor',
                ts: Date.now(),
              })
            }
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
          // ─── 主进程直处理的 MCP 命令（不经过渲染进程） ───
          if (cmd.command === 'dsh-restart') {
            console.log('[MCP] 收到 dsh-restart 命令，重启 DSH agent')
            // 先回 HTTP 响应（重启是异步的，不阻塞调用方）
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ status: 'ok', command: 'dsh-restart', message: 'DSH 重启中...' }))

            // 异步重启：杀旧进程 → 等端口释放 → 启新进程
            const owner = readDshOwner()
            console.log(`[MCP] dsh-restart: agentPid=${owner?.agentPid}, port=${owner?.port}`)
            if (owner?.agentPid) {
              killProcessTree(owner.agentPid)
            }
            stopDSHService().then(async () => {
              _dshRestartCount = 0
              _dshShuttingDown = false
              // 等待端口 3080 释放
              const deadline = Date.now() + 8000
              while (Date.now() < deadline) {
                const alive = await probeDshAlive(DSH_PORT_DEFAULT, 500).catch(() => false)
                if (!alive) break
                await new Promise(r => setTimeout(r, 300))
              }
              console.log('[MCP] dsh-restart: 端口已释放，启动新 agent')
              void bootstrapDSH('mcp-restart')
            }).catch(err => console.error(`[MCP] dsh-restart 失败: ${err}`))
            return
          }
          if (cmd.command === 'editor-restart') {
            console.log('[MCP] 收到 editor-restart 命令，重启编辑器')
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ status: 'ok', command: 'editor-restart', message: '编辑器正在重启...' }))
            // 延迟确保 HTTP 响应发出后再退出
            setTimeout(() => {
              app.relaunch() // 安排重启：exit 后自动重新启动
              app.exit(0)
            }, 500)
            return
          }
          if (cmd.command === 'dsh-status') {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
              status: 'ok',
              ready: _dshPort !== 0,
              port: _dshPort,
              enginePort: MCP_API_PORT,
              lifecycle: _dshLifecycle,
            }))
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
        editor: 'DemoStudio Editor v0.1.0',
        platform: process.platform,
        gameRunning: _gameRunning,
      }))
      return
    }

    // SSE 事件流（DSH 扩展订阅）
    if (req.method === 'GET' && req.url === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      // 客户端可携带 Last-Event-ID 续传
      const lastEventIdHeader = req.headers['last-event-id']
      const lastId = Array.isArray(lastEventIdHeader) ? Number(lastEventIdHeader[0]) : Number(lastEventIdHeader)
      const startCursor = Number.isFinite(lastId) && lastId >= 0 ? lastId + 1 : 0

      const client = {
        res,
        cursor: startCursor,
        heartbeat: setInterval(() => {
          try { res.write(`: heartbeat ${Date.now()}\n\n`) } catch { cleanupSSEClient(client) }
        }, 15000),
      }
      sseClients.add(client as any)

      // 续传：把 buffer 中 id >= startCursor 的事件按序写出去
      for (const ev of sseBuffer) {
        if (ev.id >= client.cursor) {
          try {
            res.write(`id: ${ev.id}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`)
            client.cursor = ev.id + 1
          } catch {
            cleanupSSEClient(client)
            return
          }
        }
      }

      req.on('close', () => cleanupSSEClient(client))
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

    // AI 聊天 API
    if (req.method === 'POST' && req.url === '/api/chat') {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', async () => {
        try {
          const { message, history } = JSON.parse(body)

          // 优先代理到 DSH 服务（常驻 agent；端口固定 :3080 由 bootstrapDSH 就绪后标记）
          if (_dshPort !== 0 && (_dshLifecycle === 'running' || _dshLifecycle === 'claimed')) {
            try {
              const dshPort = _dshPort
              const dshRes = await fetch(`http://127.0.0.1:${dshPort}/chat-sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, history }),
              })

              if (dshRes.ok) {
                const dshData = await dshRes.json()
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify(dshData))
                return
              }
            } catch (dshErr) {
              console.warn(`[Chat] DSH 服务调用失败，回退到本地处理: ${dshErr}`)
            }
          }

          // 回退：发送到渲染进程处理（本地 AI）
          if (!mainWindow || mainWindow.isDestroyed()) {
            res.writeHead(503, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ status: 'error', message: '编辑器窗口不可用' }))
            return
          }

          const requestId = `chat-${++_blueprintReqSeq}`
          const timer = setTimeout(() => {
            if (_blueprintPending.delete(requestId)) {
              try {
                res.writeHead(504, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ status: 'error', message: 'AI 响应超时' }))
              } catch { /* response already closed */ }
            }
          }, 30000)

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

          mainWindow.webContents.send('ai-chat', { requestId, message, history })
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'error', message: String(err) }))
        }
      })
      return
    }

    res.writeHead(404)
    res.end('Not found')
  })

  server.listen(MCP_API_PORT, '127.0.0.1', () => {
    _mcpServer = server
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

/**
 * Agent 独立窗口：加载独立入口 agent.html（agent-main.tsx 全屏渲染 AgentPanel），
 * 与主编辑器分入口加载，HMR 分窗隔离（引擎/面板文件互不触发对方刷新），
 * 与编辑器内嵌面板共享同一 agent :3080 与同一批会话。
 * - 单例：重复调用时聚焦已有窗口；
 * - agent 未就绪时窗口内 AgentPanel 自动进入 claiming 态轮询等待（复用自身连接状态机，无需等待页）；
 * - 仅是 UI 容器，不影响 agent 进程管理（归属仍由 bootstrapDSH/stopDSHService 控制）。
 */
let _dshWebuiWindow: BrowserWindow | null = null

function openAgentWindow(): void {
  if (_dshWebuiWindow && !_dshWebuiWindow.isDestroyed()) {
    if (_dshWebuiWindow.isMinimized()) _dshWebuiWindow.restore()
    _dshWebuiWindow.focus()
    console.log('[DSH] Agent 独立窗口已存在，聚焦')
    return
  }

  console.log(`[DSH] 打开 Agent 独立窗口 (agent ${_dshPort !== 0 ? `就绪:${_dshPort}` : '未就绪，窗口内自动等待'})`)
  _dshWebuiWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 720,
    minHeight: 480,
    title: 'DSH Agent',
    backgroundColor: '#1e1e1e',
    icon: path.join(__dirname, '../assets/icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 后台不停摆：隐藏/最小化时 agent 面板的定时器/动画不降频（e2e 也依赖该窗口路由）
      backgroundThrottling: false,
    },
    show: false,
  })

  _dshWebuiWindow.once('ready-to-show', () => _dshWebuiWindow?.show())
  _dshWebuiWindow.on('closed', () => { _dshWebuiWindow = null })

  // 将 Agent 窗口控制台输出重定向到文件日志（与主窗口 console-message 同逻辑）
  _dshWebuiWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (sourceId.startsWith('devtools://')) return
    const logLevel = ['verbose', 'info', 'warning', 'error'][level] || 'info'
    const now = new Date().toISOString()
    const lineStr = `[${now}][AGENT:${logLevel.toUpperCase()}] ${message} (${sourceId}:${line})\n`
    try {
      ensureLogDir()
      fs.appendFileSync(CONSOLE_LOG_FILE, lineStr, 'utf-8')
    } catch {}
  })

  // 开发模式下自动打开 DevTools
  if (isDev) {
    _dshWebuiWindow.webContents.openDevTools({ mode: 'detach' })
  }

  // 加载 Agent 独立入口（agent.html → agent-main.tsx，仅挂载 AgentPanel，不初始化引擎）
  if (isDev) {
    void _dshWebuiWindow.loadURL(`${VITE_URL}/agent.html`)
  } else {
    void _dshWebuiWindow.loadFile(path.join(__dirname, '../dist/agent.html'))
  }
}

// ─── 应用生命周期 ───

// 多实例支持：不申请单实例锁，允许多个编辑器实例同时运行
// Vite 端口 (5173+) 与 MCP 端口 (9877+) 均自动递增分配，互不冲突
// 开启远程调试端口（Playwright/CDP 可连接已有实例）
// 仅在启动参数未显式指定调试端口时追加：外部调试工具（如 Playwright electron.launch 传
// --remote-debugging-port=0 走 pipe 模式）会自带该参数，无条件覆盖会与运行中实例的 9222
// 冲突（bind 失败 → devtools http server 起不来 → 调试链路瘫痪）
if (!app.commandLine.hasSwitch('remote-debugging-port')) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
}

// 后台持续运行（与各窗口 backgroundThrottling:false 配合）：
// - disable-renderer-backgrounding：页面进入后台时 renderer 进程不被降优先级（定时器不降到 1Hz）
// - disable-backgrounding-occluded-windows：Win10+ 原生遮挡检测不把被遮挡窗口标记为 hidden
// - disable-background-timer-throttling：后台定时器不被节流（World tick 看门狗的 100ms 轮询因此保持真实节奏）
// 三开关对本进程所有 renderer（含 Playwright/CDP 连入的页面）生效
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-background-timer-throttling')

app.whenReady().then(() => {
  startApp()
})

app.on('window-all-closed', () => {
  // 注销本实例心跳，断开 mux WS。agent 为孤儿进程独立运行，编辑器退出不影响。
  stopDSHService()
  // process.exit(0) 强制立即退出，避免 Vite dev server 的文件监听/WS 等异步句柄拖住 bat 窗口
  process.exit(0)
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    // bootstrapDSH 自带 inFlight 防重入与 off 状态幂等，重复 startApp 安全
    startApp()
  }
})
