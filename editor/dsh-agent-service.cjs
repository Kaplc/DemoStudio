/**
 * DSH Agent 服务 — 编辑器主进程内的 DSH 内核 HTTP 代理（CJS 版）
 *
 * 架构（DSH 作为引擎子系统启动）：
 *   ┌──────────────────────────────────────────────────────┐
 *   │ Electron main.ts                                      │
 *   │   ├─ startMCPServer()  → 引擎 HTTP :9877+           │
 *   │   └─ startDSHService() → DSHAgentService (本类)     │
 *   │                          ├─ spawn DSH runtime 子进程 │
 *   │                          ├─ 注入 globalThis.__dshEngineCtx │
 *   │                          ├─ 创建 EngineBridge/FileBridge │
 *   │                          └─ HTTP server :随机端口   │
 *   └──────────────────────────────────────────────────────┘
 *
 * 通信流：
 *   AgentPanel → /api/chat → DSHAgentService → DSH session.run()
 *     ↑                                                ↓
 *     └──── SSE message.delta / message / toolResult ──┘
 *
 * DSH 反向调引擎：
 *   DSH runtime (Cordis) → dsh-plugin 工具 → EngineBridge.callTool
 *   EngineBridge → http://127.0.0.1:ENGINE_PORT/api/command
 */
const http = require('node:http')
const net = require('node:net')
const path = require('node:path')
const fs = require('node:fs')

// ─── EngineBridge：把 DSH 工具调用转发到编辑器 HTTP API ───────────

function createEngineBridge(enginePort, logger) {
  const baseUrl = `http://127.0.0.1:${enginePort}`

  async function callApi(method, urlPath, body) {
    const url = `${baseUrl}${urlPath}`
    const init = {
      method,
      headers: { 'Content-Type': 'application/json' },
    }
    if (body !== undefined) init.body = JSON.stringify(body)
    const res = await fetch(url, init)
    const text = await res.text()
    let json
    try { json = JSON.parse(text) } catch { json = { raw: text } }
    if (!res.ok) {
      const err = new Error(`EngineBridge ${method} ${urlPath} failed: ${res.status} ${text}`)
      err.status = res.status
      err.payload = json
      throw err
    }
    return json
  }

  return {
    callTool: async (tool, args = {}) => {
      logger?.(`[engine-bridge] callTool ${tool} ${JSON.stringify(args).slice(0, 200)}`)
      return callApi('POST', '/api/command', { tool, args })
    },
    getStatus: async () => callApi('GET', '/api/status'),
    getConsoleLogs: async (limit = 100) => callApi('GET', `/api/console-logs?limit=${limit}`),
    getEnginePort: () => enginePort,
    getBaseUrl: () => baseUrl,
  }
}

// ─── FileBridge：在本进程内直接读写 JSON/资产文件 ───────────

function createFileBridge(workspaceRoot, logger) {
  function resolveSafe(relPath) {
    const abs = path.resolve(workspaceRoot, relPath)
    const root = path.resolve(workspaceRoot)
    if (!abs.startsWith(root + path.sep) && abs !== root) {
      throw new Error(`FileBridge: path '${relPath}' is outside workspace`)
    }
    return abs
  }

  return {
    readJsonFile: async (relPath) => {
      const abs = resolveSafe(relPath)
      logger?.(`[file-bridge] readJsonFile ${relPath}`)
      const text = await fs.promises.readFile(abs, 'utf8')
      return JSON.parse(text)
    },
    writeJsonFile: async (relPath, data) => {
      const abs = resolveSafe(relPath)
      logger?.(`[file-bridge] writeJsonFile ${relPath}`)
      await fs.promises.mkdir(path.dirname(abs), { recursive: true })
      await fs.promises.writeFile(abs, JSON.stringify(data, null, 2), 'utf8')
    },
    listDir: async (relPath) => {
      const abs = resolveSafe(relPath)
      return fs.promises.readdir(abs, { withFileTypes: true })
    },
    workspaceRoot: () => workspaceRoot,
  }
}

// ─── Profile 自举：确保 harness/profile/profiles/demostudio/ 存在 ───────────

function ensureProfile(workspaceRoot, logger) {
  const profileDir = path.join(workspaceRoot, 'harness', 'profile', 'profiles', 'demostudio')
  fs.mkdirSync(profileDir, { recursive: true })

  // package.json — 声明 dsh.profile.bundles（dsh CLI 读取）
  const pkgJson = path.join(profileDir, 'package.json')
  if (!fs.existsSync(pkgJson)) {
    const pkg = {
      name: 'demostudio-profile',
      version: '0.1.0',
      private: true,
      dsh: {
        profile: {
          bundles: ['@demostudio/dsh-engine-tools'],
        },
      },
    }
    fs.writeFileSync(pkgJson, JSON.stringify(pkg, null, 2), 'utf8')
    logger?.(`[profile] created ${pkgJson}`)
  }

  // node_modules/@demostudio/dsh-engine-tools → 软链接到 harness/dsh-plugin/
  ensureBundleLink({
    profileDir,
    packageName: '@demostudio/dsh-engine-tools',
    target: path.join(workspaceRoot, 'harness', 'dsh-plugin'),
    logger,
  })

  // node_modules/@deepseek-ai/dsh-sdk-jsonrpc-server → 软链接到 dsh-source
  // dsh-source 是 monorepo（pnpm workspace），包在 packages/sdk/server
  const sdkServerCandidates = [
    path.join(workspaceRoot, 'harness', 'dsh-source', 'node_modules', '@deepseek-ai', 'dsh-sdk-jsonrpc-server'),
    path.join(workspaceRoot, 'harness', 'dsh-source', 'packages', 'sdk', 'server'),
  ]
  for (const cand of sdkServerCandidates) {
    if (fs.existsSync(path.join(cand, 'package.json'))) {
      ensureBundleLink({
        profileDir,
        packageName: '@deepseek-ai/dsh-sdk-jsonrpc-server',
        target: cand,
        logger,
      })
      break
    }
  }

  return profileDir
}

function ensureBundleLink({ profileDir, packageName, target, logger }) {
  const linkDir = path.join(profileDir, 'node_modules', ...packageName.split('/'))
  fs.mkdirSync(path.dirname(linkDir), { recursive: true })
  if (fs.existsSync(linkDir)) {
    try {
      const stat = fs.lstatSync(linkDir)
      if (stat.isSymbolicLink() || stat.isFile()) return
    } catch { /* ignore */ }
  }
  try {
    fs.symlinkSync(target, linkDir, 'junction')
    logger?.(`[profile] symlinked ${linkDir} → ${target}`)
  } catch (err) {
    if (err.code === 'EEXIST') return
    copyDirSync(target, linkDir)
    logger?.(`[profile] copied (fallback) ${linkDir} ← ${target} (${err.code})`)
  }
}

function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dst, entry.name)
    if (entry.isDirectory()) copyDirSync(s, d)
    else if (entry.isFile()) fs.copyFileSync(s, d)
  }
}

// ─── DSH SDK client ───────────

function loadDSHSdk(sdkPath, logger) {
  const mod = require(sdkPath)
  const DeepSeekHarness = mod.DeepSeekHarness
  if (!DeepSeekHarness) throw new Error('SDK 未导出 DeepSeekHarness')
  logger?.(`[sdk] DeepSeekHarness loaded from ${sdkPath}`)
  return DeepSeekHarness
}

// ─── DSHAgentService ───────────

class DSHAgentService {
  constructor(opts) {
    this.opts = opts
    this.harness = null
    this.subscription = null
    this.running = false
    this.port = 0
    this.server = null
    this.sessions = new Map()
    this.sessionIdSeq = 0
    this.engineBridge = null
    this.fileBridge = null
  }

  log(line) {
    this.opts.output?.(line)
  }

  async start() {
    if (this.running) return this.port
    this.log('[dsh-agent] 启动 DSH Agent 服务...')

    this.engineBridge = createEngineBridge(this.opts.enginePort, (l) => this.log(l))
    this.fileBridge = createFileBridge(this.opts.workspaceRoot, (l) => this.log(l))

    globalThis.__dshEngineCtx = {
      engineBridge: this.engineBridge,
      fileBridge: this.fileBridge,
      workspaceRoot: this.opts.workspaceRoot,
    }
    this.log('[dsh-agent] 已注入 globalThis.__dshEngineCtx')

    const profileDir = ensureProfile(this.opts.workspaceRoot, (l) => this.log(l))
    this.log(`[dsh-agent] DSH profile: ${profileDir}`)

    await this.startDSHRuntime()

    this.port = await this.startHTTPServer()
    this.running = true
    this.log(`[dsh-agent] DSH Agent 服务已启动，端口: ${this.port}`)
    return this.port
  }

  async stop() {
    if (!this.running) return
    this.running = false

    for (const [, rec] of this.sessions) {
      try { rec.abort() } catch { /* ignore */ }
    }
    this.sessions.clear()

    if (this.subscription) {
      try { await this.subscription.return?.() } catch { /* ignore */ }
      this.subscription = null
    }
    if (this.harness) {
      try { await this.harness.close() } catch { /* ignore */ }
      this.harness = null
    }
    if (this.server) {
      this.server.close()
      this.server = null
    }
    delete globalThis.__dshEngineCtx
    this.log('[dsh-agent] DSH Agent 服务已停止')
  }

  isRunning() { return this.running }
  getPort() { return this.port }

  async startDSHRuntime() {
    const workspaceRoot = this.opts.workspaceRoot
    const dshBin = this.opts.dshBinPath
      ?? path.join(workspaceRoot, 'harness', 'dsh-source', 'apps', 'cli', 'lib', 'bin.js')
    const sdkPath = this.opts.sdkPath
      ?? path.join(workspaceRoot, 'harness', 'vscode-ext', 'node_modules', '@deepseek-ai', 'dsh-sdk-client')

    this.log(`[dsh-agent] DSH bin: ${dshBin}`)
    this.log(`[dsh-agent] DSH SDK: ${sdkPath}`)
    this.log(`[dsh-agent] 引擎端口: ${this.opts.enginePort}`)

    const DeepSeekHarness = loadDSHSdk(sdkPath, (l) => this.log(l))

    const dshHome = path.join(workspaceRoot, 'harness', 'profile')

    this.harness = new DeepSeekHarness({
      launch: {
        command: process.execPath,
        args: [
          dshBin,
          '--profile', 'demostudio',
        ],
        cwd: workspaceRoot,
        env: {
          ...process.env,
          DSH_HOME: dshHome,
          DSH_ENGINE_BASE_URL: `http://127.0.0.1:${this.opts.enginePort}`,
          DSH_PLUGIN_DIST: path.join(workspaceRoot, 'harness', 'dsh-plugin', 'dist'),
        },
      },
      provider: this.opts.provider ?? 'deepseek-official',
      model: this.opts.model ?? 'deepseek-v4-flash',
      maxTokens: 49152,
    })

    this.log('[dsh-agent] 正在启动 DSH runtime...')
    await this.harness.start()
    this.log('[dsh-agent] DSH runtime 已启动')

    this.subscription = this.harness.client.subscribe()
    void this.consumeSubscription(this.subscription)
  }

  async consumeSubscription(sub) {
    try {
      while (this.running) {
        const next = await sub.tryNext()
        if (next === undefined || next === null) {
          await new Promise((r) => setImmediate(r))
          continue
        }
        this.routeEvent(next)
      }
    } catch (err) {
      this.log(`[dsh-agent] 订阅消费异常: ${err}`)
    }
  }

  routeEvent(event) {
    const t = event.type
    const payload = event.payload ?? {}
    const lastSession = [...this.sessions.values()].pop()

    if (t === 'message.delta' || t === 'message_part' || t === 'text_chunk') {
      const content = String(payload.content ?? payload.text ?? '')
      if (content && lastSession) {
        lastSession.writeDelta(content)
        this.opts.onDelta?.(this.sessionIdOf(lastSession), content)
      }
      return
    }

    if (t === 'message' || t === 'agent.message' || t === 'assistant_message') {
      const content = String(payload.content ?? '')
      if (lastSession) {
        lastSession.writeDone(content)
        this.opts.onMessage?.(this.sessionIdOf(lastSession), content)
      }
      return
    }

    if (t === 'tool_use' || t === 'tool_call' || t === 'toolCall') {
      const name = String(payload.name ?? 'unknown')
      if (lastSession) {
        lastSession.writeDelta(`\n\n[tool_use] ${name}\n`)
      }
      return
    }

    if (t === 'tool_result' || t === 'toolResult') {
      const name = String(payload.name ?? 'unknown')
      const ok = !payload.isError
      if (lastSession) {
        lastSession.writeDelta(`\n[tool_result] ${name} → ${ok ? 'ok' : 'failed'}\n`)
      }
      return
    }

    if (t === 'error' || t === 'agent.error') {
      const msg = String(payload.message ?? 'DSH error')
      if (lastSession) lastSession.writeError(msg)
      this.opts.onError?.(msg)
      return
    }
  }

  sessionIdOf(rec) {
    for (const [id, r] of this.sessions) {
      if (r === rec) return id
    }
    return 'unknown'
  }

  async startHTTPServer() {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          this.log(`[dsh-agent] HTTP 错误: ${err}`)
          try {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ status: 'error', error: String(err) }))
          } catch { /* ignore */ }
        })
      })

      const probe = net.createServer()
      probe.listen(0, '127.0.0.1', () => {
        const port = probe.address().port
        probe.close(() => {
          server.listen(port, '127.0.0.1', () => resolve(port))
        })
      })
      probe.on('error', reject)
    })
  }

  async handleRequest(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        status: this.running ? 'ok' : 'starting',
        port: this.port,
        enginePort: this.opts.enginePort,
        dshRunning: !!this.harness,
        engineBridgeReady: !!this.engineBridge,
        fileBridgeReady: !!this.fileBridge,
      }))
      return
    }

    if (req.method === 'POST' && req.url === '/chat') {
      const body = await this.readBody(req)
      const { message, history } = JSON.parse(body)

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      res.write(': connected\n\n')

      const sessionId = `s-${++this.sessionIdSeq}`
      let aborted = false
      const rec = {
        message,
        history: history ?? [],
        writeDelta: (content) => {
          if (aborted) return
          res.write(`event: delta\ndata: ${JSON.stringify({ content })}\n\n`)
        },
        writeDone: (content) => {
          if (aborted) return
          res.write(`event: done\ndata: ${JSON.stringify({ content })}\n\n`)
          res.end()
          this.sessions.delete(sessionId)
        },
        writeError: (err) => {
          if (aborted) return
          res.write(`event: error\ndata: ${JSON.stringify({ error: err })}\n\n`)
          res.end()
          this.sessions.delete(sessionId)
        },
        abort: () => {
          aborted = true
          try { res.end() } catch { /* ignore */ }
          this.sessions.delete(sessionId)
        },
      }
      this.sessions.set(sessionId, rec)

      req.on('close', () => {
        if (!aborted) rec.abort()
      })

      try {
        const session = this.harness.session()
        await session.run(message, {
          history: rec.history,
          onNotification: (n) => this.routeEvent(n),
        })
      } catch (err) {
        rec.writeError(String(err))
      }
      return
    }

    if (req.method === 'POST' && req.url === '/chat-sync') {
      const body = await this.readBody(req)
      const { message, history } = JSON.parse(body)
      try {
        const session = this.harness.session()
        let buf = ''
        let resolved = false
        const onNotif = (n) => {
          if (n.type === 'message.delta' || n.type === 'message_part' || n.type === 'text_chunk') {
            buf += String(n.payload?.content ?? '')
          } else if (n.type === 'message' || n.type === 'agent.message') {
            buf = String(n.payload?.content ?? buf)
            if (!resolved) {
              resolved = true
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ status: 'ok', response: buf }))
            }
          } else if (n.type === 'error') {
            if (!resolved) {
              resolved = true
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ status: 'error', error: String(n.payload?.message) }))
            }
          }
        }
        await session.run(message, { history: history ?? [], onNotification: onNotif })
        if (!resolved) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'ok', response: buf }))
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'error', error: String(err) }))
      }
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not Found' }))
  }

  readBody(req) {
    return new Promise((resolve) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => resolve(body))
    })
  }
}

module.exports = { DSHAgentService, createEngineBridge, createFileBridge, ensureProfile }

// 入口自启（spawn 模式下由 electron/main.ts 拉起）
if (require.main === module) {
  const workspaceRoot = process.env.DSH_WORKSPACE_ROOT || process.cwd()
  const enginePort = Number(process.env.DSH_ENGINE_PORT || 0)
  if (!enginePort) {
    process.stderr.write('[dsh-agent] DSH_ENGINE_PORT 未设置，无法启动\n')
    process.exit(2)
  }
  const service = new DSHAgentService({
    workspaceRoot,
    enginePort,
    provider: process.env.DSH_PROVIDER,
    model: process.env.DSH_MODEL,
    output: (line) => process.stdout.write(`${line}\n`),
  })

  service.start().catch((err) => {
    process.stderr.write(`[dsh-agent] 启动失败: ${err}\n`)
    process.exit(1)
  })

  const stop = async () => {
    process.stderr.write('[dsh-agent] 收到退出信号，正在停止...\n')
    try { await service.stop() } catch { /* ignore */ }
    process.exit(0)
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}