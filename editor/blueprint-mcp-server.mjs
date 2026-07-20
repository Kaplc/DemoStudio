/**
 * DemoStudio Blueprint MCP 服务器（基于 @modelcontextprotocol/sdk）
 * 独立的蓝图资产编辑 MCP 服务，提供结构化的蓝图编辑工具，避免直接改 JSON。
 *
 * 通过 HTTP 往返与 Electron 渲染进程通信（POST /api/blueprint）：
 *   外部 AI → MCP 工具 → HTTP /api/blueprint → 主进程 IPC → 渲染进程
 *     BlueprintEditorService.dispatch(op, params) → 读盘/写盘/重注册/刷新预览 → 回传结果
 *
 * VS Code MCP 配置 (.vscode/mcp.json):
 *   "demostudio-blueprint": {
 *     "type": "stdio",
 *     "command": "node",
 *     "args": ["editor/blueprint-mcp-server.mjs"],
 *     "cwd": "E:\\DemoStudio"
 *   }
 *
 * 所有 op 共用同一语义（详见渲染进程 BlueprintEditorService / blueprintOps）：
 *   - addComponent / setComponentProps：本地无该 type 时新建，存在则深合并 props
 *   - removeComponent：本地无该 type 时写 { type, _remove: true } 继承覆盖标记
 *   - setDefault：path 为点路径（如 "houseColors.roof"）；value=null 删除
 *   - addChild/updateChild/removeChild：具名(name)子节点走继承合并，无 name 纯追加
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

const EDITOR_API = 'http://127.0.0.1:9877'

/**
 * 调用编辑器蓝图接口（往返）。
 * @returns 渲染进程 BlueprintEditorService 的结果对象
 */
async function callBlueprint(op, params = {}) {
  try {
    const resp = await fetch(`${EDITOR_API}/api/blueprint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op, params }),
    })
    if (!resp.ok) {
      return { ok: false, error: `HTTP ${resp.status}` }
    }
    return await resp.json()
  } catch (err) {
    return { ok: false, error: `编辑器不可达: ${err.message}` }
  }
}

// ─── 创建 MCP 服务器 ───

const server = new Server(
  { name: 'demostudio-blueprint', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

// ─── 工具表 ───

const ASSETPATH_DESC =
  '蓝图资产相对路径，如 "src/projects/fish/asset/blueprints/beach_house.blueprint.json"'

const tools = [
  {
    name: 'read',
    description: '读取蓝图资产当前内容（解析前），并返回当前可用的 Actor/Component/Blueprint 类型',
    inputSchema: {
      type: 'object',
      properties: { assetPath: { type: 'string', description: ASSETPATH_DESC } },
      required: ['assetPath'],
    },
  },
  {
    name: 'list_types',
    description: '列出编辑器当前已注册的 Actor / Component / Blueprint 类型（编辑前选型用）',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'add_component',
    description: '添加 Component。已存在该 type 则取消 _remove 标记并深合并 props',
    inputSchema: {
      type: 'object',
      properties: {
        assetPath: { type: 'string', description: ASSETPATH_DESC },
        type: { type: 'string', description: 'Component 类型，如 sprite / camera / clickable' },
        props: {
          type: 'object',
          description: '初始属性（构造参数 + 可配置属性），如 { "width":1, "height":1, "color":"#2e7d32" }',
        },
      },
      required: ['assetPath', 'type'],
    },
  },
  {
    name: 'remove_component',
    description: '移除 Component。本地无该 type 时写 _remove 继承覆盖标记',
    inputSchema: {
      type: 'object',
      properties: {
        assetPath: { type: 'string', description: ASSETPATH_DESC },
        type: { type: 'string', description: '要移除的 Component 类型' },
      },
      required: ['assetPath', 'type'],
    },
  },
  {
    name: 'set_component_props',
    description: '深合并 props 到指定类型 Component（本地不存在则新建）',
    inputSchema: {
      type: 'object',
      properties: {
        assetPath: { type: 'string', description: ASSETPATH_DESC },
        type: { type: 'string', description: '目标 Component 类型' },
        patch: { type: 'object', description: '属性补丁（仅包含要改的键），如 { "opacity":0.8 }' },
      },
      required: ['assetPath', 'type', 'patch'],
    },
  },
  {
    name: 'add_child',
    description: '添加子 Actor。blueprint 与 actor 二选一；具名(name)子节点已存在则合并',
    inputSchema: {
      type: 'object',
      properties: {
        assetPath: { type: 'string', description: ASSETPATH_DESC },
        blueprint: { type: 'string', description: '引用另一个蓝图 id 实例化（与 actor 互斥）' },
        actor: { type: 'string', description: '内联 ActorRegistry 类型（与 blueprint 互斥）' },
        name: { type: 'string', description: '具名子节点（继承合并键；省略则纯追加）' },
        overrides: { type: 'object', description: '子 Actor 默认属性覆盖，如 { "position":[0,1,0] }' },
      },
      required: ['assetPath'],
    },
  },
  {
    name: 'update_child',
    description: '更新子 Actor（覆盖 blueprint/actor/name，深合并 overrides）。需 name 或 index 定位',
    inputSchema: {
      type: 'object',
      properties: {
        assetPath: { type: 'string', description: ASSETPATH_DESC },
        name: { type: 'string', description: '按具名定位（与 index 互斥）' },
        index: { type: 'number', description: '按本地数组索引定位（与 name 互斥）' },
        blueprint: { type: 'string' },
        actor: { type: 'string' },
        overrides: { type: 'object', description: '要合并的 overrides 补丁' },
      },
      required: ['assetPath'],
    },
  },
  {
    name: 'remove_child',
    description: '移除子 Actor。具名本地不存在时写 _remove 继承覆盖标记。需 name 或 index 定位',
    inputSchema: {
      type: 'object',
      properties: {
        assetPath: { type: 'string', description: ASSETPATH_DESC },
        name: { type: 'string' },
        index: { type: 'number' },
      },
      required: ['assetPath'],
    },
  },
  {
    name: 'set_default',
    description: '按点路径设置单个 CDO 默认值（如 "houseColors.roof"）。value=null 表示删除该键',
    inputSchema: {
      type: 'object',
      properties: {
        assetPath: { type: 'string', description: ASSETPATH_DESC },
        path: { type: 'string', description: '点路径键，如 "position" / "houseColors.roof" / "houseScale"' },
        value: { description: '任意 JSON 值（number/string/bool/array/object/null）' },
      },
      required: ['assetPath', 'path'],
    },
  },
  {
    name: 'set_defaults',
    description: '深合并一个属性补丁到 defaults（批量改多个键）',
    inputSchema: {
      type: 'object',
      properties: {
        assetPath: { type: 'string', description: ASSETPATH_DESC },
        patch: { type: 'object', description: 'defaults 补丁对象，如 { "houseScale":1.25, "houseColors":{ "roof":"#d4af37" } }' },
      },
      required: ['assetPath', 'patch'],
    },
  },
  {
    name: 'delete_defaults',
    description: '按点路径删除 CDO 默认值',
    inputSchema: {
      type: 'object',
      properties: {
        assetPath: { type: 'string', description: ASSETPATH_DESC },
        path: { type: 'string', description: '点路径键' },
      },
      required: ['assetPath', 'path'],
    },
  },
  {
    name: 'set_base_class',
    description: '设置 baseClass（ActorRegistry 类型，如 Actor / FishHouse）',
    inputSchema: {
      type: 'object',
      properties: {
        assetPath: { type: 'string', description: ASSETPATH_DESC },
        baseClass: { type: 'string' },
      },
      required: ['assetPath', 'baseClass'],
    },
  },
  {
    name: 'set_parent',
    description: '设置父蓝图（继承/变体）。parent 为空字符串或省略 clear=true 表示解除继承',
    inputSchema: {
      type: 'object',
      properties: {
        assetPath: { type: 'string', description: ASSETPATH_DESC },
        parent: { type: 'string', description: '父蓝图 id' },
        clear: { type: 'boolean', description: 'true 时解除继承（忽略 parent）' },
      },
      required: ['assetPath'],
    },
  },
  {
    name: 'set_id',
    description: '设置蓝图 id（一般不建议改，会影响注册键与引用）',
    inputSchema: {
      type: 'object',
      properties: {
        assetPath: { type: 'string', description: ASSETPATH_DESC },
        id: { type: 'string' },
      },
      required: ['assetPath', 'id'],
    },
  },
]

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

// ─── 工具名 → op + params ───

function buildOp(name, args = {}) {
  switch (name) {
    case 'read':
      return ['read', { assetPath: args.assetPath }]
    case 'list_types':
      return ['listTypes', {}]
    case 'add_component':
      return ['addComponent', { assetPath: args.assetPath, type: args.type, props: args.props }]
    case 'remove_component':
      return ['removeComponent', { assetPath: args.assetPath, type: args.type }]
    case 'set_component_props':
      return ['setComponentProps', { assetPath: args.assetPath, type: args.type, patch: args.patch }]
    case 'add_child':
      return ['addChild', {
        assetPath: args.assetPath, blueprint: args.blueprint, actor: args.actor,
        name: args.name, overrides: args.overrides,
      }]
    case 'update_child':
      return ['updateChild', {
        assetPath: args.assetPath, name: args.name, index: args.index,
        blueprint: args.blueprint, actor: args.actor, overrides: args.overrides,
      }]
    case 'remove_child':
      return ['removeChild', { assetPath: args.assetPath, name: args.name, index: args.index }]
    case 'set_default':
      return ['setDefault', { assetPath: args.assetPath, path: args.path, value: args.value }]
    case 'set_defaults':
      return ['setDefaults', { assetPath: args.assetPath, patch: args.patch }]
    case 'delete_defaults':
      return ['deleteDefaults', { assetPath: args.assetPath, path: args.path }]
    case 'set_base_class':
      return ['setBaseClass', { assetPath: args.assetPath, baseClass: args.baseClass }]
    case 'set_parent': {
      if (args.clear) return ['setParent', { assetPath: args.assetPath, parent: null }]
      return ['setParent', { assetPath: args.assetPath, parent: args.parent }]
    }
    case 'set_id':
      return ['setId', { assetPath: args.assetPath, id: args.id }]
    default:
      return null
  }
}

// ─── 调用工具 ───

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  const built = buildOp(name, args)
  if (!built) throw new Error(`未知工具: ${name}`)

  const [op, params] = built
  const result = await callBlueprint(op, params)
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  }
})

// ─── 启动 STDIO 传输 ───

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[MCP] DemoStudio Blueprint MCP Server 已启动 (SDK)')
}

main().catch((err) => {
  console.error('[MCP] 启动失败:', err)
  process.exit(1)
})
