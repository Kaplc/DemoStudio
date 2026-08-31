/**
 * 鼠标/键盘模拟工具集 — 让 AI agent 像真实玩家一样操作游戏
 *
 * 所有工具通过 emit_ai_event 调用编辑器 MCP → AIModule → InputSys 完整管线：
 *   浏览器坐标 → InputSys → PhySys 射线检测 → ClickableComponent / Controller
 *
 * 与 ai.clickActor 的区别：
 *   - ai.clickActor 按 Actor 名称触发（语义化，不走射线）
 *   - mouse_click 按屏幕坐标触发（真实模拟，走完整射线管线）
 */
import { z } from 'zod'
import { getEngineContext } from '../engineContext'

// ═══════════════════════════════════════
//  通用 HTTP 调用（复用 emitAIEvent 的通道）
// ═══════════════════════════════════════

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

// ═══════════════════════════════════════
//  1. mouse_click — 模拟鼠标点击
// ═══════════════════════════════════════

const mouseClickSchema = z.object({
  screenX: z.number().describe('屏幕 X 坐标（像素）'),
  screenY: z.number().describe('屏幕 Y 坐标（像素）'),
  button: z.number().optional().describe('鼠标按键：0=左键（默认），2=右键'),
})

export const mouseClickTool = {
  name: 'mouse_click',
  description: `模拟玩家鼠标点击游戏画面（走完整射线管线：屏幕坐标 → PhySys 射线检测 → ClickableComponent/Controller）。

适用场景：
- 点击游戏内 UI 按钮（已知屏幕坐标时）
- 点击游戏场景中的建筑/道具
- 触发任何需要真实鼠标点击的交互

与 ai.clickActor 的区别：clickActor 按名称触发（不需要坐标），mouse_click 按屏幕坐标触发（真实模拟）。

用法示例：
- 点击屏幕中央的按钮：mouse_click({screenX: 960, screenY: 540})
- 右键点击：mouse_click({screenX: 500, screenY: 300, button: 2})`,
  parameters: {
    screenX: { type: 'number', description: '屏幕 X 坐标（像素）' },
    screenY: { type: 'number', description: '屏幕 Y 坐标（像素）' },
    button: { type: 'number', description: '鼠标按键：0=左键（默认），2=右键' },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        screenX: { type: 'number' },
        screenY: { type: 'number' },
        consumed: { type: 'boolean', description: '是否有 ClickableComponent 消费了点击' },
        error: { type: 'string' },
      },
    },
    render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: async (args: unknown, ctx?: unknown) => {
    const parsed = mouseClickSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    const { screenX, screenY, button } = parsed.data
    try {
      const result = await callAIEventRaw(ctx, 'ai.mouseClick', { screenX, screenY, button: button ?? 0 }) as Record<string, unknown>
      return result ?? { ok: true, screenX, screenY }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  },
}

// ═══════════════════════════════════════
//  2. mouse_move — 模拟鼠标移动
// ═══════════════════════════════════════

const mouseMoveSchema = z.object({
  screenX: z.number().describe('屏幕 X 坐标（像素）'),
  screenY: z.number().describe('屏幕 Y 坐标（像素）'),
})

export const mouseMoveTool = {
  name: 'mouse_move',
  description: `模拟玩家鼠标移动（触发 hover 射线检测 + 拖拽分发）。

适用场景：
- 悬停在游戏元素上查看 tooltip
- 配合 mouse_click 实现 hover-then-click 序列
- 触发鼠标的 hover 高亮效果

用法示例：
- 移动到屏幕中央：mouse_move({screenX: 960, screenY: 540})`,
  parameters: {
    screenX: { type: 'number', description: '屏幕 X 坐标（像素）' },
    screenY: { type: 'number', description: '屏幕 Y 坐标（像素）' },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        screenX: { type: 'number' },
        screenY: { type: 'number' },
        error: { type: 'string' },
      },
    },
    render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: async (args: unknown, ctx?: unknown) => {
    const parsed = mouseMoveSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    const { screenX, screenY } = parsed.data
    try {
      const result = await callAIEventRaw(ctx, 'ai.mouseMove', { screenX, screenY }) as Record<string, unknown>
      return result ?? { ok: true, screenX, screenY }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  },
}

// ═══════════════════════════════════════
//  3. mouse_drag — 模拟鼠标拖拽
// ═══════════════════════════════════════

const mouseDragSchema = z.object({
  startX: z.number().describe('起始屏幕 X 坐标（像素）'),
  startY: z.number().describe('起始屏幕 Y 坐标（像素）'),
  endX: z.number().describe('结束屏幕 X 坐标（像素）'),
  endY: z.number().describe('结束屏幕 Y 坐标（像素）'),
  steps: z.number().optional().describe('移动步数（默认 10，越多越平滑）'),
  stepDelayMs: z.number().optional().describe('每步间隔毫秒（默认 16，即一帧）'),
})

export const mouseDragTool = {
  name: 'mouse_drag',
  description: `模拟玩家鼠标拖拽（按下→多步移动→释放，完整序列）。

适用场景：
- 拖拽滚动列表
- 拖拽移动游戏内物品
- 滑动解锁/滑块操作
- 任何需要按住拖动的交互

用法示例：
- 从屏幕中央向右拖拽 200px：mouse_drag({startX: 960, startY: 540, endX: 1160, endY: 540})
- 慢速向上滑动：mouse_drag({startX: 500, startY: 600, endX: 500, endY: 200, steps: 20, stepDelayMs: 50})`,
  parameters: {
    startX: { type: 'number', description: '起始屏幕 X 坐标（像素）' },
    startY: { type: 'number', description: '起始屏幕 Y 坐标（像素）' },
    endX: { type: 'number', description: '结束屏幕 X 坐标（像素）' },
    endY: { type: 'number', description: '结束屏幕 Y 坐标（像素）' },
    steps: { type: 'number', description: '移动步数（默认 10）' },
    stepDelayMs: { type: 'number', description: '每步间隔毫秒（默认 16）' },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        startX: { type: 'number' },
        startY: { type: 'number' },
        endX: { type: 'number' },
        endY: { type: 'number' },
        steps: { type: 'number' },
        error: { type: 'string' },
      },
    },
    render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: async (args: unknown, ctx?: unknown) => {
    const parsed = mouseDragSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    const { startX, startY, endX, endY, steps, stepDelayMs } = parsed.data
    try {
      const result = await callAIEventRaw(ctx, 'ai.mouseDrag', {
        startX, startY, endX, endY,
        steps: steps ?? 10,
        stepDelayMs: stepDelayMs ?? 16,
      }) as Record<string, unknown>
      return result ?? { ok: true, startX, startY, endX, endY }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  },
}

// ═══════════════════════════════════════
//  4. key_press — 模拟键盘按键（按下+释放）
// ═══════════════════════════════════════

const keyPressSchema = z.object({
  key: z.string().describe('按键名（如 "a", "Space", "Enter", "Escape", "ArrowLeft"）'),
})

export const keyPressTool = {
  name: 'key_press',
  description: `模拟玩家键盘按键（完整按下+释放序列）。

适用场景：
- 按空格跳跃
- 按 WASD 移动
- 按 Escape 关闭面板
- 按 Enter 确认

按键名参考（Key Events 标准值）：
- 字母：a-z
- 数字：0-9
- 功能键：Space, Enter, Escape, Tab, Backspace, Delete
- 方向键：ArrowUp, ArrowDown, ArrowLeft, ArrowRight
- 修饰键：Shift, Control, Alt, Meta

用法示例：
- 按空格：key_press({key: "Space"})
- 按 ESC：key_press({key: "Escape"})`,
  parameters: {
    key: { type: 'string', description: '按键名（标准 KeyboardEvent.key 值）' },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        key: { type: 'string' },
        error: { type: 'string' },
      },
    },
    render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: async (args: unknown, ctx?: unknown) => {
    const parsed = keyPressSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    const { key } = parsed.data
    try {
      // 先按下再释放（完整按键序列）
      await callAIEventRaw(ctx, 'ai.keyPress', { key })
      await callAIEventRaw(ctx, 'ai.keyRelease', { key })
      return { ok: true, key }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  },
}
