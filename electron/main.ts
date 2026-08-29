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
import { app, BrowserWindow, ipcMain, Menu, dialog } from 'electron'
import path from 'path'
import fs from 'fs'
import http from 'http'
import net from 'net'
import { spawn, execSync, type ChildProcess } from 'child_process'

let mainWindow: BrowserWindow | null = null
let loadingWindow: BrowserWindow | null = null
let _gameRunning = false
let _gameScore = 0

// ─── DSH 服务管理（agent 常驻化：探测 → 认领 → 所有权 watchdog） ───
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

const DSH_CLI_PATH = path.join(__dirname, '..', 'harness', 'dsh-source', 'apps', 'cli', 'lib', 'bin.js')
const DSH_SOURCE_DIR = path.join(__dirname, '..', 'harness', 'dsh-source')

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
  try {
    const cmd = process.platform === 'win32' ? 'where node' : 'which node'
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim()
    // Windows 的 where 命令可能返回多行，取第一行
    const nodePath = result.split('\n')[0].trim()
    console.log(`[DSH] 使用系统 Node.js: ${nodePath}`)
    return nodePath
  } catch (err) {
    console.warn('[DSH] 无法找到系统 Node.js，将使用 Electron 内置 Node.js（可能版本不兼容）')
    return process.execPath
  }
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
    // 主窗口关闭 = 主动关闭编辑器：级联关闭独立 WebUI 窗口，
    // 随后 window-all-closed 触发 stopDSHService 收割 agent（主动关闭才销毁的不变量）
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

/** 除本实例外是否还有其他心跳新鲜的编辑器在运行（多实例共享降级判断用） */
function hasOtherFreshEditors(): boolean {
  try {
    const dir = path.join(DSH_STATE_DIR, 'editors')
    const files = fs.readdirSync(dir)
    const now = Date.now()
    for (const f of files) {
      if (!f.endsWith('.json')) continue
      if (f === `${process.pid}.json`) continue
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))
        const fresh = now - Number(raw.heartbeatAt || 0) <= DSH_EDITOR_HEARTBEAT_MS * 3
        if (fresh && isPidAlive(Number(raw.pid))) return true
      } catch { /* 单文件损坏忽略 */ }
    }
  } catch { /* 目录不存在 */ }
  return false
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
function ensureDshWatcher(source: string): void {
  const owner = readDshOwner()
  if (isPidAlive(owner?.watchdogPid)) {
    console.log(`[DSH] watcher 存活(PID=${owner?.watchdogPid})，无需重复拉起 (${source})`)
    return
  }
  const watcherPath = path.join(__dirname, '..', 'editor', 'dsh-agent-watcher.cjs')
  if (!fs.existsSync(watcherPath)) {
    console.warn(`[DSH] watcher 脚本不存在: ${watcherPath}（孤儿自杀能力失效，但不阻断使用）`)
    return
  }
  const systemNode = getSystemNodePath()
  const child = spawn(systemNode, [
    watcherPath,
    '--state-dir', DSH_STATE_DIR,
    '--grace-ms', String(DSH_OWNER_GRACE_MS),
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref?.()
  console.log(`[DSH] 已拉起所有权 watchdog (PID=${child.pid}) (${source})，宽限=${DSH_OWNER_GRACE_MS}ms`)
  // 注意：watcher 启动后会自报家门把自身 PID 写入 owner.json，这里不再写 watchPid 竞态值
}

/** spawn 新的 DSH agent 子进程并等待就绪；成功后进入 running 并认领登记 */
async function spawnDshAgent(): Promise<void> {
  if (!fs.existsSync(DSH_CLI_PATH)) {
    throw new Error(`DSH CLI 不存在: ${DSH_CLI_PATH}`)
  }

  console.log(`[DSH] 启动 DSH 内核 (web profile, port ${DSH_PORT_DEFAULT})...`)
  _dshLifecycle = 'spawning'

  const child = spawn(getSystemNodePath(), [DSH_CLI_PATH, '--profile', 'web', '--no-open'], {
    cwd: DSH_SOURCE_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: isDev ? 'development' : 'production',
      DSH_ENGINE_PORT: String(MCP_API_PORT),
    },
  })
  _dshChild = child

  child.stdout?.on('data', (data) => {
    const msg = data.toString()
    msg.split(/\r?\n/).forEach((line: string) => {
      const t = line.trim()
      if (t) console.log(`[DSH:stdout] ${t}`)
      const m = t.match(/dsh web:\s*http:\/\/[^:]+:(\d+)/)
      if (m && _dshPort !== Number(m[1])) {
        _dshPort = Number(m[1])
        console.log(`[DSH] 内核就绪(stdout): http://127.0.0.1:${_dshPort}`)
      }
    })
  })
  child.stderr?.on('data', (data) => {
    const msg = data.toString()
    msg.split(/\r?\n/).forEach((line: string) => {
      if (line.trim()) console.log(`[DSH:stderr] ${line.trim()}`)
    })
  })

  child.on('exit', (code) => {
    console.log(`[DSH] 内核进程退出: code=${code} shuttingDown=${_dshShuttingDown}`)
    if (_dshChild === child) _dshChild = null
    onDshChildExited(code)
  })
  child.on('error', (err) => {
    console.error(`[DSH] 内核启动失败: ${err.message}`)
  })

  // 就绪等待：stdout 打印或 RPC 探测通过任一即可（双通道，防 stdout 格式变化导致死等）
  const deadline = Date.now() + DSH_SPAWN_READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (_dshShuttingDown) {
      // 等待期间用户关窗：此时 child 尚未注册到 owner.json，必须就地收割防孤儿
      console.log('[DSH] 就绪等待期间触发停机，收割未注册的 agent 子进程')
      killProcessTree(child.pid)
      if (_dshChild === child) _dshChild = null
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
  console.log(`[DSH] 内核运行中: http://127.0.0.1:${_dshPort} (agentPid=${_dshChild?.pid ?? '?'})`)
}

/** 认领登记：反查 agent PID → 写 owner.json → 确保 watcher 守护 */
function registerDshOwnership(source: string): void {
  let agentPid = _dshChild?.pid ?? null
  if (!agentPid) agentPid = findDshAgentPidByPort(_dshPort || DSH_PORT_DEFAULT)
  writeDshOwner({ port: _dshPort, agentPid: agentPid ?? undefined, claimedAt: Date.now(), source })
  ensureDshWatcher(source)
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
 * 优雅停机：
 *  - 注销本实例心跳；
 *  - 若仍有其他新鲜编辑器实例 → 仅注销自己（agent 与 watcher 继续服务多实例场景）；
 *  - 否则收割 agent 进程树并停掉 watcher，清理协议文件，确保 :3080 不再有监听。
 */
async function stopDSHService(): Promise<void> {
  if (_dshLifecycle === 'off') return
  const wasRunning = _dshPort !== 0 || !!readDshOwner()?.agentPid
  _dshShuttingDown = true
  _dshLifecycle = 'off'
  if (_dshRestartTimer) { clearTimeout(_dshRestartTimer); _dshRestartTimer = null }
  disconnectMuxWs()
  stopDshEditorHeartbeat()

  if (!wasRunning) return

  if (hasOtherFreshEditors()) {
    console.log('[DSH] 检测到其他活跃编辑器实例，保留共享 agent 不停机')
    _dshChild = null
    _dshPort = 0
    return
  }

  console.log('[DSH] 本实例是最后一个编辑器 → 收割 agent 与 watchdog')
  const owner = readDshOwner()
  // agentPid 缺失时按端口兜底反查，确保「:3080 无监听」承诺可兑现
  const agentPid = owner?.agentPid ?? findDshAgentPidByPort(_dshPort || DSH_PORT_DEFAULT)
  killProcessTree(agentPid)
  killProcessTree(owner?.watchdogPid)
  _dshChild = null
  _dshPort = 0
  try { fs.rmSync(path.join(DSH_STATE_DIR, 'owner.json'), { force: true }) } catch { /* ignore */ }
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

// DSH 服务状态查询（让渲染进程能即时知道 DSH 是否可用 + 端口 + 生命周期阶段）
ipcMain.handle('dsh-status', () => ({
  ready: _dshPort !== 0,
  port: _dshPort,
  enginePort: MCP_API_PORT,
  lifecycle: _dshLifecycle,
  agentPid: readDshOwner()?.agentPid ?? null,
}))

// DSH 手动重启（degraded 终态的恢复入口：重置自愈计数后重新走引导流程）
ipcMain.handle('dsh-restart', async () => {
  console.log('[DSH] 收到手动重启请求')
  await stopDSHService()
  _dshRestartCount = 0
  _dshShuttingDown = false
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

ipcMain.handle('mcp-report-state', (_event, state: { running: boolean; score?: number }) => {
  const wasRunning = _gameRunning
  _gameRunning = state.running
  if (state.score !== undefined) _gameScore = state.score
  // game.lifecycle 事件：编辑器层最早能感知到游戏启停变更的接入点（MCP 报告语义相同）
  if (state.running !== wasRunning) {
    publishSSE('game.lifecycle', {
      event: state.running ? 'launch' : 'stop',
      reason: 'mcp-report-state',
      score: state.score,
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
          // ai_event：往返模式，等渲染进程处理完回传结果（AI 需要拿到事件返回值）
          if (cmd.command === 'ai_event' || cmd.command === 'ai_list_events') {
            // ai.event 转发（用于 dsh-plugin 订阅；不影响原有的 renderer 往返）
            publishSSE('ai.event', {
              event: cmd.params?.event ?? cmd.params ?? 'unknown',
              payload: cmd.params?.payload,
              source: 'editor',
              ts: Date.now(),
            })
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
        editor: 'DemoStudio Editor v0.1.0',
        platform: process.platform,
        gameRunning: _gameRunning,
        gameScore: _gameScore,
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
 * Agent 独立窗口：加载编辑器自身的 AgentUI（?agentWindow=1 全屏渲染 AgentPanel），
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
    },
    show: false,
  })

  _dshWebuiWindow.once('ready-to-show', () => _dshWebuiWindow?.show())
  _dshWebuiWindow.on('closed', () => { _dshWebuiWindow = null })

  // 加载编辑器应用本身，query 参数驱动 App 只渲染 AgentPanel（不初始化引擎）
  if (isDev) {
    void _dshWebuiWindow.loadURL(`${VITE_URL}?agentWindow=1`)
  } else {
    void _dshWebuiWindow.loadFile(path.join(__dirname, '../dist/index.html'), { search: 'agentWindow=1' })
  }
}

// ─── 应用生命周期 ───

// 多实例支持：不申请单实例锁，允许多个编辑器实例同时运行
// Vite 端口 (5173+) 与 MCP 端口 (9877+) 均自动递增分配，互不冲突
app.whenReady().then(() => {
  startApp()
})

app.on('window-all-closed', () => {
  // 优雅停机：最后一个编辑器实例才收割 agent；多实例共享时仅注销自己。
  // 收割完成后以确定性的退出码 0 结束：shutdown 竞态（taskkill 对已死 PID 报
  // not found、mux 断连重连定时器等）可能把退出码弄成非 0，令 editor.bat
  // 误判为出错而停在 pause，cmd 窗口关不上。
  void stopDSHService().finally(() => {
    if (process.platform !== 'darwin') {
      app.exit(0)
    }
  })
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    // bootstrapDSH 自带 inFlight 防重入与 off 状态幂等，重复 startApp 安全
    startApp()
  }
})
