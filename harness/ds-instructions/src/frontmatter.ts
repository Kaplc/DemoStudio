/**
 * 指令文件 frontmatter 解析与目录自动扫描。
 *
 * 每个 *.instructions.md 文件可在头部声明 YAML frontmatter 指定映射前缀：
 *
 * ```markdown
 * ---
 * prefix: src/engine
 * ---
 * # 引擎开发规范
 * ...
 * ```
 *
 * 插件启动时扫描指令目录，从 frontmatter 中提取 prefix 字段，
 * 与显式配置的 mappings 合并（显式优先），无需手动维护 cordis.patch.yml。
 *
 * @module @demostudio/ds-instructions/frontmatter
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { MappingRule } from './config.js'

/**
 * 从 Markdown 内容中解析 YAML frontmatter 的 prefix 字段。
 * 只做轻量正则提取，不引入完整 YAML 解析器（避免依赖膨胀）。
 * @param content - 指令文件全文。
 * @returns prefix 值；无 frontmatter 或无 prefix 字段返回 undefined。
 */
export function parseFrontmatterPrefix(content: string): string | undefined {
  // 匹配 --- 包裹的 frontmatter 块（兼容 CRLF）
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match?.[1]) return undefined
  const frontmatter = match[1]
  // 提取 prefix: value 行（值可能带引号）
  const prefixMatch = frontmatter.match(/^prefix:\s*['"]?([^'"\n\r]+)['"]?\s*$/m)
  if (!prefixMatch?.[1]) return undefined
  const value = prefixMatch[1].trim()
  return value.length > 0 ? value : undefined
}

/**
 * 扫描指令目录，从每个 *.instructions.md 文件的 frontmatter 中提取映射规则。
 * 文件读取失败（权限/编码等）静默跳过，不中断扫描。
 * @param instructionsDir - 指令目录绝对路径。
 * @param maxProbeBytes - 单文件探测读取上限（只读前 N 字节提取 frontmatter）。
 * @param signal - 可选中止信号。
 * @returns 自动发现的映射规则列表。
 */
export async function scanFrontmatterMappings(
  instructionsDir: string,
  maxProbeBytes = 4096,
  signal?: AbortSignal,
): Promise<MappingRule[]> {
  const mappings: MappingRule[] = []
  let entries: string[]
  try {
    const dir = await readdir(instructionsDir)
    entries = dir
  } catch {
    return mappings // 目录不存在 → 空
  }

  for (const entry of entries) {
    signal?.throwIfAborted()
    if (!entry.endsWith('.instructions.md')) continue
    try {
      // 只读前 maxProbeBytes 字节：frontmatter 在文件头部，无需读全文
      const filePath = join(instructionsDir, entry)
      const fh = await readFile(filePath)
      const head = fh.subarray(0, maxProbeBytes).toString('utf8')
      const prefix = parseFrontmatterPrefix(head)
      if (prefix !== undefined) {
        mappings.push({ prefix, file: entry })
      }
    } catch {
      // 文件不可读 → 跳过
    }
  }
  return mappings
}
