/**
 * 指令文件探测与受限读取：优先 DSH `ctx.fs` provider（复用沙箱/版本/可取消策略），
 * provider 缺席时用受限 Node 兜底（realpath containment，不读项目根外文件）。
 *
 * @module @demostudio/ds-instructions/files
 */

import { createHash } from 'node:crypto'
import { readFile, realpath, stat as nodeStat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'

/** 内容 SHA-1（与官方 instructionContentSha1 一致）。 */
export function contentDigest(content: string): string {
  return createHash('sha1').update(content).digest('hex')
}

/** 探测结果：present 携带版本与大小；absent 确认不存在/非文件；unavailable 为临时失败。 */
export type Probe =
  | { kind: 'present'; version: string | undefined; size: number | undefined }
  | { kind: 'absent' }
  | { kind: 'unavailable' }

/** 已加载的指令内容。 */
export interface LoadedInstruction {
  content: string
  digest: string
  /** 读取时的版本/元数据标识（FsVersion 或 `mtimeNs:size`）。 */
  version: string
  size: number
}

/** 会话级缓存条目（性能优化；session 可见状态以 durable message 为准）。 */
export interface InstructionCacheEntry {
  absolutePath: string
  version: string
  size: number
  content: string
  digest: string
}

export type InstructionCache = Map<string, InstructionCacheEntry>

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT'
}

async function signalOpts(signal: AbortSignal | undefined): Promise<{ signal: AbortSignal } | undefined> {
  return signal === undefined ? undefined : { signal }
}

// ─────────────────────────── ctx.fs 路径 ───────────────────────────

async function fsProbe(fileSystem: FileSystem, absolutePath: string, signal?: AbortSignal): Promise<Probe> {
  try {
    const target = await fileSystem.resolve(absolutePath, await signalOpts(signal))
    signal?.throwIfAborted()
    const info = await fileSystem.stat(target, signal)
    signal?.throwIfAborted()
    if (info?.type !== 'file') return { kind: 'absent' }
    return { kind: 'present', version: info.version, size: info.size }
  } catch (error) {
    signal?.throwIfAborted()
    if (isMissingPathError(error)) return { kind: 'absent' }
    return { kind: 'unavailable' }
  }
}

async function fsRead(
  fileSystem: FileSystem,
  target: FsTarget,
  version: string | undefined,
  size: number | undefined,
  maxSourceBytes: number,
  signal?: AbortSignal,
): Promise<LoadedInstruction | undefined> {
  try {
    if (size !== undefined && size > maxSourceBytes) return undefined
    const parts: string[] = []
    let bytes = 0
    for await (const chunk of await fileSystem.streamText(target, signal)) {
      signal?.throwIfAborted()
      bytes += Buffer.byteLength(chunk, 'utf8')
      if (bytes > maxSourceBytes) return undefined
      parts.push(chunk)
    }
    signal?.throwIfAborted()
    const content = parts.join('')
    return {
      content,
      digest: contentDigest(content),
      version: version ?? `bytes:${bytes}`,
      size: bytes,
    }
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof RangeError || isMissingPathError(error)) return undefined
    return undefined
  }
}

// ─────────────────────────── Node 兜底路径 ───────────────────────────

/**
 * Node 兜底的 containment 校验：realpath（跟随符号链接）后必须仍位于项目根内。
 * 断开的符号链接 stat 即 ENOENT → absent；指向项目外的链接 → 拒绝读取。
 */
async function nodeContained(root: string, absolutePath: string): Promise<boolean> {
  try {
    const [realRoot, realFile] = await Promise.all([
      realpath(root).catch(() => resolve(root)),
      realpath(absolutePath),
    ])
    const rel = relative(realRoot, realFile)
    if (rel === '' || rel.startsWith('..')) return false
    if (process.platform === 'win32' && /^[a-zA-Z]:/.test(rel)) return false
    return true
  } catch {
    return false
  }
}

async function nodeProbe(absolutePath: string, signal?: AbortSignal): Promise<Probe> {
  try {
    signal?.throwIfAborted()
    // stat（非 lstat）+ bigint：mtimeNs 纳秒精度作为版本元数据；断链 → ENOENT → absent
    const info = await nodeStat(absolutePath, { bigint: true })
    signal?.throwIfAborted()
    if (!info.isFile()) return { kind: 'absent' }
    return { kind: 'present', version: `mtime:${info.mtimeNs}`, size: Number(info.size) }
  } catch (error) {
    signal?.throwIfAborted()
    if (isMissingPathError(error)) return { kind: 'absent' }
    return { kind: 'unavailable' }
  }
}

async function nodeRead(
  absolutePath: string,
  version: string | undefined,
  size: number | undefined,
  maxSourceBytes: number,
  signal?: AbortSignal,
): Promise<LoadedInstruction | undefined> {
  try {
    signal?.throwIfAborted()
    if (size !== undefined && size > maxSourceBytes) return undefined
    const raw = await readFile(absolutePath)
    signal?.throwIfAborted()
    // probe 与读取之间文件可能变大：以实际字节复核上限
    if (raw.byteLength > maxSourceBytes) return undefined
    const content = raw.toString('utf8')
    const bytes = Buffer.byteLength(content, 'utf8')
    return {
      content,
      digest: contentDigest(content),
      // 版本沿用 probe 的元数据标识（mtime:...），保证 probe.version === cached.version 的缓存判定成立
      version: version ?? `bytes:${bytes}:${raw.byteLength}`,
      size: raw.byteLength,
    }
  } catch {
    signal?.throwIfAborted()
    return undefined
  }
}

// ─────────────────────────── 统一入口 ───────────────────────────

export interface FileAccess {
  probe(absolutePath: string, signal?: AbortSignal): Promise<Probe>
  read(absolutePath: string, probe: Extract<Probe, { kind: 'present' }>, maxSourceBytes: number, signal?: AbortSignal): Promise<LoadedInstruction | undefined>
  /** 标记探测（项目根回溯用）：存在即可（文件或目录），不做 containment、不要求常规文件。 */
  probeMarker(absolutePath: string, signal?: AbortSignal): Promise<boolean>
  /** Node 兜底模式标记：真实产品必须明确文档化与 ctx.fs 的沙箱差异（§8.3）。 */
  readonly mode: 'fs' | 'node-fallback'
}

/** ctx.fs provider 可用时的标准实现。 */
export function createFsAccess(fileSystem: FileSystem): FileAccess {
  return {
    mode: 'fs',
    probe: (path, signal) => fsProbe(fileSystem, path, signal),
    async read(path, probe, maxSourceBytes, signal) {
      try {
        const target = await fileSystem.resolve(path, await signalOpts(signal))
        // resolve 之后 target 仍需复查版本：读取过程中文件被替换时以读到的内容为准（§14.3 读取一致性）
        return await fsRead(fileSystem, target, probe.version, probe.size, maxSourceBytes, signal)
      } catch {
        signal?.throwIfAborted()
        return undefined
      }
    },
    async probeMarker(path, signal) {
      try {
        const target = await fileSystem.resolve(path, await signalOpts(signal))
        return await fileSystem.stat(target, signal) !== undefined
      } catch {
        signal?.throwIfAborted()
        return false
      }
    },
  }
}

/** Node 受限兜底实现：probe 后做 realpath containment，项目根外一律拒绝。 */
export function createNodeFallbackAccess(root: string): FileAccess {
  return {
    mode: 'node-fallback',
    async probe(path, signal) {
      const probe = await nodeProbe(path, signal)
      if (probe.kind !== 'present') return probe
      return (await nodeContained(root, path)) ? probe : { kind: 'absent' }
    },
    async read(path, probe, maxSourceBytes, signal) {
      if (!(await nodeContained(root, path))) return undefined
      return nodeRead(path, probe.version, probe.size, maxSourceBytes, signal)
    },
    probeMarker: nodeMarkerExists,
  }
}

/** 纯 Node 裸探测（无 containment）：仅用于项目根向上回溯的 marker 探测。 */
export function createBareNodeAccess(): FileAccess {
  return {
    mode: 'node-fallback',
    probe: nodeProbe,
    async read() {
      return undefined
    },
    probeMarker: nodeMarkerExists,
  }
}

/** marker 探测：路径存在（文件/目录/其他）即为真；断链/错误为假。 */
async function nodeMarkerExists(absolutePath: string, signal?: AbortSignal): Promise<boolean> {
  try {
    signal?.throwIfAborted()
    await nodeStat(absolutePath)
    signal?.throwIfAborted()
    return true
  } catch {
    signal?.throwIfAborted()
    return false
  }
}

/**
 * probe + 缓存 + 读取的组合：缓存命中（版本与大小一致）不重复读正文；
 * 版本变化必须重读；读取失败/超限返回 undefined 且不污染缓存。
 */
export async function loadInstruction(
  access: FileAccess,
  cache: InstructionCache,
  absolutePath: string,
  maxSourceBytes: number,
  signal?: AbortSignal,
): Promise<{ probe: Probe; loaded: LoadedInstruction | undefined }> {
  const probe = await access.probe(absolutePath, signal)
  if (probe.kind !== 'present') return { probe, loaded: undefined }
  const cached = cache.get(absolutePath)
  if (
    cached !== undefined
    && probe.version !== undefined && cached.version === probe.version
    && probe.size !== undefined && cached.size === probe.size
  ) {
    return { probe, loaded: { content: cached.content, digest: cached.digest, version: cached.version, size: cached.size } }
  }
  const loaded = await access.read(absolutePath, probe, maxSourceBytes, signal)
  if (loaded !== undefined) {
    cache.set(absolutePath, {
      absolutePath,
      version: loaded.version,
      size: loaded.size,
      content: loaded.content,
      digest: loaded.digest,
    })
  }
  return { probe, loaded }
}
