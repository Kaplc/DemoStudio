/**
 * editor_read — 读取编辑器 UI 元素内容
 *
 * 读取元素的文本、属性、input 值等信息。
 */
import { getEditorPage, resolveSelector } from '../cdpBridge'

export interface EditorReadArgs {
  /** 元素选择器 */
  selector: string
  /** 读取模式：text=文本内容 attr=属性值 value=输入框值，默认 text */
  mode?: 'text' | 'attr' | 'value'
  /** 属性名（仅 attr 模式） */
  attribute?: string
  /** 读取所有匹配元素还是仅第一个，默认 false（仅第一个） */
  all?: boolean
  timeoutMs?: number
}

export interface EditorReadResult {
  ok: boolean
  selector?: string
  /** 单个元素结果 */
  text?: string | null
  /** all=true 时返回多个 */
  items?: string[]
  error?: string
}

export async function editorRead(args: EditorReadArgs): Promise<EditorReadResult> {
  const { selector, mode = 'text', attribute, all = false, timeoutMs = 5000 } = args
  if (!selector) return { ok: false, error: '缺少 selector 参数' }

  try {
    const page = await getEditorPage()
    const locator = resolveSelector(page, selector)
    await locator.first().waitFor({ state: 'attached', timeout: timeoutMs })

    if (all) {
      const count = await locator.count()
      const items: string[] = []
      for (let i = 0; i < Math.min(count, 50); i++) {
        const el = locator.nth(i)
        let val = ''
        if (mode === 'attr' && attribute) {
          val = (await el.getAttribute(attribute)) ?? ''
        } else if (mode === 'value') {
          val = (await el.inputValue().catch(() => '')) ?? ''
        } else {
          val = (await el.textContent().catch(() => '')) ?? ''
        }
        items.push(val.trim())
      }
      return { ok: true, selector, items }
    }

    const el = locator.first()
    let text: string | null = null
    if (mode === 'attr' && attribute) {
      text = await el.getAttribute(attribute)
    } else if (mode === 'value') {
      text = await el.inputValue().catch(() => null)
    } else {
      text = await el.textContent().catch(() => null)
    }
    return { ok: true, selector, text: text?.trim() ?? null }
  } catch (err) {
    return { ok: false, selector, error: `读取失败: ${err}` }
  }
}

export const editorReadTool = {
  name: 'editor_read',
  description: `读取编辑器 UI 元素的文本、属性或输入值。

模式：
- text（默认）：元素的 textContent
- attr：指定属性值（需配合 attribute 参数）
- value：input/textarea 的当前值

示例：
- 读取按钮文字：{ selector: "button.toolbar-launch" }
- 读取所有标签：{ selector: ".tab-label", all: true }
- 读取输入框值：{ selector: "input.search", mode: "value" }
- 读取 data 属性：{ selector: ".node", mode: "attr", attribute: "data-id" }`,
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: '元素选择器' },
      mode: { type: 'string', enum: ['text', 'attr', 'value'], description: '读取模式，默认 text' },
      attribute: { type: 'string', description: '属性名（仅 attr 模式）' },
      all: { type: 'boolean', description: '读取所有匹配元素，默认 false' },
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
        text: { type: 'string' },
        items: { type: 'array', items: { type: 'string' } },
        error: { type: 'string' },
      },
    },
    render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: editorRead,
}
