/**
 * editor_scroll — 滚动编辑器 UI 元素
 *
 * 通过 Playwright 的 page.evaluate() 执行 JS 实现滚动，
 * 支持按像素滚动、滚动到顶部/底部、滚动元素到视口内。
 */
import { getEditorPage, resolveSelector } from '../cdpBridge'

export interface EditorScrollArgs {
  selector?: string
  /** X 方向滚动像素（正=右，负=左） */
  deltaX?: number
  /** Y 方向滚动像素（正=下，负=上） */
  deltaY?: number
  /** 滚动到指定位置：'top' | 'bottom' | 'center' */
  scrollTo?: 'top' | 'bottom' | 'center'
  /** 是否滚动该元素到视口可见区域 */
  scrollIntoView?: boolean
  timeoutMs?: number
}

export interface EditorScrollResult {
  ok: boolean
  selector?: string
  scrollTop?: number
  scrollLeft?: number
  scrollHeight?: number
  clientHeight?: number
  error?: string
}

export async function editorScroll(args: EditorScrollArgs): Promise<EditorScrollResult> {
  const { selector, deltaX = 0, deltaY = 0, scrollTo, scrollIntoView, timeoutMs = 5000 } = args

  try {
    const page = await getEditorPage()

    // 无 selector 时滚动整个页面
    const target = selector
      ? await (async () => {
          const loc = resolveSelector(page, selector)
          await loc.first().waitFor({ state: 'visible', timeout: timeoutMs })
          return loc.first()
        })()
      : null

    if (scrollIntoView && target) {
      await target.evaluate((el: Element) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }))
      return { ok: true, selector }
    }

    // 通过 evaluate 执行滚动并返回滚动状态
    const result = await page.evaluate(
      ({ sel, dx, dy, scrollToMode }: { sel: string | null; dx: number; dy: number; scrollToMode?: string }) => {
        const el = sel ? document.querySelector(sel) : document.scrollingElement || document.documentElement
        if (!el) return { error: `未找到元素: ${sel}` }

        if (scrollToMode === 'top') {
          el.scrollTop = 0
        } else if (scrollToMode === 'bottom') {
          el.scrollTop = el.scrollHeight
        } else if (scrollToMode === 'center') {
          el.scrollTop = (el.scrollHeight - el.clientHeight) / 2
        } else {
          el.scrollBy(dx, dy)
        }

        return {
          scrollTop: el.scrollTop,
          scrollLeft: el.scrollLeft,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
        }
      },
      { sel: selector ?? null, dx: deltaX, dy: deltaY, scrollToMode: scrollTo },
    )

    if ('error' in result) return { ok: false, selector, error: result.error as string }
    return { ok: true, selector, ...(result as { scrollTop: number; scrollLeft: number; scrollHeight: number; clientHeight: number }) }
  } catch (err) {
    return { ok: false, selector, error: `滚动失败: ${err}` }
  }
}

export const editorScrollTool = {
  name: 'editor_scroll',
  description:
    '滚动编辑器 UI 元素。可按像素滚动、滚动到顶/底/中心、或将元素滚入视口。省略 selector 时滚动整个页面。',
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: '目标元素选择器（省略则滚动整个页面）' },
      deltaX: { type: 'number', description: 'X 方向滚动像素（正=右，负=左），默认 0' },
      deltaY: { type: 'number', description: 'Y 方向滚动像素（正=下，负=上），默认 0' },
      scrollTo: { type: 'string', enum: ['top', 'bottom', 'center'], description: '滚动到指定位置' },
      scrollIntoView: { type: 'boolean', description: '将元素滚动到视口可见区域（优先级最高）' },
      timeoutMs: { type: 'number', description: '等待元素超时（毫秒），默认 5000' },
    },
    required: [],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        selector: { type: 'string' },
        scrollTop: { type: 'number' },
        scrollLeft: { type: 'number' },
        scrollHeight: { type: 'number' },
        clientHeight: { type: 'number' },
        error: { type: 'string' },
      },
    },
    render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: editorScroll,
}
