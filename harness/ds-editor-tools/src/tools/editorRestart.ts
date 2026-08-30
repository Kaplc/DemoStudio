/**
 * editor_restart — 重启 DemoStudio 编辑器
 *
 * 通过 MCP HTTP API 发送 editor-restart 命令到编辑器主进程，
 * 主进程调用 app.relaunch() + app.exit(0) 重启 Electron 应用。
 *
 * 注意：重启后当前 DSH agent 会话将断开，新编辑器实例会重新连接 DSH。
 */
import { EDITOR_MCP_PORT_DEFAULT } from './editorEvent'

async function callMCP(port: number, command: string): Promise<unknown> {
  const resp = await fetch(`http://127.0.0.1:${port}/api/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, params: {} }),
  })
  if (!resp.ok) throw new Error(`MCP HTTP ${resp.status}`)
  return await resp.json()
}

export interface EditorRestartResult {
  ok: boolean
  message?: string
  error?: string
}

export async function editorRestart(): Promise<EditorRestartResult> {
  try {
    const result = await callMCP(EDITOR_MCP_PORT_DEFAULT, 'editor-restart') as {
      status?: string
      message?: string
      error?: string
    }
    if (result?.status === 'error') {
      return { ok: false, error: result.error ?? '编辑器返回错误' }
    }
    return { ok: true, message: result?.message ?? '编辑器正在重启' }
  } catch (err) {
    return { ok: false, error: `重启失败: ${err}` }
  }
}

export const editorRestartTool = {
  name: 'editor_restart',
  description: `重启 DemoStudio 编辑器（Electron 应用）。

重启后：
- 编辑器重新加载（app.relaunch + app.exit）
- DSH agent 自动重连
- 当前 agent 会话会短暂断开后恢复

注意：这是高危操作，会中断当前所有编辑器状态。`,
  parameters: {
    type: 'object',
    properties: {},
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        message: { type: 'string' },
        error: { type: 'string' },
      },
    },
    render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: editorRestart,
}
