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
import { cdpTools, handleCdpTool } from './mcp-cdp.mjs'

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

// ─── 创建 MCP 服务器 ───

const server = new Server(
  { name: 'demostudio-editor', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

// ─── 列出工具 ───

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'ui_compile',
      description:
        '编译 UI 资产 HTML 源（*.widget.html）为 widget.json（devdoc/ui-html-source-format 方案）。' +
        '流程：读取 .widget.html → 编译 → assetLint 零错误门槛 → 覆写 .widget.json 并同步编辑器预览。' +
        '错误信息面向源文件（line 指向 .widget.html）。参数 asset = widget 资产路径' +
        '（src/projects/<folder>/asset/blueprints/ui/xxx.widget.json），源文件为同目录同名 .widget.html',
      inputSchema: {
        type: 'object',
        properties: {
          asset: {
            type: 'string',
            description: 'widget 资产路径（src/projects/<folder>/asset/blueprints/ui/xxx.widget.json）',
          },
        },
        required: ['asset'],
      },
    },
    {
      name: 'ui_decompile',
      description:
        '反编译 widget.json → 回写 .widget.html（与 ui_compile 反向）。' +
        '流程：读取已落盘的 .widget.json → 反编译为 HTML → 覆写同目录同名 .widget.html。' +
        '适用于手动保存后需要同步源文件的场景。参数 asset = widget 资产路径' +
        '（src/projects/<folder>/asset/blueprints/ui/xxx.widget.json）。',
      inputSchema: {
        type: 'object',
        properties: {
          asset: {
            type: 'string',
            description: 'widget 资产路径（src/projects/<folder>/asset/blueprints/ui/xxx.widget.json）',
          },
        },
        required: ['asset'],
      },
    },
    {
      name: 'get_scene_outline',
      description:
        '获取编辑器当前场景的 Actor 大纲树（3D + UI Actor 层级结构）。' +
        '返回每个节点的 name/type/components/children，可选 project 参数指定目标工程。',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: '目标工程 folder（可选，缺省=当前打开的工程）' },
        },
      },
    },
    {
      name: 'get_ui_outline',
      description:
        '获取运行中游戏的 UI Widget 大纲树（HUD/面板/按钮等 UI 元素层级）。' +
        '需要游戏正在运行，返回每个 UI 节点的 name/type/active/components/children。',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'get_assets',
      description:
        '获取当前工程的资产浏览器文件列表（所有 .json/.ts/.html 等资源文件）。' +
        '返回每个文件的 path/ext/size 信息。',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: '目标工程 folder（可选，缺省=当前打开的工程）' },
        },
      },
    },
    {
      name: 'run_asset_lint',
      description:
        '手动触发资产检查（assetLint 全量扫描，绕过内容指纹缓存）。' +
        '覆盖工程 asset/ 下全部 .scene.json / .blueprint.json / .widget.json / 配置表资产，' +
        '返回 { status, total, errors, warns, issues[] }（每条含 file/nodePath/field/rule/severity/message）。' +
        '创建或修改场景/蓝图/UI/配置资产后必须调用，errors 必须为 0。' +
        '参数 project = 工程 folder 或显示名（可选，缺省=当前打开的工程）。',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: '目标工程 folder（可选，缺省=当前打开的工程）' },
        },
      },
    },
    // ─── CDP 浏览器操控工具（from mcp-cdp.mjs）───
    ...cdpTools,
  ],
}))

// ─── 调用工具 ───

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  if (name === 'ui_compile') {
    const asset = args?.asset || ''
    if (!asset) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ status: 'error', message: '缺少 asset 参数' }, null, 2) }],
      }
    }
    const result = await callEditor('ui_compile', { asset })
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  }

  if (name === 'ui_decompile') {
    const asset = args?.asset || ''
    if (!asset) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ status: 'error', message: '缺少 asset 参数' }, null, 2) }],
      }
    }
    const result = await callEditor('ui_decompile', { asset })
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  }

  if (name === 'get_scene_outline') {
    const result = await callEditor('get_scene_outline', args?.project ? { project: args.project } : {})
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }

  if (name === 'get_ui_outline') {
    const result = await callEditor('get_ui_outline', {})
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }

  if (name === 'get_assets') {
    const result = await callEditor('get_assets', args?.project ? { project: args.project } : {})
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }

  if (name === 'run_asset_lint') {
    const result = await callEditor('run_asset_lint', args?.project ? { project: args.project } : {})
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }

  // CDP 工具
  const cdpResult = await handleCdpTool(name, args)
  if (cdpResult) return cdpResult

  throw new Error(`未知工具: ${name}`)
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
