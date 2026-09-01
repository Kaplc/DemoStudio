/**
 * uiSourceActions — 编辑器"编译 UI 源"动作（方案 §6 触发时机 b/c）
 *
 * 供 UI 预览页签按钮 / 控制台命令 / MCP ui_compile 命令调用：
 *  - compileUiSourceToAsset(assetPath)：读 .widget.html → 编译 → lint 门槛 → 覆写 .widget.json
 *    （经 BlueprintEditorService.updateFromPreview 同步预览/工作副本）
 *  - 错误信息面向源文件（行号指向 .widget.html），不暴露生成物坐标
 */
import { compileUiSource } from './uiSourceSync'
import { lintWidgetDoc } from './uiCompiler'
import { BlueprintEditorService } from '../blueprintEdit/BlueprintEditorService'
import { logger } from '../../engine/Logger'

/** 编译动作结果（MCP/控制台共用，面向源文件行号） */
export interface UiCompileAction {
  ok: boolean
  /** 编译错误（line 指向 .widget.html） */
  errors: Array<{ line: number; message: string }>
  /** lint 违规（error 档阻断，warn 档透传） */
  lintIssues: Array<{ nodePath: string; field: string; rule: string; severity: string; message: string }>
  warnings: string[]
  /** 成功时更新的资产路径 */
  assetPath?: string
}

/** 读源文件（electronAPI 或 Mock textCache） */
async function readSource(srcPath: string): Promise<string | null> {
  const api = window.electronAPI
  if (api?.readTextFile) {
    const r = await api.readTextFile(srcPath)
    return r.success ? (r.data as string) : null
  }
  return null
}

/**
 * 编译 .widget.html → 覆写 .widget.json（lint 零错误门槛 + 预览同步）。
 * @param assetPath widget 资产路径（src/projects/.../xxx.widget.json）
 */
export async function compileUiSourceToAsset(assetPath: string): Promise<UiCompileAction> {
  const srcPath = assetPath.replace(/\.widget\.json$/i, '.widget.html')
  const out: UiCompileAction = { ok: false, errors: [], lintIssues: [], warnings: [] }

  const source = await readSource(srcPath)
  if (source === null) {
    out.errors.push({ line: 0, message: `源文件不存在: ${srcPath}（无源资产请先创建 .widget.html）` })
    return out
  }

  // 1. 编译（错误行号面向源文件）
  const compiled = compileUiSource(source)
  if (!compiled.ok || !compiled.doc) {
    out.errors.push(...compiled.errors)
    logger.warn(`[UiCompile] 编译失败: ${srcPath}: ${compiled.errors.map((e) => `行${e.line} ${e.message}`).join(' | ')}`)
    return out
  }

  // 2. assetLint 零错误门槛（编译成功 ≠ 可落盘）
  const lint = await lintWidgetDoc(compiled.doc, assetPath)
  for (const i of lint.issues) {
    out.lintIssues.push({
      nodePath: i.nodePath, field: i.field, rule: (i as { ruleId?: string }).ruleId ?? (i as { rule?: string }).rule ?? '',
      severity: i.severity, message: i.message,
    })
  }
  if (!lint.ok) {
    logger.warn(`[UiCompile] 产物未过 assetLint（零错误门槛）: ${srcPath}: ${lint.issues.length} 个问题`)
    return out
  }

  // 3. 覆写 json + 同步预览/工作副本（保存链路会自动反编译回写源，两侧保持等效）
  await BlueprintEditorService.updateFromPreview(
    assetPath,
    compiled.doc as unknown as Parameters<typeof BlueprintEditorService.updateFromPreview>[1],
  )
  const saved = await BlueprintEditorService.save(assetPath)
  if (!saved.ok) {
    out.errors.push({ line: 0, message: `落盘失败: ${saved.error}` })
    return out
  }

  logger.info(`[UiCompile] 编译成功: ${srcPath} → ${assetPath}（assetLint 零错误）`)
  out.ok = true
  out.assetPath = assetPath
  return out
}
