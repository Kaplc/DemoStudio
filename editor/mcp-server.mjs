/**
 * DemoStudio MCP 服务器
 * 提供 VS Code MCP 工具来控制编辑器
 *
 * 使用方式:
 *   node editor/mcp-server.mjs
 *
 * VS Code MCP 配置 (.vscode/mcp.json):
 *   "demostudio-editor": {
 *     "command": "node",
 *     "args": ["editor/mcp-server.mjs"],
 *     "cwd": "E:\\DemoStudio"
 *   }
 */
import { spawn } from 'child_process'
import { createServer } from 'net'

const PORT = 9876
const HOST = '127.0.0.1'

// ─── 简单的 JSON-RPC MCP 服务器 ───

interface MCPRequest {
  id: number | string
  method: string
  params?: Record<string, any>
}

interface MCPResponse {
  id: number | string
  result?: any
  error?: { code: number; message: string }
}

const tools = {
  start_game: {
    name: 'start_game',
    description: '从编辑器启动贪吃蛇游戏',
    handler: async () => {
      return { status: 'ok', message: 'Game started (simulated)' }
    },
  },
  stop_game: {
    name: 'stop_game',
    description: '停止正在运行的游戏',
    handler: async () => {
      return { status: 'ok', message: 'Game stopped (simulated)' }
    },
  },
  toggle_game: {
    name: 'toggle_game',
    description: '切换游戏启动/停止',
    handler: async () => {
      return { status: 'ok', message: 'Game toggled (simulated)' }
    },
  },
  get_info: {
    name: 'get_info',
    description: '获取编辑器信息',
    handler: async () => {
      return {
        status: 'ok',
        editor: 'DemoStudio Editor v4.0.0',
        engine: 'Three.js + Electron + React',
        commands: [
          'start_game  - Launch the snake game',
          'stop_game   - Stop the running game',
          'toggle_game - Toggle game on/off',
          'get_info    - Show editor info',
        ],
      }
    },
  },
  send_command: {
    name: 'send_command',
    description: '发送控制台命令到编辑器',
    handler: async (params: { command?: string }) => {
      const cmd = params?.command || ''
      return { status: 'ok', command: cmd, message: `Command '${cmd}' sent to editor` }
    },
  },
}

// ─── MCP 传输层 (stdio) ───

function handleRequest(req: MCPRequest): Promise<MCPResponse> {
  const { id, method, params } = req

  if (method === 'list_tools') {
    return Promise.resolve({
      id,
      result: Object.values(tools).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: {
          type: 'object',
          properties: {},
        },
      })),
    })
  }

  if (method === 'call_tool') {
    const toolName = params?.name
    const tool = tools[toolName as keyof typeof tools]
    if (!tool) {
      return Promise.resolve({
        id,
        error: { code: -32601, message: `Tool not found: ${toolName}` },
      })
    }
    return tool.handler(params?.arguments).then((result) => ({
      id,
      result: {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      },
    }))
  }

  return Promise.resolve({
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  })
}

// ─── 启动 STDIO 服务器 ───

const encoder = new TextEncoder()
const decoder = new TextDecoder()

async function main() {
  const lines: string[] = []
  let buffer = ''

  process.stdin.on('data', (chunk: Buffer) => {
    buffer += decoder.decode(chunk, { stream: true })
    const parts = buffer.split('\n')
    buffer = parts.pop() || ''

    for (const line of parts) {
      const trimmed = line.trim()
      if (!trimmed) continue

      try {
        // JSON-RPC 解析 (支持带 Content-Length 头的 MCP 协议)
        let json = trimmed
        if (trimmed.startsWith('Content-Length:')) {
          continue // 跳过头部，下一行是 JSON
        }
        if (trimmed.startsWith('{')) {
          json = trimmed
        } else {
          // 可能是纯 JSON
          try {
            JSON.parse(trimmed)
            json = trimmed
          } catch {
            continue
          }
        }

        const req: MCPRequest = JSON.parse(json)
        handleRequest(req).then((res) => {
          const response = JSON.stringify(res) + '\n'
          process.stdout.write(encoder.encode(response))
        })
      } catch (e) {
        // 忽略解析错误
      }
    }
  })

  process.stdin.on('end', () => {
    process.exit(0)
  })

  // 发送初始化完成信号
  console.error('[MCP] DemoStudio Editor MCP Server 已启动')
}

main().catch(console.error)
