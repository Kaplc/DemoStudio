/**
 * get_scene_outline：获取编辑器当前场景的 Actor 大纲树
 *
 * 返回 3D + UI Actor 的层级结构（name/type/components/children）。
 * 优先使用活动预览管理器的 getActorTree，否则从运行中 World 获取。
 */
import { getEngineContext } from '../engineContext'

const EDITOR_MCP_PORT_DEFAULT = 9877

function getPort(ec: unknown): number {
  const envPort = process.env.DSH_ENGINE_PORT
  if (envPort) {
    const p = parseInt(envPort, 10)
    if (!isNaN(p) && p > 0) return p
  }
  const ectx = ec as { engineBridge?: { port?: number } } | null
  if (ectx?.engineBridge?.port) return ectx.engineBridge.port
  return EDITOR_MCP_PORT_DEFAULT
}

async function callEditor(port: number, command: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const resp = await fetch(`http://127.0.0.1:${port}/api/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, params }),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return await resp.json()
}

export const getSceneOutlineTool = {
  name: 'get_scene_outline',
  description:
    '获取编辑器当前场景的 Actor 大纲树（3D + UI Actor 层级结构）。' +
    '返回每个节点的 name/type/components/children，可用于了解场景中有哪些对象。',
  parameters: {
    type: 'object',
    properties: {},
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'string' },
        outline: { type: 'array' },
        count: { type: 'number' },
        message: { type: 'string' },
      },
    },
    render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  async execute(_args: unknown, ctx?: unknown) {
    const ec = getEngineContext(ctx)
    const port = getPort(ec)
    try {
      const result = await callEditor(port, 'get_scene_outline', {})
      return result
    } catch (err) {
      return { status: 'error', message: `获取场景大纲失败: ${err}` }
    }
  },
}
