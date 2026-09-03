/**
 * get_assets：获取当前工程的资产浏览器文件列表
 *
 * 返回所有 .json/.ts/.html 等资源文件的 path/ext/size 信息。
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

export const getAssetsTool = {
  name: 'get_assets',
  description:
    '获取当前工程的资产浏览器文件列表（所有 .json/.ts/.html 等资源文件）。' +
    '返回每个文件的 path/ext/size 信息。',
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
        project: { type: 'string' },
        files: { type: 'array' },
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
      const result = await callEditor(port, 'get_assets', {})
      return result
    } catch (err) {
      return { status: 'error', message: `获取资产列表失败: ${err}` }
    }
  },
}
