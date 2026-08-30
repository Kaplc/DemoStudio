/**
 * editor_hover — 悬停编辑器 UI 元素
 *
 * 模拟鼠标悬停，触发 tooltip / hover 状态变化。
 */
import { getEditorPage, resolveSelector } from '../cdpBridge'

export interface EditorHoverArgs {
  selector: string
  timeoutMs?: number
}

export interface EditorHoverResult {
  ok: boolean
  selector?: string
  text?: string | null
  error?: string
}

export async function editorHover(args: EditorHoverArgs): Promise<EditorHoverResult> {
  const { selector, timeoutMs = 5000 } = args
  if (!selector) return { ok: false, error: '缺少 selector 参数' }

  try {
    const page = await getEditorPage()
    const locator = resolveSelector(page, selector)
    await locator.first().waitFor({ state: 'visible', timeout: timeoutMs })
    const text = await locator.first().textContent().catch(() => null)
    await locator.first().hover({ timeout: timeoutMs })
    return { ok: true, selector, text: text?.trim().slice(0, 200) ?? null }
  } catch (err) {
    return { ok: false, selector, error: `悬停失败: ${err}` }
  }
}

export const editorHoverTool = {
  name: 'editor_hover',
  description: '悬停编辑器 UI 元素，触发 tooltip 或 hover 状态。选择器格式同 editor_click。',
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: '元素选择器（CSS / text= / role= / XPath）' },
      timeoutMs: { type: 'number', description: '等待超时（毫秒），默认 5000' },
    },
    required: ['selector'],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        selector: { type: 'string' },
        text: { type: 'string' },
        error: { type: 'string' },
      },
    },
    render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: editorHover,
}
