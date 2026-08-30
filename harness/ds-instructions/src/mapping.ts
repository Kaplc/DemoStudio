/**
 * 被读取文件路径 → 指令文件的映射：规范化、项目根 containment、最长段级前缀匹配。
 *
 * 匹配规则（§5.1）：按路径段边界比较，`src/engine2/a.ts` 不会命中 `src/engine`；
 * 不使用字符串 `includes`。win32 下前缀比较忽略大小写。
 *
 * @module @demostudio/ds-instructions/mapping
 */

import { resolve } from 'node:path'
import { containedRelative, pathCompareKey, type ResolvedMapping, type ResolvedRootConfig } from './config.js'

/**
 * 把工具参数里的 `file_path` 规范化为项目根相对路径。
 * @param root - 项目根（绝对路径）。
 * @param rawPath - 工具参数原值（相对路径按 §5.2 基于 projectRoot 解析；接受 `\` 分隔）。
 * @returns 项目根相对路径（平台分隔符）；越界（`..`、跨盘）或空值返回 undefined。
 */
export function normalizeTouchedPath(root: string, rawPath: unknown): string | undefined {
  if (typeof rawPath !== 'string') return undefined
  const trimmed = rawPath.trim()
  if (trimmed.length === 0) return undefined
  const absolute = resolve(root, trimmed)
  return containedRelative(root, absolute)
}

/**
 * 按最长段级前缀匹配被读取文件的项目根相对路径。
 * @param relPath - 项目根相对路径（来自 {@link normalizeTouchedPath}）。
 * @param mappings - 已按最长前缀排序的映射表。
 * @returns 命中的映射；无匹配返回 undefined。
 */
export function matchMapping(relPath: string, mappings: readonly ResolvedMapping[]): ResolvedMapping | undefined {
  const segments = relPath.split(/[\\/]+/).filter(segment => segment.length > 0)
  for (const mapping of mappings) {
    if (segments.length < mapping.segments.length) continue
    const ok = mapping.segments.every((segment, index) =>
      pathCompareKey(segments[index]!) === pathCompareKey(segment),
    )
    if (ok) return mapping
  }
  return undefined
}

/**
 * 一次成功读取产生的 touch：被读文件与其命中的指令文件。
 */
export interface MappedTouch {
  /** 指令文件在指令目录下的文件名。 */
  instructionFile: string
  /** 命中的映射声明序（稳定排序用）。 */
  order: number
}

/**
 * 解析一次文件读取命中的指令文件。
 * @param root - 项目根。
 * @param rawPath - 工具参数 `file_path` 原值。
 * @param resolved - 绑定项目根后的配置。
 * @returns 命中的指令文件；路径无效/越界/不匹配映射时返回 undefined。
 */
export function resolveTouch(root: string, rawPath: unknown, resolved: ResolvedRootConfig): MappedTouch | undefined {
  const relPath = normalizeTouchedPath(root, rawPath)
  if (relPath === undefined) return undefined
  const mapping = matchMapping(relPath, resolved.mappings)
  if (mapping === undefined) return undefined
  return { instructionFile: mapping.file, order: mapping.order }
}

/**
 * 把指令文件名解析为绝对路径与项目根相对展示路径。
 * @param resolved - 绑定项目根后的配置。
 * @param instructionFile - 指令目录下的纯文件名。
 */
export function instructionPaths(resolved: ResolvedRootConfig, instructionFile: string): {
  absolutePath: string
  displayPath: string
  scope: string
} {
  const absolutePath = resolve(resolved.instructionsDir, instructionFile)
  // scope 与官方 candidateScopeKey 同构：<相对目录>\u0000<文件名>，
  // 让官方 agent-instructions 共存时把我们的 scope 探测到同一个文件（digest 一致 → 静默）
  const displayPath = `${resolved.instructionsDisplayDir}/${instructionFile}`
  return { absolutePath, displayPath, scope: `${resolved.instructionsDisplayDir}\u0000${instructionFile}` }
}
