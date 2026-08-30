/**
 * 目录镜像同步：把 home(~/.dsh) 下的配置/数据目录同步到项目根 .dsh。
 *
 * 策略：
 * - 单向 home → 项目（home 是运行时事实源，项目 .dsh 是随 git 走的快照）
 * - 内容变化才写：逐文件 sha1 比对，仅复制有差异的文件（避免无谓 IO 与 git 噪音）
 * - 结构完全一致：镜像整棵目录树（新增/更新/可选删除多余文件）
 * - 跳过运行时目录：node_modules（含 junction）、.dsh-module-fallback 等
 *
 * @module sync
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, copyFileSync, rmSync } from 'node:fs'
import { join, relative } from 'node:path'

/** 默认排除的目录名（同步时整棵跳过）。 */
const DEFAULT_EXCLUDES = new Set([
  'node_modules',
  '.dsh-module-fallback',
  '.dsh-profile-patches',
  '.git',
  'dist',
])

export interface SyncOptions {
  /** 额外的排除目录名（合并进默认排除集）。 */
  extraExcludes?: readonly string[]
  /** 目标目录里源没有的多余文件是否删除（默认 false：只增不删，安全优先）。 */
  deleteExtraneous?: boolean
}

export interface SyncResult {
  /** 复制的文件数。 */
  copied: number
  /** 删除的多余文件数（仅 deleteExtraneous 时可能非 0）。 */
  deleted: number
  /** 已存在且内容一致、未写入的文件数。 */
  unchanged: number
  /** 本次同步的所有文件路径（相对源根），便于日志/调试。 */
  touched: string[]
}

/** 计算文件 sha1（内容级比对，保证"内容变化才写"）。 */
function hashFile(filePath: string): string {
  const hash = createHash('sha1')
  hash.update(readFileSync(filePath))
  return hash.digest('hex')
}

/**
 * 递归镜像同步一个源目录到目标目录。
 * 源不存在时直接返回（不清理目标，避免误删）。
 */
export function syncDir(srcDir: string, destDir: string, options: SyncOptions = {}): SyncResult {
  const excludes = new Set([...DEFAULT_EXCLUDES, ...(options.extraExcludes ?? [])])
  const result: SyncResult = { copied: 0, deleted: 0, unchanged: 0, touched: [] }
  if (!existsSync(srcDir)) return result
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })

  const entries = readdirSync(srcDir, { withFileTypes: true })
  const srcNames = new Set<string>()

  for (const entry of entries) {
    if (excludes.has(entry.name)) continue
    srcNames.add(entry.name)
    const srcPath = join(srcDir, entry.name)
    const destPath = join(destDir, entry.name)

    if (entry.isDirectory()) {
      // 递归镜像子目录
      const sub = syncDir(srcPath, destPath, options)
      result.copied += sub.copied
      result.deleted += sub.deleted
      result.unchanged += sub.unchanged
      result.touched.push(...sub.touched)
    } else if (entry.isFile()) {
      const rel = relative(srcDir, srcPath)
      if (existsSync(destPath) && statSync(destPath).isFile() && hashFile(destPath) === hashFile(srcPath)) {
        result.unchanged += 1
        continue
      }
      copyFileSync(srcPath, destPath)
      result.copied += 1
      result.touched.push(rel)
    }
    // 符号链接 / junction：跳过（不复制链接本身，避免误带外部路径）
  }

  // 可选：删除目标多余文件（默认关闭，安全优先）
  if (options.deleteExtraneous) {
    for (const destEntry of readdirSync(destDir, { withFileTypes: true })) {
      if (srcNames.has(destEntry.name) || excludes.has(destEntry.name)) continue
      const destPath = join(destDir, destEntry.name)
      rmSync(destPath, { recursive: true, force: true })
      result.deleted += 1
      result.touched.push(relative(destDir, destPath))
    }
  }

  return result
}
