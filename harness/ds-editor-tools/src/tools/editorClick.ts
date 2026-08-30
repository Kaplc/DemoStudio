/**
 * editor_click — 点击编辑器 UI 元素
 *
 * 通过 Playwright CDP 连接到编辑器，用多种定位策略查找元素并点击。
 * 支持的选择器格式：
 *   - CSS:     "button.toolbar-launch"
 *   - 文本:    "text=启动游戏"  或  "text='Save'"
 *   - 角色:    "role=button[name='启动']"
 *   - testid:  "[data-testid='launch-btn']"
 *   - XPath:   "//button[contains(text(),'启动')]"
 */
import { getEditorPage, resolveSelector } from '../cdpBridge'

export interface EditorClickArgs {
  /** 元素选择器（CSS / text= / role= / [data-testid=] / XPath） */
  selector: string
  /** 双击？默认 false */
  doubleClick?: boolean
  /** 等待元素出现的超时（毫秒），默认 5000 */
  timeoutMs?: number
  /** 点击选项：force 跳过可见性检查 */
  force?: boolean
}

export interface EditorClickResult {
  ok: boolean
  selector?: string
  matched?: number
  text?: string | null
  error?: string
}

export async function editorClick(args: EditorClickArgs): Promise<EditorClickResult> {
  const { selector, doubleClick = false, timeoutMs = 5000, force = false } = args

  if (!selector) return { ok: false, error: '缺少 selector 参数' }

  try {
    const page = await getEditorPage()
    const locator = resolveSelector(page, selector)

    // 等待元素可见
    await locator.first().waitFor({ state: 'visible', timeout: timeoutMs })

    // 获取匹配数量和文本（用于结果反馈）
    const count = await locator.count()
    const text = await locator.first().textContent().catch(() => null)

    // 执行点击
    if (doubleClick) {
      await locator.first().dblclick({ force, timeout: timeoutMs })
    } else {
      await locator.first().click({ force, timeout: timeoutMs })
    }

    return {
      ok: true,
      selector,
      matched: count,
      text: text?.trim().slice(0, 200) ?? null,
    }
  } catch (err) {
    return { ok: false, selector, error: `点击失败: ${err}` }
  }
}

export const editorClickTool = {
  name: 'editor_click',
  description: `点击编辑器 UI 元素。通过 Playwright CDP 连接到运行中的编辑器，支持多种定位策略。

示例：
- 点击工具栏按钮：{ selector: "text=启动游戏" }
- 用 CSS 选择器：{ selector: "button.toolbar-launch" }
- 用角色定位：{ selector: "role=button[name='Save']" }
- 用 data-testid：{ selector: "[data-testid='launch-btn']" }
- 双击：{ selector: "text=Scene", doubleClick: true }
- 强制点击（跳过可见性检查）：{ selector: ".hidden-btn", force: true }`,
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: '元素选择器（CSS / text= / role= / [data-testid=] / XPath）' },
      doubleClick: { type: 'boolean', description: '双击？默认 false' },
      timeoutMs: { type: 'number', description: '等待超时（毫秒），默认 5000' },
      force: { type: 'boolean', description: '跳过可见性检查，默认 false' },
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
        matched: { type: 'number' },
        text: { type: 'string' },
        error: { type: 'string' },
      },
    },
    render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: editorClick,
}
