/**
 * DemoStudio MCP 服务器（基于 @modelcontextprotocol/sdk）
 * 提供 VS Code MCP 工具来控制编辑器
 * 通过 HTTP 与 Electron 主进程通信
 *
 * VS Code MCP 配置 (.vscode/mcp.json):
 *   "demostudio-editor": {
 *     "type": "stdio",
 *     "command": "node",
 *     "args": ["editor/mcp-server.mjs"],
 *     "cwd": "E:\\DemoStudio"
 *   }
 *
 * 多实例支持：
 *   第一个编辑器实例的 MCP API 端口为 9877，后续实例自动递增（9878、9879...）。
 *   连接指定实例时传入 --port 参数，例如:
 *     node editor/mcp-server.mjs --port 9878
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

// 解析 --port 参数（多实例场景下连接指定编辑器实例）
function resolveEditorPort() {
  const idx = process.argv.indexOf('--port')
  if (idx !== -1 && process.argv[idx + 1]) {
    const port = Number(process.argv[idx + 1])
    if (Number.isInteger(port) && port > 0) return port
  }
  return 9877
}

const EDITOR_PORT = resolveEditorPort()
const EDITOR_API = `http://127.0.0.1:${EDITOR_PORT}`

console.error(`[MCP] 连接编辑器实例: ${EDITOR_API}`)

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

async function getEditorStatus() {
  try {
    const resp = await fetch(`${EDITOR_API}/api/status`)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    return await resp.json()
  } catch (err) {
    return { status: 'error', message: `编辑器不可达: ${err.message}` }
  }
}

async function fetchConsoleLogs() {
  try {
    const resp = await fetch(`${EDITOR_API}/api/console-logs`)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    return await resp.json()
  } catch (err) {
    return { status: 'error', message: `编辑器不可达: ${err.message}` }
  }
}

// ─── 创建 MCP 服务器 ───

const server = new Server(
  { name: 'demostudio-editor', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

// ─── 列出工具 ───

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'start_game',
      description: '从编辑器启动贪吃蛇游戏',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'stop_game',
      description: '停止正在运行的游戏',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'toggle_game',
      description: '切换游戏启动/停止',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_status',
      description: '获取编辑器状态（游戏是否运行、分数等）',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'send_command',
      description: '发送控制台命令到编辑器',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '控制台命令文本' },
        },
        required: ['command'],
      },
    },
    {
      name: 'send_input',
      description: '发送键盘按键到编辑器（方向键控制蛇移动）',
      inputSchema: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: '按键名，如 ArrowUp/ArrowDown/ArrowLeft/ArrowRight',
          },
        },
        required: ['key'],
      },
    },
    {
      name: 'get_console_logs',
      description: '获取浏览器控制台最近日志（含报错信息）',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'ai_event',
      description:
        '发送 AI 事件到引擎（事件模式，控制游戏场景或编辑器选中/gizmo）。' +
        '游戏事件(需运行): ai.notify(通知), ai.spawnActor({blueprint|baseClass,name?,position?,rotation?,scale?}), ' +
        'ai.destroyActor({name}), ai.transformActor({name,position?,rotation?,scale?}), ' +
        'ai.setScore({score}), ai.addScore({amount}), ai.gameOver, ' +
        'ai.switchScene({scene}), ai.clickActor({name}) 按大纲名点击 UI 按钮(无需鼠标坐标), ' +
        'ai.getState(查询运行状态), ai.showMessage({text})。' +
        '编辑器事件(无需运行): ai.selectActor({name}) 选中场景 Actor 显示 gizmo, ' +
        'ai.dragActor({name,axis:"x"|"y"|"z",delta} 或 {name,position:[x,y,z]}) 拖动 Actor(等价 gizmo 拖拽)。' +
        'notify/getState/selectActor/dragActor 无需游戏运行。',
      inputSchema: {
        type: 'object',
        properties: {
          event: { type: 'string', description: '事件名，如 ai.spawnActor / ai.getState' },
          payload: {
            type: 'object',
            description: '事件参数（事件名对应的 payload）',
            additionalProperties: true,
          },
        },
        required: ['event'],
      },
    },
    {
      name: 'ai_list_events',
      description: '列出引擎当前已注册的 AI 事件名',
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
      const status = await getEditorStatus()
      if (status.gameRunning) {
        return (await callEditor('stop_game'))
      } else {
        return (await callEditor('start_game'))
      }
    }
    case 'get_status': {
      const info = await getEditorStatus()
      return {
        content: [{ type: 'text', text: JSON.stringify(info, null, 2) }],
      }
    }
    case 'send_command': {
      const cmd = args?.command || ''
      await callEditor('addConsoleOutput', { text: `> ${cmd}` })
      return {
        content: [{ type: 'text', text: JSON.stringify({ status: 'ok', command: cmd }, null, 2) }],
      }
    }
    case 'send_input': {
      const key = args?.key || ''
      await callEditor('send_input', { key })
      return {
        content: [{ type: 'text', text: JSON.stringify({ status: 'ok', key }, null, 2) }],
      }
    }
    case 'get_console_logs': {
      const result = await fetchConsoleLogs()
      const logs = result.logs || []
      const errorLogs = logs.filter(l => l.includes('[CONSOLE:ERROR]') || l.includes('[CONSOLE:WARNING]'))
      const text = logs.length === 0
        ? JSON.stringify({ status: 'ok', message: '暂无控制台日志' }, null, 2)
        : JSON.stringify({
            status: 'ok',
            total: logs.length,
            errors: errorLogs.length,
            logs,
          }, null, 2)
      return {
        content: [{ type: 'text', text }],
      }
    }
    case 'ai_event': {
      const event = args?.event || ''
      if (!event) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ status: 'error', message: '缺少 event 参数' }, null, 2) }],
        }
      }
      const result = await callEditor('ai_event', { event, payload: args?.payload ?? {} })
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    }
    case 'ai_list_events': {
      const result = await callEditor('ai_list_events', {})
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
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
  console.error('[MCP] DemoStudio Editor MCP Server 已启动 (SDK)')
}

main().catch((err) => {
  console.error('[MCP] 启动失败:', err)
  process.exit(1)
})
