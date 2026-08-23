/**
 * DSH 服务脚本 — 跟随编辑器启动的 AI 内核
 *
 * 启动方式：由 electron/main.ts 在编辑器启动时 spawn
 * 通信方式：
 *   - stdin/stdout: JSON-RPC（与 DSH runtime 通信）
 *   - HTTP API (端口 9878): 接收 Agent 面板的聊天请求
 *
 * 架构：
 *   Agent 面板 → HTTP POST /chat → 本脚本 → JSON-RPC → DSH runtime → DeepSeek API
 */

import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ─── 配置 ───

const DSH_PORT = 9878
const DSH_SOURCE = resolve(__dirname, '..', 'harness', 'dsh-source')
const DSH_CLI = resolve(DSH_SOURCE, 'apps', 'cli', 'lib', 'bin.js')
const DSH_PROFILE = resolve(__dirname, '..', 'harness', 'profile', 'dsh.profile')

// ─── DSH Runtime 管理 ───

class DSHRuntime {
  constructor() {
    this.process = null
    this.requestId = 0
    this.pendingRequests = new Map()
    this.messageBuffer = ''
    this.ready = false
  }

  async start() {
    console.log('[DSH] 启动 DSH runtime...')
    console.log(`[DSH] CLI: ${DSH_CLI}`)
    console.log(`[DSH] Profile: ${DSH_PROFILE}`)

    // 检查 DSH CLI 是否存在
    if (!existsSync(DSH_CLI)) {
      throw new Error(`DSH CLI 不存在: ${DSH_CLI}`)
    }

    // 启动 DSH 子进程（headless 模式 + JSON-RPC）
    this.process = spawn('node', [DSH_CLI, '--profile', 'headless'], {
      cwd: DSH_SOURCE,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        DSH_PROFILE_PATH: DSH_PROFILE,
      }
    })

    this.process.stdout.on('data', (data) => this.handleStdout(data))
    this.process.stderr.on('data', (data) => {
      const msg = data.toString().trim()
      if (msg) console.log(`[DSH:stderr] ${msg}`)
    })

    this.process.on('exit', (code) => {
      console.log(`[DSH] 进程退出: ${code}`)
      this.ready = false
      // 通知所有等待的请求
      for (const [id, pending] of this.pendingRequests) {
        pending.reject(new Error('DSH 进程已退出'))
      }
      this.pendingRequests.clear()
    })

    this.process.on('error', (err) => {
      console.error(`[DSH] 启动失败: ${err.message}`)
      this.ready = false
    })

    // 等待 DSH 就绪（通过 stderr 输出判断）
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('DSH 启动超时')), 30000)

      const onStderr = (data) => {
        const msg = data.toString()
        if (msg.includes('ready') || msg.includes('listening') || msg.includes('started')) {
          clearTimeout(timeout)
          this.process.stderr.removeListener('data', onStderr)
          this.ready = true
          resolve()
        }
      }

      this.process.stderr.on('data', onStderr)

      // 如果 3 秒后没有明确的就绪信号，假设已就绪
      setTimeout(() => {
        if (!this.ready) {
          clearTimeout(timeout)
          this.process.stderr.removeListener('data', onStderr)
          this.ready = true
          console.log('[DSH] 假设已就绪（无明确就绪信号）')
          resolve()
        }
      }, 3000)
    })

    console.log('[DSH] DSH runtime 已启动')
  }

  handleStdout(data) {
    this.messageBuffer += data.toString()

    // 尝试解析 JSON-RPC 响应
    const lines = this.messageBuffer.split('\n')
    this.messageBuffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const response = JSON.parse(line)
        this.handleResponse(response)
      } catch (e) {
        // 非 JSON 输出，可能是 DSH 的日志
        console.log(`[DSH:stdout] ${line}`)
      }
    }
  }

  handleResponse(response) {
    const { id, result, error } = response

    if (id && this.pendingRequests.has(id)) {
      const pending = this.pendingRequests.get(id)
      this.pendingRequests.delete(id)

      if (error) {
        pending.reject(new Error(error.message || 'DSH 请求失败'))
      } else {
        pending.resolve(result)
      }
    }
  }

  async sendRequest(method, params = {}) {
    if (!this.ready || !this.process) {
      throw new Error('DSH 未就绪')
    }

    const id = ++this.requestId
    const request = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`DSH 请求超时: ${method}`))
      }, 60000) // 60秒超时

      this.pendingRequests.set(id, {
        resolve: (result) => {
          clearTimeout(timeout)
          resolve(result)
        },
        reject: (err) => {
          clearTimeout(timeout)
          reject(err)
        }
      })

      this.process.stdin.write(JSON.stringify(request) + '\n')
    })
  }

  async chat(message, history = []) {
    try {
      // 构建消息格式
      const messages = [
        ...history.map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content: message }
      ]

      // 发送聊天请求
      const result = await this.sendRequest('session/prompt', {
        messages,
        stream: false,
      })

      return result?.content || result?.message || '收到消息，正在处理...'
    } catch (err) {
      console.error(`[DSH] 聊天请求失败: ${err.message}`)
      throw err
    }
  }

  async stop() {
    if (this.process) {
      try {
        await this.sendRequest('shutdown')
      } catch {
        // 忽略关闭错误
      }
      this.process.kill()
      this.process = null
    }
    this.ready = false
  }

  isReady() {
    return this.ready
  }
}

// ─── HTTP API 服务器 ───

class DSHService {
  constructor() {
    this.runtime = new DSHRuntime()
    this.server = null
  }

  async start() {
    // 启动 DSH runtime
    await this.runtime.start()

    // 启动 HTTP 服务器
    this.server = createServer((req, res) => {
      this.handleRequest(req, res)
    })

    return new Promise((resolve) => {
      this.server.listen(DSH_PORT, '127.0.0.1', () => {
        console.log(`[DSH] HTTP API 已启动: http://127.0.0.1:${DSH_PORT}`)
        resolve()
      })
    })
  }

  async handleRequest(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // 健康检查
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        status: this.runtime.isReady() ? 'ready' : 'starting',
        service: 'dsh-service'
      }))
      return
    }

    // 聊天接口
    if (req.method === 'POST' && req.url === '/chat') {
      let body = ''
      req.on('data', chunk => body += chunk)
      req.on('end', async () => {
        try {
          const { message, history } = JSON.parse(body)

          if (!this.runtime.isReady()) {
            res.writeHead(503, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'DSH 未就绪' }))
            return
          }

          const response = await this.runtime.chat(message, history)

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            status: 'ok',
            response: response
          }))
        } catch (err) {
          console.error(`[DSH] 聊天错误: ${err.message}`)
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            status: 'error',
            error: err.message
          }))
        }
      })
      return
    }

    // 流式聊天接口（SSE）
    if (req.method === 'POST' && req.url === '/chat/stream') {
      let body = ''
      req.on('data', chunk => body += chunk)
      req.on('end', async () => {
        try {
          const { message, history } = JSON.parse(body)

          if (!this.runtime.isReady()) {
            res.writeHead(503, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'DSH 未就绪' }))
            return
          }

          // 设置 SSE headers
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          })

          // 流式响应
          try {
            const result = await this.runtime.chat(message, history)
            res.write(`data: ${JSON.stringify({ content: result })}\n\n`)
            res.write('data: [DONE]\n\n')
          } catch (err) {
            res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
          }

          res.end()
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message }))
        }
      })
      return
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not Found' }))
  }

  async stop() {
    if (this.server) {
      this.server.close()
    }
    await this.runtime.stop()
  }
}

// ─── 主流程 ───

const service = new DSHService()

// 优雅关闭
process.on('SIGTERM', async () => {
  console.log('[DSH] 收到 SIGTERM，正在关闭...')
  await service.stop()
  process.exit(0)
})

process.on('SIGINT', async () => {
  console.log('[DSH] 收到 SIGINT，正在关闭...')
  await service.stop()
  process.exit(0)
})

// 启动服务
try {
  await service.start()
  console.log('[DSH] 服务已启动，等待请求...')

  // 通知父进程已就绪
  if (process.send) {
    process.send({ type: 'ready', port: DSH_PORT })
  }
} catch (err) {
  console.error(`[DSH] 启动失败: ${err.message}`)
  process.exit(1)
}
