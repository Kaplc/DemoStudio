/**
 * DSH Agent Watcher —— agent 所有权看门狗（detached 常驻进程）
 *
 * 职责（不改 DSH 内核前提下的所有权实现载体）：
 *   1. 监视「编辑器注册表」心跳目录：<state-dir>/editors/<pid>.json
 *      - 每个存活的 DemoStudio 编辑器实例每 2s touch 自己的心跳文件
 *   2. 当连续 GRACE_MS 时长内不存在任何新鲜编辑器心跳时，
 *      判定编辑器已彻底消失（崩溃/强杀，而非重启中）→ 杀掉 agent 进程树并自杀
 *   3. 启动时把自身 PID 写入 <state-dir>/owner.json 的 watchdogPid 字段
 *      （main 进程据此判断 watchdog 是否存活、是否需要重新拉起）
 *
 * 为什么需要独立进程：孤儿检测必须有一个「比编辑器活得久」的第三方进程。
 * 本进程以 detached 方式 spawn（stdio ignore），与 Electron main 无父子生命周期绑定。
 *
 * 协议文件（均在本进程管理的 state-dir 下）：
 *   owner.json    { port, agentPid, watchdogPid, claimedAt }   ← main 写 / watcher 读+更新自身字段
 *   editors/*.json { pid, startedAt, heartbeatAt }             ← 每个 main 实例维护自己的
 *   watchdog.log   本进程运行日志（滚动截断）
 */
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

// ─── 配置常量 ───
const WATCH_INTERVAL_MS = 1000       // 巡检间隔
const HEARTBEAT_STALE_MS = 6000      // 心跳过期阈值（需大于编辑器心跳周期 2s × 3 容忍抖动）
const LOG_MAX_BYTES = 256 * 1024     // 日志滚动上限
const AGENT_KILL_WAIT_MS = 8000      // 发出 kill 树命令后的等待上限（超时则硬自杀兜底）

// ─── 参数解析 ───
function parseArgs(argv) {
  const args = {}
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i]
    if (k === '--state-dir') args.stateDir = argv[++i]
    else if (k === '--grace-ms') args.graceMs = Number(argv[++i])
  }
  return args
}

const opts = parseArgs(process.argv)
const stateDir = opts.stateDir || ''
const graceMs = Number.isFinite(opts.graceMs) && opts.graceMs > 0 ? opts.graceMs : 30000
const editorsDir = stateDir ? path.join(stateDir, 'editors') : ''
const logFile = stateDir ? path.join(stateDir, 'watchdog.log') : ''

function log(msg) {
  const line = `[${new Date().toISOString()}][watcher:${process.pid}] ${msg}`
  console.log(line)
  if (!logFile) return
  try {
    // 简单滚动：超限则重写为最后 64KB
    try {
      const st = fs.statSync(logFile)
      if (st.size > LOG_MAX_BYTES) {
        const buf = fs.readFileSync(logFile)
        fs.writeFileSync(logFile, buf.subarray(buf.length - 64 * 1024))
      }
    } catch { /* 文件尚不存在 */ }
    fs.appendFileSync(logFile, line + '\n', 'utf-8')
  } catch { /* 日志失败不影响主流程 */ }
}

/** 平台无关的 PID 存活检测 */
function isPidAlive(pid) {
  if (!pid || !Number.isFinite(pid)) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM' // EPERM 视为存在（权限不足但进程活着）
  }
}

/** 强制结束进程树（Windows: taskkill /T /F；其他平台仅 kill 主进程） */
function killTree(pid) {
  return new Promise((resolve) => {
    if (!isPidAlive(pid)) return resolve(false)
    log(`kill 进程树: ${pid}`)
    if (process.platform === 'win32') {
      const t = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
      t.on('close', () => resolve(true))
      t.on('error', () => resolve(true))
    } else {
      try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ }
      resolve(true)
    }
  })
}

/** 读 editor 心跳注册表，返回仍新鲜且存活的条目列表；顺带清理过期文件 */
function scanFreshEditors(now) {
  let entries = []
  try {
    const files = fs.readdirSync(editorsDir)
    for (const f of files) {
      if (!f.endsWith('.json')) continue
      const full = path.join(editorsDir, f)
      try {
        const raw = JSON.parse(fs.readFileSync(full, 'utf-8'))
        const hbAge = now - Number(raw.heartbeatAt || 0)
        if (hbAge > HEARTBEAT_STALE_MS) {
          fs.rmSync(full, { force: true }) // 过期心跳就地清理
          continue
        }
        if (!isPidAlive(Number(raw.pid))) {
          // 进程已死但心跳未及时清理 → 由本进程代为删除
          fs.rmSync(full, { force: true })
          continue
        }
        entries.push(raw)
      } catch { /* 单个文件损坏忽略 */ }
    }
  } catch { /* 目录不存在视为空 */ }
  return entries
}

function readOwner() {
  try {
    return JSON.parse(fs.readFileSync(path.join(stateDir, 'owner.json'), 'utf-8'))
  } catch { return null }
}

function writeSelfIntoOwner(owner) {
  const next = {
    ...(owner || {}),
    watchdogPid: process.pid,
  }
  try {
    fs.writeFileSync(path.join(stateDir, 'owner.json'), JSON.stringify(next, null, 2))
    return true
  } catch (err) {
    log(`写入 owner.json 失败: ${err.message}`)
    return false
  }
}

async function main() {
  if (!stateDir || !fs.existsSync(stateDir)) {
    console.error('[watcher] 缺少有效 --state-dir，退出')
    process.exit(1)
  }

  // 向 main 汇报自身 PID（自报家门，消除 main 侧写文件与 spawn 的竞态窗口）
  const initialOwner = readOwner()
  writeSelfIntoOwner(initialOwner)
  log(`watcher 启动 stateDir=${stateDir} graceMs=${graceMs} owner=${JSON.stringify(initialOwner)}`)

  let orphanMs = 0            // 连续无活跃编辑器的累计时长
  let noOwnerMs = 0           // 连续读不到 owner.json 的累计时长

  while (true) {
    await new Promise(r => setTimeout(r, WATCH_INTERVAL_MS))
    const now = Date.now()

    const owner = readOwner()
    if (!owner) {
      noOwnerMs += WATCH_INTERVAL_MS
      // 长时间没有 owner 信息 → 没有 agent 可守，无事可做即退出
      if (noOwnerMs >= graceMs) {
        log(`owner.json 连续 ${noOwnerMs}ms 不存在，watcher 自行退出`)
        process.exit(0)
      }
      continue
    }
    noOwnerMs = 0

    const freshEditors = scanFreshEditors(now)

    if (freshEditors.length > 0) {
      if (orphanMs !== 0) log(`检测到 ${freshEditors.length} 个活跃编辑器，宽限计数清零`)
      orphanMs = 0
      continue
    }

    orphanMs += WATCH_INTERVAL_MS
    if (orphanMs % 5000 < WATCH_INTERVAL_MS) {
      log(`无活跃编辑器心跳 ${orphanMs}/${graceMs}ms`)
    }

    if (orphanMs >= graceMs) {
      // 宽限期满：所有编辑器确已消失 → 收割 agent 进程树并自我了断
      const agentPid = Number(owner.agentPid || 0)
      log(`宽限期(${graceMs}ms)满且无任何活跃编辑器 → 终止 agent(PID=${agentPid || '?'})`)
      await killTree(agentPid)
      try { fs.rmSync(path.join(stateDir, 'owner.json'), { force: true }) } catch { /* ignore */ }
      try { fs.rmSync(editorsDir, { recursive: true, force: true }) } catch { /* ignore */ }
      log('收割完成，watcher 退出')
      // 兜底确保进程一定退出（避免句柄挂起）
      setTimeout(() => process.exit(0), AGENT_KILL_WAIT_MS).unref()
      process.exit(0)
    }
  }
}

process.on('uncaughtException', (err) => {
  log(`uncaughtException: ${err && err.stack ? err.stack : err}`)
})

main().catch((err) => {
  log(`fatal: ${err && err.stack ? err.stack : err}`)
  process.exit(1)
})
