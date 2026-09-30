/**
 * DSH agent 进程生命周期（探测 → 认领 → 所有权 watchdog → 崩溃自愈）
 * 从 main.ts 原样搬迁（2026-10-01 适配层抽取）。
 *
 * 变更点（行为等价）：
 *   - bootstrapDSH 开头按安装的内核版本 selectAdapterForKernel()——鉴权/流模式/RPC
 *     翻译全部对齐该代际适配器（内核回滚后自动切回旧适配器的入口）；
 *   - 新增 getDshStatusSnapshot / restartDshAgent / resetSelfHealCounters，
 *     供 main.ts 的 IPC 与 MCP 命令薄委托（ESM let 导出不可变写，状态机收拢于此）。
 */

import path from 'path'
import fs from 'fs'
import { spawn, execSync, type ChildProcess } from 'child_process'
import { DSH_PORT_DEFAULT, dshCtx } from './context'
import { getDshCliPath, getInstalledDshVersion, getSystemNodePath } from './kernel'
import { ensureDshAuthCookie, resetDshAuthCookie, dshAuthHeaders } from './auth'
import { selectAdapterForKernel } from './registry'
import { connectMuxWs, disconnectMuxWs } from './streamBridge'

// 生命周期状态机：off → probing → claimed(复用旧实例) | spawning → running → restart-wait(自愈中) | degraded(自愈超限终态)
export type DshLifecycle = 'off' | 'probing' | 'claimed' | 'spawning' | 'running' | 'restart-wait' | 'degraded'

let _dshLifecycle: DshLifecycle = 'off'
let _dshPort = 0
let _dshChild: ChildProcess | null = null   // 本实例 spawn 的 agent 子进程（认领的旧 agent 无此句柄）
let _dshShuttingDown = false                // 主动停机标志：抑制 exit 回调触发自愈
let _dshBootstrapInFlight = false           // 探测/spawn 流程防重入（activate 重复 startApp 场景）
let _dshRestartCount = 0                    // 自愈已重试次数
let _dshRestartTimer: NodeJS.Timeout | null = null
let _dshHeartbeatTimer: NodeJS.Timeout | null = null
let _dshAutoClaimTimer: NodeJS.Timeout | null = null

const DSH_EDITOR_HEARTBEAT_MS = 2000    // 编辑器心跳周期
const DSH_PROBE_TIMEOUT_MS = 1500       // /api/session.list 探测超时
const DSH_SPAWN_READY_TIMEOUT_MS = 30000 // spawn 后等待端口就绪上限
const DSH_AGENT_MAX_RESTARTS = 5        // 崩溃自愈次数上限，超限进入 degraded 终态
const DSH_AGENT_RESTART_BASE_MS = 2000  // 自愈退避基础延迟
const DSH_AGENT_RESTART_MAX_MS = 60000  // 自愈退避延迟上限
const DSH_AUTOCLAIM_PROBE_MS = 10000    // degraded 兜底探测周期：内核晚到/外部拉起后自动认领

export interface DshOwner {
  port?: number
  agentPid?: number
  watchdogPid?: number
  claimedAt?: number
  /** 认领来源：spawn=本实例新拉起 claim=接管幸存实例 auto-restart=崩溃自愈 */
  source?: string
}

function ensureDshStateDir(): string {
  const stateDir = dshCtx().stateDir
  const editorsDir = path.join(stateDir, 'editors')
  if (!fs.existsSync(editorsDir)) fs.mkdirSync(editorsDir, { recursive: true })
  return stateDir
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
export function killProcessTree(pid?: number | null): boolean {
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
    const file = path.join(dshCtx().stateDir, 'editors', `${process.pid}.json`)
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
    fs.rmSync(path.join(dshCtx().stateDir, 'editors', `${process.pid}.json`), { force: true })
  } catch { /* ignore */ }
}

/**
 * 探测 DSH 是否存活：POST RPC（与 renderer 同一信封，零内核假设）。
 * 双代际兼容：0.1.7 强制鉴权且方法名斜杠（settings/describe + cookie）；
 * 0.1.1 及更早无鉴权（session.list 点号名、空信封）。任一通过即视为存活。
 * 返回 true 表示端口上有可用的 DSH web 服务。
 */
export async function probeDshAlive(port: number = DSH_PORT_DEFAULT, timeoutMs = DSH_PROBE_TIMEOUT_MS): Promise<boolean> {
  let sawUnauthorized = false
  const attempt = async (method: string, argsEnvelope: boolean): Promise<boolean> => {
    const res = await fetch(`http://127.0.0.1:${port}/api/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...dshAuthHeaders() },
      body: JSON.stringify({ type: 'client-request', rpcId: `probe-${process.pid}`, method, payload: argsEnvelope ? { args: {} } : {} }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (res.status === 401) { sawUnauthorized = true; return false }
    if (!res.ok) return false
    await res.json()
    return true
  }
  try {
    if (await attempt('settings/describe', true)) return true
    if (await attempt('session.list', false)) return true
  } catch { /* 端口未就绪，等待下轮探测 */ }
  if (sawUnauthorized) {
    // 带旧 cookie 仍 401：cookie 失效（token 轮换）→ 丢弃并从日志重换
    resetDshAuthCookie()
    await ensureDshAuthCookie()
  }
  return false
}

export function readDshOwner(): DshOwner | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dshCtx().stateDir, 'owner.json'), 'utf-8')) as DshOwner
  } catch { return null }
}

function writeDshOwner(patch: Partial<DshOwner>): void {
  try {
    ensureDshStateDir()
    const next: DshOwner = { ...(readDshOwner() || {}), ...patch }
    fs.writeFileSync(path.join(dshCtx().stateDir, 'owner.json'), JSON.stringify(next, null, 2))
  } catch (err) {
    console.error(`[DSH] 写入 owner.json 失败: ${String(err)}`)
  }
}

/**
 * spawn 新的 DSH agent 并等待就绪；成功后进入 running 并认领登记。
 *
 * 关键设计：通过 scripts/dsh-agent-launcher.cmd 间接启动 node 进程。
 * launcher 立即退出 → DSH agent 成为孤儿进程（被系统收养）→ 脱离 Electron 进程树。
 * 这样 vite-plugin-electron 的 treeKillSync（taskkill /T /F）不会连带杀死 DSH。
 */
async function spawnDshAgent(): Promise<void> {
  const ctx = dshCtx()
  const cliPath = getDshCliPath()
  if (!fs.existsSync(cliPath)) {
    throw new Error(`DSH CLI 不存在（本地和全局均未找到）`)
  }

  const launcherPath = path.join(ctx.scriptsDir, 'dsh-agent-launcher.cmd')
  if (!fs.existsSync(launcherPath)) {
    throw new Error(`DSH launcher 脚本不存在: ${launcherPath}`)
  }

  console.log(`[DSH] 启动 DSH 内核 (web profile, port ${DSH_PORT_DEFAULT})...`)
  _dshLifecycle = 'spawning'

  // DSH 输出写入日志文件（不再 pipe 到主进程，因为进程将脱离）
  const dshLogFile = path.join(ctx.logDir, 'dsh-agent.log')
  try { fs.writeFileSync(dshLogFile, '', 'utf-8') } catch { /* ignore */ }

  const nodePath = getSystemNodePath()
  // 通过 launcher.cmd 间接启动：cmd.exe → start /b node → cmd.exe 退出 → node 成为孤儿
  const launcher = spawn('cmd.exe', ['/c', launcherPath,
    nodePath, cliPath, ctx.sourceDir, dshLogFile,
    ctx.isDev ? 'development' : 'production',
    String(ctx.getMcpApiPort()),
  ], {
    cwd: ctx.sourceDir,
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

/**
 * degraded 终态兜底：降频探测端口，内核一旦可达（spawn 就绪晚于等待窗口 /
 * 用户手动拉起）即重新引导认领。只认领不重拉——探测通过才走 bootstrap 的
 * 认领路径，避免绕过崩溃自愈 5 次重试上限形成 respawn 循环。
 * 生命周期离开 degraded（认领成功/停机）后探测循环自动退出。
 */
function startDshAutoClaimWatch(): void {
  if (_dshAutoClaimTimer) return
  console.log(`[DSH] degraded 兜底：每 ${DSH_AUTOCLAIM_PROBE_MS / 1000}s 探测 :${DSH_PORT_DEFAULT}，内核可达后自动认领`)
  _dshAutoClaimTimer = setInterval(() => {
    if (_dshLifecycle !== 'degraded') {
      clearInterval(_dshAutoClaimTimer!)
      _dshAutoClaimTimer = null
      return
    }
    void probeDshAlive().then((alive) => {
      if (alive && _dshLifecycle === 'degraded') void bootstrapDSH('auto-claim')
    })
  }, DSH_AUTOCLAIM_PROBE_MS)
  _dshAutoClaimTimer.unref?.()
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
    startDshAutoClaimWatch()
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
 * DSH 引导入口：探测端口存活则认领，否则 spawn 新 agent。
 * 非阻塞、可重入安全（bootstrapInFlight 保护）；每次成功后都会建立/确认所有权。
 */
export async function bootstrapDSH(source: string = 'startup'): Promise<void> {
  if (_dshBootstrapInFlight) {
    console.log(`[DSH] 引导流程进行中，忽略本次触发 (${source})`)
    return
  }
  _dshBootstrapInFlight = true
  _dshShuttingDown = false

  try {
    startDshEditorHeartbeat()
    _dshLifecycle = 'probing'
    // 按安装的内核版本选中适配器：鉴权/流模式/RPC 翻译/事件归一化全部对齐该代际。
    // 内核升级或回滚后，下一次引导自动切换到对应适配器（编辑器零改动）。
    selectAdapterForKernel(getInstalledDshVersion())
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
    startDshAutoClaimWatch()
  } finally {
    _dshBootstrapInFlight = false
  }
}

/**
 * 优雅停机：注销本实例心跳，断开 mux WS，重置本地状态。
 * agent 为孤儿进程独立运行，编辑器退出不影响其生命周期。
 * 需要停止 agent 请使用 stop-dsh.bat。
 */
export async function stopDSHService(): Promise<void> {
  if (_dshLifecycle === 'off') return
  console.log('[DSH] 编辑器关闭，注销本实例（agent 为孤儿进程，继续运行）')
  _dshShuttingDown = true
  _dshLifecycle = 'off'
  if (_dshRestartTimer) { clearTimeout(_dshRestartTimer); _dshRestartTimer = null }
  if (_dshAutoClaimTimer) { clearInterval(_dshAutoClaimTimer); _dshAutoClaimTimer = null }
  disconnectMuxWs()
  stopDshEditorHeartbeat()
  _dshChild = null
  _dshPort = 0
}

// ─── 状态快照与重启编排（main.ts IPC / MCP 薄委托入口） ───

export function getDshPort(): number {
  return _dshPort
}

export function getDshLifecycle(): DshLifecycle {
  return _dshLifecycle
}

/** 服务是否可用于代理（chat-sync 等直连内核的场景） */
export function isDshServiceActive(): boolean {
  return _dshPort !== 0 && (_dshLifecycle === 'running' || _dshLifecycle === 'claimed')
}

/** dsh-status 快照（enginePort 由 main.ts 自行补充） */
export function getDshStatusSnapshot(): { ready: boolean; port: number; lifecycle: DshLifecycle; agentPid: number | null } {
  return {
    ready: _dshPort !== 0,
    port: _dshPort,
    lifecycle: _dshLifecycle,
    agentPid: readDshOwner()?.agentPid ?? null,
  }
}

/** 重启编排前复位自愈计数（ESM let 导出不可变写，统一收口于此） */
export function resetSelfHealCounters(): void {
  _dshRestartCount = 0
  _dshShuttingDown = false
}

/**
 * 完整重启编排：杀旧 agent → 优雅停机 → 复位自愈 → 等端口释放 → 重新引导。
 * dsh-restart IPC 与 MCP dsh-restart 命令共用此出口（三处重复实现收敛为一）。
 */
export async function restartDshAgent(source: string): Promise<void> {
  console.log(`[DSH] 收到重启请求 (${source})`)
  // 先杀旧 agent 进程（stopDSHService 只注销心跳不杀进程）
  const owner = readDshOwner()
  if (owner?.agentPid) {
    console.log(`[DSH] 重启(${source})：终止旧 agent PID=${owner.agentPid}`)
    killProcessTree(owner.agentPid)
  }
  await stopDSHService()
  resetSelfHealCounters()
  // 等待端口释放
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const alive = await probeDshAlive(DSH_PORT_DEFAULT, 500).catch(() => false)
    if (!alive) break
    await new Promise(r => setTimeout(r, 300))
  }
  console.log(`[DSH] 重启(${source})：端口已释放，启动新 agent`)
  void bootstrapDSH(source)
}
