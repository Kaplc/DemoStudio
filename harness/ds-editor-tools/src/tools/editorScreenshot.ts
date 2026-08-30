/**
 * editor_screenshot — 截取编辑器当前状态截图
 *
 * 全页面截图或指定区域截图，返回 base64 编码的 PNG。
 */
import { getEditorPage, resolveSelector } from '../cdpBridge'

export interface EditorScreenshotArgs {
  /** 截图模式：page=全页面 element=指定元素，默认 page */
  mode?: 'page' | 'element'
  /** 元素选择器（element 模式必填） */
  selector?: string
  /** 图片格式，默认 png */
  format?: 'png' | 'jpeg'
  /** JPEG 质量（1-100），仅 jpeg 格式有效 */
  quality?: number
  /** 是否返回 base64（默认 true；false 时仅返回 ok 状态） */
  returnBase64?: boolean
}

export interface EditorScreenshotResult {
  ok: boolean
  /** base64 编码的图片数据（returnBase64=true 时） */
  base64?: string
  /** 图片格式 */
  format?: string
  /** 图片字节大小 */
  size?: number
  error?: string
}

export async function editorScreenshot(args: EditorScreenshotArgs): Promise<EditorScreenshotResult> {
  const { mode = 'page', selector, format = 'png', quality, returnBase64 = true } = args

  try {
    const page = await getEditorPage()
    let buffer: Buffer

    if (mode === 'element' && selector) {
      const locator = resolveSelector(page, selector)
      await locator.first().waitFor({ state: 'visible', timeout: 5000 })
      buffer = await locator.first().screenshot({
        type: format,
        quality: format === 'jpeg' ? quality : undefined,
      }) as Buffer
    } else {
      buffer = await page.screenshot({
        type: format,
        quality: format === 'jpeg' ? quality : undefined,
        fullPage: false,
      }) as Buffer
    }

    const base64 = returnBase64 ? buffer.toString('base64') : undefined
    return {
      ok: true,
      base64: base64 ? `data:image/${format};base64,${base64}` : undefined,
      format,
      size: buffer.length,
    }
  } catch (err) {
    return { ok: false, error: `截图失败: ${err}` }
  }
}

export const editorScreenshotTool = {
  name: 'editor_screenshot',
  description: `截取编辑器当前状态截图（PNG/JPEG），返回 base64 图片数据。

模式：
- page（默认）：截取整个编辑器窗口
- element：截取指定元素（如 Inspector 面板、工具栏等）

示例：
- 全页面截图：{ }
- 截取 Inspector 面板：{ mode: "element", selector: ".inspector-panel" }
- JPEG 格式截图：{ format: "jpeg", quality: 80 }`,
  parameters: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['page', 'element'], description: '截图模式，默认 page' },
      selector: { type: 'string', description: '元素选择器（element 模式必填）' },
      format: { type: 'string', enum: ['png', 'jpeg'], description: '图片格式，默认 png' },
      quality: { type: 'number', description: 'JPEG 质量（1-100）' },
      returnBase64: { type: 'boolean', description: '是否返回 base64 数据，默认 true' },
    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        base64: { type: 'string', description: 'data:image/png;base64,...' },
        format: { type: 'string' },
        size: { type: 'number' },
        error: { type: 'string' },
      },
    },
    render: (_args: unknown, value: unknown) => {
      const v = value as EditorScreenshotResult
      if (v?.base64) {
        return [{ type: 'image', data: v.base64, mimeType: `image/${v.format ?? 'png'}` }]
      }
      return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
    },
  },
  execute: editorScreenshot,
}
