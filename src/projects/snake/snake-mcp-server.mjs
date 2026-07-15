/**
 * Snake Game MCP 服务器（基于 @modelcontextprotocol/sdk）
 * 独立于编辑器 MCP，提供贪吃蛇游戏专用控制工具
 *
 * VS Code MCP 配置 (.vscode/mcp.json):
 *   "snake-game": {
 *     "type": "stdio",
 *     "command": "node",
 *     "args": ["projects/snake/snake-mcp-server.mjs"],
 *     "cwd": "E:\\DemoStudio"
 *   }
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

const EDITOR_API = 'http://127.0.0.1:9877'

async function callEditor(command, params = {}) {
  try {
    const resp = await fetch(`${EDITOR_API}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, params }),
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    return await resp.json()
  } catch (err) {
    return { status: 'error', message: `编辑器不可达: ${err.message}` }
  }
}

async function getGameState() {
  try {
    const resp = await fetch(`${EDITOR_API}/api/game-state`)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    return await resp.json()
  } catch (err) {
    return { status: 'error', message: `编辑器不可达: ${err.message}` }
  }
}

async function getStatus() {
  try {
    const resp = await fetch(`${EDITOR_API}/api/status`)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    return await resp.json()
  } catch (err) {
    return { status: 'error', message: `编辑器不可达: ${err.message}` }
  }
}

// ─── 创建 MCP 服务器 ───

const server = new Server(
  { name: 'snake-game', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

// ─── 列出工具 ───

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'start_game',
      description: '启动贪吃蛇游戏',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'stop_game',
      description: '停止贪吃蛇游戏',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'toggle_game',
      description: '切换游戏启动/停止',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'send_input',
      description: '发送方向键控制蛇移动',
      inputSchema: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: '方向键: ArrowUp / ArrowDown / ArrowLeft / ArrowRight',
          },
        },
        required: ['key'],
      },
    },
    {
      name: 'get_game_state',
      description: '获取贪吃蛇实时状态（蛇头位置、分数、方向、食物位置等）',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}))

// ─── 调用工具 ───

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  switch (name) {
    case 'start_game': {
      const result = await callEditor('start_game')
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    }
    case 'stop_game': {
      const result = await callEditor('stop_game')
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    }
    case 'toggle_game': {
      const status = await getStatus()
      if (status.gameRunning) {
        const result = await callEditor('stop_game')
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        }
      } else {
        const result = await callEditor('start_game')
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        }
      }
    }
    case 'send_input': {
      const key = args?.key || ''
      const result = await callEditor('send_input', { key })
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    }
    case 'get_game_state': {
      const result = await getGameState()
      const data = result.data
      if (!data) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            status: 'ok',
            message: '游戏未运行，没有实时数据',
            data: null,
          }, null, 2) }],
        }
      }
      // 格式化输出为更可读的结构
      const formatted = {
        status: 'ok',
        game: {
          phase: data.phase,
          score: data.score,
          snakeLength: data.snakeLength,
          headPosition: data.headPosition,
          foodPosition: data.foodPosition,
          currentDirection: data.currentDirection,
        },
        summary: data.phase === 'gameover'
          ? `💀 Game Over · 得分: ${data.score} · 蛇长: ${data.snakeLength}`
          : data.phase === 'playing'
            ? `🐍 运行中 · 得分: ${data.score} · 蛇长: ${data.snakeLength} · 蛇头: (${data.headPosition?.x}, ${data.headPosition?.z}) · 食物: (${data.foodPosition.x}, ${data.foodPosition.z})`
            : `⏳ 等待中`,
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(formatted, null, 2) }],
      }
    }
    default:
      throw new Error(`未知工具: ${name}`)
  }
})

// ─── 启动 STDIO 传输 ───

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[MCP] Snake Game MCP Server 已启动')
}

main().catch((err) => {
  console.error('[MCP] 启动失败:', err)
  process.exit(1)
})
