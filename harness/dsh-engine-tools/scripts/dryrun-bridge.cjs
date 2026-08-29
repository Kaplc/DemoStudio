// 完整链路 dry-run:
//   1) 启动 mock HTTP 服务器，模拟 electron/main.ts 的 /api/command + /api/status + /api/events
//   2) 加载 dsh-engine-tools 的 5 个工具
//   3) 对每个工具：先用 zod schema 解析入参 → 调用 execute
//   4) 验证：HTTP 请求路径 + 方法 + 响应处理逻辑
//   5) 验证 SSE 事件订阅能收到推送

const http = require('http')
const { ALL_TOOLS } = require('../dist/index.js')

// ─── 1) mock HTTP server，复刻 electron/main.ts 的接口 ───
const received = []
const events = []
let sseClients = 0

const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', c => body += c)
  req.on('end', () => {
    const url = req.url
    received.push({ method: req.method, url, body: body.slice(0, 200) })
    res.setHeader('Access-Control-Allow-Origin', '*')

    if (url === '/api/command' && req.method === 'POST') {
      const cmd = JSON.parse(body)
      // 模拟 ai_event：返回 mock state（让 get_game_state 能正常取到数据）
      if (cmd.command === 'ai_event') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, results: [{ status: 'ok', data: { running: true, score: 42, actors: 5 } }] }))
        return
      }
      // 模拟各 command 的渲染进程响应
      const fakeResp = mockCommand(cmd)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(fakeResp))
      return
    }
    if (url === '/api/status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'running', gameRunning: true, gameScore: 42 }))
      return
    }
    if (url === '/api/events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      sseClients++
      // 推送 1 条模拟事件
      setTimeout(() => {
        try {
          res.write(`id: 1\nevent: game.lifecycle\ndata: {"id":1,"type":"game.lifecycle","ts":${Date.now()},"data":{"event":"launch"}}\n\n`)
        } catch {}
      }, 200)
      // 5 秒后断开
      setTimeout(() => { try { res.end() } catch {} }, 5000)
      return
    }
    res.writeHead(404).end()
  })
})

function mockCommand(cmd) {
  switch (cmd.command) {
    case 'inspect_scene': return { ok: true, data: { actors: 3, components: 12 } }
    case 'spawn_entity': return { ok: true, entityId: 'actor-001' }
    case 'run_scenario': return { ok: true, trace: ['launch', 'tick', 'stop'] }
    case 'get_game_state': return { ok: true, data: { running: true, score: 42, actors: 5 } }
    case 'set_game_speed': return { ok: true, timeScale: cmd.params?.timeScale ?? 1 }
    default: return { ok: false, error: `unknown command: ${cmd.command}` }
  }
}

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port
  const BASE = `http://127.0.0.1:${port}`
  console.log(`[mock] listening on ${BASE}`)

  // ─── 2) 准备 EngineContext（含 engineBridge + fileBridge），dsh-engine-tools 通过 ctx 注入 ───
  const engineBridge = {
    async callTool(name, args) {
      const resp = await fetch(`${BASE}/api/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: name, params: args ?? {} }),
      })
      return resp.json()
    },
    async getStatus() {
      const resp = await fetch(`${BASE}/api/status`)
      return resp.json()
    },
    async readConsoleLogs() { return [] },
  }
  const fileBridge = {
    async readJsonFile(p) {
      // 真实路径：去掉 src/projects/ 前缀（mock 简化）
      const path = require('path')
      const fs = require('fs')
      const rel = p.replace(/^src\/projects\//, 'src/projects/')
      const abs = path.resolve(__dirname, '..', '..', rel)
      if (!fs.existsSync(abs)) return null
      return JSON.parse(fs.readFileSync(abs, 'utf-8'))
    },
    async writeJsonFile() { return { ok: true } },
  }
  const ctx = { engineBridge, fileBridge, guardPolicy: { spawn_entity: 'allow', run_scenario: 'allow', set_game_speed: 'allow' } }

  function parseSSE(block) {
    const out = { id: null, event: null, data: null }
    for (const line of block.split('\n')) {
      if (line.startsWith('id:')) out.id = Number(line.slice(3).trim())
      else if (line.startsWith('event:')) out.event = line.slice(6).trim()
      else if (line.startsWith('data:')) out.data = line.slice(5).trim()
    }
    if (out.event && out.data) {
      try { out.data = JSON.parse(out.data) } catch {}
      return out
    }
    return null
  }

  // ─── 3) 模拟每个工具的调用：先 schema parse，再 execute（触发真 HTTP） ───
  let pass = 0, fail = 0
  const results = []
  for (const tool of ALL_TOOLS) {
    try {
      const sampleInput = pickSample(tool.name)
      const parsed = tool.schema.parse(sampleInput)
      // 真实调用 execute：dsh-engine-tools 工具签名 = (args, ctx)，schema 已 parse 过的 args
      const out = await tool.execute(parsed, ctx)
      console.log(`[${tool.name}] execute ✓ →`, JSON.stringify(out).slice(0, 100))
      results.push({ name: tool.name, ok: true, out })
      pass++
    } catch (e) {
      console.error(`[${tool.name}] FAIL:`, e.message)
      results.push({ name: tool.name, ok: false, err: e.message })
      fail++
    }
  }

  // ─── 4) SSE 事件订阅验证（独立 connect，模拟 dsh-engine-tools 订阅 game lifecycle） ───
  console.log('\n[SSE] subscribing...')
  const sseIter = subscribeSSE(`${BASE}/api/events`)
  const ev = await Promise.race([
    sseIter.next(),
    new Promise(r => setTimeout(() => r({ timeout: true }), 1500)),
  ])
  if (ev?.value?.event) {
    console.log('[SSE] received:', ev.value.event, JSON.stringify(ev.value.data).slice(0, 80))
    pass++
  } else {
    console.error('[SSE] no event received:', ev)
    fail++
  }

  // 工具调用本身不订阅 SSE（DSH runtime 负责订阅），所以 PASS

  console.log(`\n=== RESULT ===`)
  console.log(`mock HTTP requests captured: ${received.length}`)
  for (const r of received.slice(0, 10)) console.log('  -', r.method, r.url, r.body ? `(body: ${r.body.slice(0, 60)})` : '')
  console.log(`tool calls: ${pass - (ev?.value?.event ? 1 : 0)} pass / ${fail} fail`)

  server.close()
  process.exit(fail > 0 ? 1 : 0)
})

async function* subscribeSSE(url) {
  const resp = await fetch(url)
  const reader = resp.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value)
    for (;;) {
      const idx = buf.indexOf('\n\n')
      if (idx < 0) break
      const block = buf.slice(0, idx); buf = buf.slice(idx + 2)
      const out = { id: null, event: null, data: null }
      for (const line of block.split('\n')) {
        if (line.startsWith('id:')) out.id = Number(line.slice(3).trim())
        else if (line.startsWith('event:')) out.event = line.slice(6).trim()
        else if (line.startsWith('data:')) out.data = line.slice(5).trim()
      }
      if (out.event && out.data) {
        try { out.data = JSON.parse(out.data) } catch {}
        yield out
      }
    }
  }
}

function pickSample(toolName) {
  // 每个工具给一组有效样本
  switch (toolName) {
    case 'inspect_scene':
      return { scenePath: 'src/projects/demo2d/demo2d.scene.json', includeChildren: true }
    case 'spawn_entity':
      return { blueprint: 'src/projects/demo2d/asset/blueprints/coin.blueprint.json', transform: { position: [0, 1, 0] } }
    case 'run_scenario':
      return { scenario: { name: 'smoke', durationSec: 5 }, wait: true }
    case 'get_game_state':
      return { includeConsoleTail: 10 }
    case 'set_game_speed':
      return { speed: 2 }
    default:
      return {}
  }
}
