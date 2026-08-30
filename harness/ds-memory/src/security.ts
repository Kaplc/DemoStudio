/**
 * 记忆路径安全防护（安全红线）。
 *
 * 三层防御，任何文件名/相对路径输入都必须先过第一层：
 * 1. {@link sanitizePathKey} — 字符串层：拒绝 null 字节、URL 编码穿越、
 *    Unicode 规范化攻击、反斜杠、绝对路径、`..` 段。
 * 2. {@link realpathDeepestExisting} — 文件系统层：对最深已存在祖先做 realpath，
 *    检出符号链接（含悬空链接）与链接环。
 * 3. {@link assertWithinRealRoot} — 包含层：realpath 后的前缀比较，
 *    确保最终落点仍在记忆目录的真实位置内。
 *
 * @module security
 */

import { lstat, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'

/** 路径校验发现穿越/注入企图时抛出。 */
export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PathTraversalError'
  }
}

/** 提取 Node fs 错误的 errno code（非 fs 错误返回 undefined）。 */
function errnoCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null | undefined)?.code
  return typeof code === 'string' ? code : undefined
}

/**
 * 字符串层校验：拒绝危险模式，原样返回合法的相对 key。
 * 只处理"记忆目录内的相对路径 key"（文件名或子目录相对路径）。
 */
export function sanitizePathKey(key: string): string {
  // null 字节会在 C 层系统调用里截断路径
  if (key.includes('\0')) {
    throw new PathTraversalError(`null byte in path key: "${key}"`)
  }
  // URL 编码穿越（%2e%2e%2f = ../）；坏编码（%ZZ）不可能构成 URL 穿越，放行原文
  let decoded: string
  try {
    decoded = decodeURIComponent(key)
  } catch {
    decoded = key
  }
  if (decoded !== key && (decoded.includes('..') || decoded.includes('/') || decoded.includes('\\'))) {
    throw new PathTraversalError(`URL-encoded traversal in path key: "${key}"`)
  }
  // Unicode 规范化攻击：全角 ．．／（U+FF0E U+FF0F）经 NFKC 变为 ASCII ../；
  // Node 的 path/fs 视其为普通字节，但下游文件系统或工具链可能规范化 — 纵深防御，直接拒绝
  const normalized = key.normalize('NFKC')
  if (normalized !== key
    && (normalized.includes('..') || normalized.includes('/') || normalized.includes('\\') || normalized.includes('\0'))) {
    throw new PathTraversalError(`Unicode-normalized traversal in path key: "${key}"`)
  }
  // 反斜杠（Windows 分隔符，穿越向量）
  if (key.includes('\\')) {
    throw new PathTraversalError(`backslash in path key: "${key}"`)
  }
  // 绝对路径（POSIX 斜杠开头或 Windows 盘符/UNC）
  if (isAbsolute(key) || /^[a-zA-Z]:/.test(key) || key.startsWith('//')) {
    throw new PathTraversalError(`absolute path key: "${key}"`)
  }
  // 显式父目录段
  if (key.split(/[\\/]/).includes('..')) {
    throw new PathTraversalError(`parent-directory segment in path key: "${key}"`)
  }
  return key
}

/**
 * 对最深已存在祖先做 realpath 并拼回不存在的尾部。
 * 目标文件可能尚不存在（即将创建），直接 realpath 会 ENOENT；
 * 逐级上溯直到 realpath 成功，再把不存在的尾段拼回。
 * 悬空符号链接是攻击向量（writeFile 会跟随链接在目录外创建目标），
 * lstat 区分"真不存在"与"悬空链接"，后者拒绝。
 */
export async function realpathDeepestExisting(absolutePath: string): Promise<string> {
  const tail: string[] = []
  let current = resolve(absolutePath)
  for (
    let parent = dirname(current);
    current !== parent;
    parent = dirname(current)
  ) {
    try {
      const realCurrent = await realpath(current)
      return tail.length === 0
        ? realCurrent
        : join(realCurrent, ...tail.reverse())
    } catch (error: unknown) {
      const code = errnoCode(error)
      if (code === 'ENOENT') {
        // 可能是真不存在，也可能是悬空链接 — lstat 区分
        try {
          const stats = await lstat(current)
          if (stats.isSymbolicLink()) {
            throw new PathTraversalError(`dangling symlink detected (target does not exist): "${current}"`)
          }
        } catch (lstatError: unknown) {
          if (lstatError instanceof PathTraversalError) throw lstatError
          // lstat 也失败（真不存在或不可访问）— 继续上溯
        }
      } else if (code === 'ELOOP') {
        throw new PathTraversalError(`symlink loop detected in path: "${current}"`)
      } else if (code !== 'ENOTDIR' && code !== 'ENAMETOOLONG') {
        // EACCES/EIO 等 — 无法验证包含关系，fail closed
        throw new PathTraversalError(`cannot verify path containment (${code ?? 'UNKNOWN'}): "${current}"`)
      }
      tail.push(current.slice(parent.length + sep.length))
      current = parent
    }
  }
  // 上溯到根都没有已存在祖先（极罕见）— 返回原值，由包含检查拒绝
  return absolutePath
}

/**
 * 包含检查：realpath 后的候选路径必须仍在 realpath 后的根目录内。
 * 前缀比较基于真实文件系统位置，而非符号路径。
 */
export function assertWithinRealRoot(realCandidate: string, realRoot: string): void {
  if (realCandidate === realRoot) return
  const rootWithSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep
  if (!realCandidate.startsWith(rootWithSep)) {
    throw new PathTraversalError(`path escapes memory directory: "${realCandidate}" is not within "${realRoot}"`)
  }
}

/**
 * 写入前的完整校验：sanitize key → resolve → realpath 最深已存在祖先 → 与真实根比较。
 * 根目录不存在时跳过包含检查是安全的：符号链接逃逸需要根目录内已有符号链接，
 * 目录不存在则链接不存在；首趟字符串层校验此时已足够。
 */
export async function assertSafeWritePath(rootDir: string, relativeKey: string): Promise<string> {
  const sanitized = sanitizePathKey(relativeKey)
  const resolved = resolve(rootDir, sanitized)
  const realCandidate = await realpathDeepestExisting(resolved)
  let realRoot: string
  try {
    realRoot = await realpath(rootDir)
  } catch (error: unknown) {
    const code = errnoCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR') return resolved
    throw new PathTraversalError(`cannot verify memory directory (${code ?? 'UNKNOWN'}): "${rootDir}"`)
  }
  assertWithinRealRoot(realCandidate, realRoot)
  return resolved
}
