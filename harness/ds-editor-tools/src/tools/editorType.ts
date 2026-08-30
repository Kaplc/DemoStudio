/**
 * editor_type — 在编辑器 UI 输入框中输入文字
 *
 * 支持：fill（清空后输入）、type（逐字符输入）、press（按键）。
 */
import { getEditorPage, resolveSelector } from '../cdpBridge'

export interface EditorTypeArgs {
  /** 输入框选择器 */
  selector: string
  /** 要输入的文字（fill/type 模式必填） */
  text?: string
  /** 输入模式：fill=清空后输入 type=逐字符 press=按键，默认 fill */
  mode?: 'fill' | 'type' | 'press'
  /** 按键名（仅 press 模式，如 'Enter', 'Escape', 'Tab'） */
  key?: string
  /** 是否逐字符输入触发 keydown/keyup 事件（type 模式），默认 false */
  slow?: boolean
  timeoutMs?: number
}

export interface EditorTypeResult {
  ok: boolean
  selector?: string
  mode?: string
  error?: string
}

export async function editorType(args: EditorTypeArgs): Promise<EditorTypeResult> {
  const { selector, text, mode = 'fill', key, slow = false, timeoutMs = 5000 } = args
  if (!selector) return { ok: false, error: '缺少 selector 参数' }

  try {
    const page = await getEditorPage()
    const locator = resolveSelector(page, selector)
    await locator.first().waitFor({ state: 'visible', timeout: timeoutMs })

    if (mode === 'press') {
      if (!key) return { ok: false, error: 'press 模式需要 key 参数' }
      await locator.first().press(key, { timeout: timeoutMs })
    } else if (mode === 'type') {
      if (!text) return { ok: false, error: 'type 模式需要 text 参数' }
      await locator.first().pressSequentially(text, { delay: slow ? 100 : 0, timeout: timeoutMs })
    } else {
      if (!text) return { ok: false, error: 'fill 模式需要 text 参数' }
      await locator.first().fill(text, { timeout: timeoutMs })
    }

    return { ok: true, selector, mode }
  } catch (err) {
    return { ok: false, selector, mode, error: `输入失败: ${err}` }
  }
}

export const editorTypeTool = {
  name: 'editor_type',
  description: `在编辑器 UI 输入框中输入文字或按键。

模式：
- fill（默认）：清空后填入文字
- type：逐字符输入（触发 keydown/keyup，适合有自动补全的输入框）
- press：按单个键（Enter/Escape/Tab 等）

示例：
- 输入搜索文字：{ selector: "input[placeholder='Search']", text: "fish" }
- 按回车：{ selector: "input.search", mode: "press", key: "Enter" }
- 逐字符输入：{ selector: ".composer__input", text: "/help", mode: "type" }`,
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: '输入框选择器' },
      text: { type: 'string', description: '要输入的文字' },
      mode: { type: 'string', enum: ['fill', 'type', 'press'], description: '输入模式，默认 fill' },
      key: { type: 'string', description: '按键名（仅 press 模式）' },
      slow: { type: 'boolean', description: '逐字符输入时是否放慢（默认 false）' },
      timeoutMs: { type: 'number', description: '等待超时（毫秒）' },
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
        mode: { type: 'string' },
        error: { type: 'string' },
      },
    },
    render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: editorType,
}
