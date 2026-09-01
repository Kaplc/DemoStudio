/**
 * uiSourceSync — UI 源格式双向同步服务（方案 §6 sourceHash 同步规则）
 *
 * 状态判定（以磁盘上 .widget.html 是否存在为准）：
 *  - 无源文件（旧资产）→ 保存链路不做任何反编译动作（TC-D5 不误删不报错）
 *  - 有源文件 + json.sourceHash == 编译源指纹 → 正常：反编译回写源 + 重算 hash
 *  - 有源文件 + hash 不一致（源也被改过）→ 冲突：返回 conflict，
 *    编辑器提示二选一（默认以最后保存方 json 为准：反编译覆盖源）
 *
 * 全部经 electronAPI 文件 IO（相对项目根路径），浏览器 Mock 环境降级为内存缓存。
 */
import { compileWidgetHtml, decompileWidgetJson } from './uiCompiler'
import type { CompileError } from './uiCompiler'
import { logger } from '../../engine/Logger'

/** 同步结果 */
export interface UiSyncResult {
  /** 是否执行了回写 */
  written: boolean
  /** 冲突（源与 json 同时被改） */
  conflict: boolean
  /** 反编译警告 */
  warnings: string[]
  /** 错误（回写失败等） */
  error?: string
}

/** 内存缓存（Mock 环境 / 编译缓存：路径 → 源内容） */
const mockFiles = new Map<string, string>()

async function readText(relPath: string): Promise<string | null> {
  const api = window.electronAPI
  if (api?.readTextFile) {
    const r = await api.readTextFile(relPath)
    return r.success ? (r.data as string) : null
  }
  return mockFiles.get(relPath) ?? null
}

async function writeText(relPath: string, content: string): Promise<boolean> {
  const api = window.electronAPI
  if (api?.writeTextFile) {
    const r = await api.writeTextFile(relPath, content)
    return r.success
  }
  mockFiles.set(relPath, content)
  return true
}

/** FNV-1a（与 compile.ts 保持一致：编译指纹） */
function fnv1a(str: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0
  }
  return `fnv1a-${h.toString(16).padStart(8, '0')}`
}

/** widget.json 路径 → 源文件路径 */
export function sourcePathOf(widgetPath: string): string {
  return widgetPath.replace(/\.widget\.json$/i, '.widget.html')
}

/**
 * 保存 widget.json 后调用：反编译回写 .widget.html（TC-D1）。
 * @param widgetPath 资产路径（src/projects/.../xxx.widget.json）
 * @param widgetDoc  刚落盘的 json 文档
 */
export async function decompileBackOnSave(
  widgetPath: string,
  widgetDoc: unknown,
): Promise<UiSyncResult> {
  const srcPath = sourcePathOf(widgetPath)
  const warnings: string[] = []
  try {
    // 无源资产（TC-D5）：静默跳过，不报错不误写
    const existing = await readText(srcPath)
    if (existing === null) {
      return { written: false, conflict: false, warnings }
    }

    const result = decompileWidgetJson(widgetDoc)
    warnings.push(...result.warnings)
    if (!result.ok || !result.html) {
      logger.warn(`[UiSourceSync] 反编译失败，跳过回写: ${srcPath}: ${result.warnings.join('; ')}`)
      return { written: false, conflict: false, warnings, error: result.warnings.join('; ') }
    }

    // 冲突检测：磁盘源当前编译指纹 vs json 里的 sourceHash
    const jsonHash = (widgetDoc as Record<string, unknown>).sourceHash as string | undefined
    const diskCompile = compileWidgetHtml(existing)
    const diskHash = diskCompile.doc ? (diskCompile.doc.sourceHash as string) : undefined
    const conflict = Boolean(jsonHash && diskHash && jsonHash !== diskHash)
    if (conflict) {
      // 以最后保存方（json）为准：反编译覆盖源（方案 §11.3），并告警
      warnings.push('检测到源文件与 widget.json 同时被改（sourceHash 不一致）：以最后保存方（json）为准，源文件已被反编译结果覆盖')
      logger.warn(`[UiSourceSync] 双边同改冲突，以 json 为准回写源: ${srcPath}`)
    }

    // 回写源 + 重算 sourceHash（json 与源重新等效）
    await writeText(srcPath, result.html)
    const newHash = fnv1a(result.html.replace(/^\uFEFF/, ''))
    logger.info(`[UiSourceSync] 反编译回写源文件: ${srcPath}（conflict=${conflict}，newHash=${newHash}）`)
    return { written: true, conflict, warnings }
  } catch (e) {
    const msg = (e as Error).message
    logger.error(`[UiSourceSync] 回写异常: ${srcPath}: ${msg}`)
    return { written: false, conflict: false, warnings, error: msg }
  }
}

/** 编译源并返回结果（编辑器编译按钮 / MCP ui_compile 共用） */
export function compileUiSource(source: string): { ok: boolean; errors: CompileError[]; doc?: Record<string, unknown> } {
  return compileWidgetHtml(source)
}

export type { CompileError }
