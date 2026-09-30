/**
 * editor_screenshot — 编辑器画面截图落盘
 *
 * 通过 Playwright CDP 对编辑器页面截图，PNG 写入本地磁盘，
 * 返回绝对文件路径，供 agent 用 read_image 读取查看画面。
 */
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, isAbsolute, join, resolve } from 'path'
import { getEditorPage } from '../cdpBridge'

export interface EditorScreenshotArgs {
  /** 保存 PNG 的完整路径（绝对路径；相对路径按内核 cwd 解析。缺省自动命名到 logs/screenshots/ 下） */
  path?: string
  /** 是否截取整个页面高度（Electron 下通常等于视口），默认 false */
  fullPage?: boolean
}

export interface EditorScreenshotResult {
  ok: boolean
  /** PNG 绝对路径（用 read_image 读取） */
  path?: string
  /** 文件字节数 */
  bytes?: number
  /** 图片宽度（解析自 PNG IHDR，未知时省略） */
  width?: number
  /** 图片高度（解析自 PNG IHDR，未知时省略） */
  height?: number
  error?: string
}

/** 默认保存目录：项目根 logs/screenshots（内核 cwd 是 harness/dsh-source 时向上两级取项目根） */
function defaultScreenshotDir(): string {
  const cwd = process.cwd()
  if (/[\\/]harness[\\/]dsh-source$/.test(cwd)) {
    return join(cwd, '..', '..', 'logs', 'screenshots')
  }
  return join(cwd, 'logs', 'screenshots')
}

/** 本地时间戳 YYYY-MM-DD_HHmmss，与 logs/ 下控制台日志命名风格一致 */
function formatTimestamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** 从 PNG buffer 的 IHDR 块解析图片尺寸。CDP attach 下 page.viewportSize() 可能为 null，
 *  曾导致返回 width:null 撞 output.schema（"value.width must be a number"）——PNG 头才是真值。 */
function pngSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24) return null
  if (buffer.readUInt32BE(0) !== 0x89504e47) return null // \x89PNG 签名
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

export async function editorScreenshot(args: EditorScreenshotArgs): Promise<EditorScreenshotResult> {
  try {
    const page = await getEditorPage()

    const target = args.path?.trim()
    const absPath = target
      ? (isAbsolute(target) ? target : resolve(target))
      : join(defaultScreenshotDir(), `screenshot_${formatTimestamp(new Date())}.png`)

    mkdirSync(dirname(absPath), { recursive: true })

    const buffer = await page.screenshot({
      type: 'png',
      fullPage: args.fullPage ?? false,
      timeout: 15_000,
    })
    writeFileSync(absPath, buffer)

    console.log('[editorScreenshot] 截图已保存:', absPath, `${buffer.length} bytes`)
    // 严格不发 null：output.schema 声明 number/string，未知字段直接省略（schema 无 required）
    const result: EditorScreenshotResult = { ok: true, path: absPath, bytes: buffer.length }
    const size = pngSize(buffer)
    if (size) {
      result.width = size.width
      result.height = size.height
    }
    return result
  } catch (err) {
    console.warn('[editorScreenshot] 截图失败:', err)
    return { ok: false, error: `截图失败: ${err}` }
  }
}

export const editorScreenshotTool = {
  name: 'editor_screenshot',
  description: `截取编辑器当前画面，PNG 落盘后返回文件绝对路径（配合 read_image 工具读取查看画面）。

参数：
- path（可选）：保存路径，缺省自动命名到 logs/screenshots/screenshot_YYYY-MM-DD_HHmmss.png
- fullPage（可选）：截取整页高度，默认 false（可视区域）

典型流程：
1. editor_screenshot → 得到 { path }
2. read_image(file_path: path) → 查看画面`,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '保存 PNG 的完整路径（可选，缺省自动命名到 logs/screenshots/）' },
      fullPage: { type: 'boolean', description: '截取整页高度，默认 false' },
    },
    required: [],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        path: { type: 'string' },
        bytes: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        error: { type: 'string' },
      },
    },
    render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: editorScreenshot,
}
