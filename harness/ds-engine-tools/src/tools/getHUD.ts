/**
 * get_hud — 获取游戏 HUD 完整结构
 *
 * 递归遍历 UI 树，返回所有可见 UI 元素的文字内容、按钮状态、图片资源、尺寸等。
 * 让 AI 能"看到"游戏屏幕上显示了什么。
 *
 * 与 ai.getActor 的区别：
 *   - getActor 返回单个 Actor 的基础信息（名称/类型/位置/缩放）
 *   - getHUD 返回完整 UI 树结构，包含文字内容、按钮状态等 UI 特有信息
 */
import { getEngineContext } from '../engineContext'

const EDITOR_MCP_PORT_DEFAULT = 9877

function discoverMCPBridgePort(ec: { engineBridge: { port?: number } }): number {
  const envPort = process.env.DSH_ENGINE_PORT
  if (envPort) {
    const p = parseInt(envPort, 10)
    if (!isNaN(p) && p > 0) return p
  }
  if (ec.engineBridge?.port && typeof ec.engineBridge.port === 'number') {
    return ec.engineBridge.port
  }
  return EDITOR_MCP_PORT_DEFAULT
}

async function callAIEventRaw(ctx: unknown, event: string, payload: Record<string, unknown>): Promise<unknown> {
  const ec = getEngineContext(ctx)
  const port = ec ? discoverMCPBridgePort(ec as { engineBridge: { port?: number } }) : EDITOR_MCP_PORT_DEFAULT
  const resp = await fetch(`http://127.0.0.1:${port}/api/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'ai_event', params: { event, payload } }),
  })
  if (!resp.ok) throw new Error(`MCP HTTP ${resp.status}`)
  const r = await resp.json() as { status?: string; result?: unknown; error?: string }
  if (r?.status === 'error') throw new Error(r.error ?? '编辑器返回错误')
  return r?.result ?? r
}

/** 递归格式化 HUD 树为可读文本（给 AI 一眼看懂） */
function formatHUDTree(nodes: unknown[], indent = ''): string {
  const lines: string[] = []
  for (const node of nodes) {
    const n = node as {
      name: string
      type: string
      active: boolean
      zOrder?: number
      text?: string
      buttonState?: string
      imageSrc?: string
      worldSize?: [number, number]
      position?: [number, number, number]
      children: unknown[]
    }
    const parts: string[] = []
    if (n.zOrder != null) parts.push(`z=${n.zOrder}`)
    if (n.active === false) parts.push('❌ inactive')
    if (n.text) parts.push(`📝 "${n.text}"`)
    if (n.buttonState) parts.push(`🔘 ${n.buttonState}`)
    if (n.imageSrc) parts.push(`🖼️ ${n.imageSrc}`)
    if (n.worldSize) parts.push(`📐 ${n.worldSize[0]}×${n.worldSize[1]}`)

    const tag = n.type === 'GenericActor' ? '' : `(${n.type})`
    const detail = parts.length > 0 ? ` — ${parts.join(' ')}` : ''
    lines.push(`${indent}${n.name}${tag}${detail}`)

    if (n.children?.length > 0) {
      lines.push(formatHUDTree(n.children, indent + '  '))
    }
  }
  return lines.join('\n')
}

export const getHUDTool = {
  name: 'get_hud',
  description: `获取游戏 HUD 完整结构（递归遍历 UI 大纲树）。

返回所有 UI 元素的：
- 文字内容（UITextComponent 的 text）
- 按钮状态（UIButtonComponent：normal/hover/pressed/disabled）
- 图片资源（UIImageComponent）
- zOrder（UI 层级值）
- 世界尺寸和坐标
- 子节点层级关系

⚠️ 渲染前后顺序由大纲树结构决定：同一父节点下，排在后面的子节点渲染在前面（盖住前面的）。
判断"哪个在最顶层"：看 active 节点中，树结构里最后出现的节点最靠前。
zOrder 是派生值，仅作参考；大纲树顺序是权威。

适用场景：
- 查看当前屏幕上显示了哪些文字、按钮、图片
- 了解 UI 布局结构以便精确点击
- 检查按钮状态是否正常
- 理解游戏当前界面信息（金币数、等级、提示文字等）
- 判断哪个 UI 元素在最顶层（看树结构顺序）

与 ai.getState 的区别：getState 返回 Actor 列表和游戏状态，getHUD 返回 UI 树结构和文字内容。`,
  parameters: {},
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        hud: { type: 'array', description: 'UI 树结构' },
        formatted: { type: 'string', description: '格式化的可读文本' },
        error: { type: 'string' },
      },
    },
    render: (_args: unknown, value: unknown) => {
      const v = value as { formatted?: string; hud?: unknown[] }
      if (v?.formatted) {
        return [{ type: 'text', text: v.formatted }]
      }
      return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
    },
  },
  execute: async (_args: unknown, ctx?: unknown) => {
    try {
      const result = await callAIEventRaw(ctx, 'ai.getHUD', {}) as Record<string, unknown>
      if (result && result.ok === false) return result
      const hud = (result as { hud?: unknown[] })?.hud ?? []
      return {
        ok: true,
        hud,
        formatted: formatHUDTree(hud),
      }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  },
}
