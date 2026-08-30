/**
 * §14.3 文件系统与版本测试：Node 兜底探测/读取、mtimeNs+size 缓存有效性、
 * 空文件、超限、符号链接 containment（链接到项目外拒绝、断链视为不存在）。
 */
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { contentDigest, createBareNodeAccess, createNodeFallbackAccess, loadInstruction, type FileAccess, type LoadedInstruction, type Probe } from '../src/files.js'
import { findProjectRoot } from '../src/state.js'

let cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.map(dir => rm(dir, { recursive: true, force: true })))
  cleanup = []
})

async function repo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-instr-fs-'))
  cleanup.push(dir)
  return dir
}

/** 包装 access 统计真实读取次数（read 调用数，不含 probe）。 */
function counting(access: FileAccess): FileAccess & { readCount(): number } {
  let reads = 0
  return {
    mode: access.mode,
    probe: (path, signal) => access.probe(path, signal),
    read: async (path, probe, maxSourceBytes, signal): Promise<LoadedInstruction | undefined> => {
      reads += 1
      return access.read(path, probe, maxSourceBytes, signal)
    },
    probeMarker: (path, signal) => access.probeMarker(path, signal),
    readCount: () => reads,
  }
}

describe('Node 兜底探测与读取', () => {
  it('存在/不存在/目录目标的探测三态', async () => {
    const root = await repo()
    await writeFile(join(root, 'a.md'), 'content')
    await mkdir(join(root, 'dir'))
    const access = createNodeFallbackAccess(root)
    const present: Probe = await access.probe(join(root, 'a.md'))
    expect(present.kind).toBe('present')
    expect(present.kind === 'present' && present.size).toBe(7)
    expect((await access.probe(join(root, 'missing.md'))).kind).toBe('absent')
    expect((await access.probe(join(root, 'dir'))).kind).toBe('absent')
  })

  it('读取内容 + digest + 版本标识', async () => {
    const root = await repo()
    const file = join(root, 'a.md')
    await writeFile(file, 'instruction body')
    const access = createNodeFallbackAccess(root)
    const probe = await access.probe(file)
    const loaded = await access.read(file, probe as Extract<Probe, { kind: 'present' }>, 65536)
    expect(loaded?.content).toBe('instruction body')
    expect(loaded?.digest).toBe(contentDigest('instruction body'))
    expect(loaded?.version).toMatch(/^mtime:\d+$/)
  })

  it('超过 maxSourceBytes 的文件拒绝读取（按字节而非字符）', async () => {
    const root = await repo()
    const file = join(root, 'big.md')
    await writeFile(file, '😀'.repeat(10))
    const access = createNodeFallbackAccess(root)
    const probe = await access.probe(file)
    // 😀 为 4 字节：40 字节内容，字符数只有 10
    expect(await access.read(file, probe as Extract<Probe, { kind: 'present' }>, 20)).toBeUndefined()
    expect(await access.read(file, probe as Extract<Probe, { kind: 'present' }>, 40)).toBeDefined()
  })

  it('符号链接指向项目内文件 → 可读；指向项目外 → 拒绝；断链 → absent', async () => {
    if (process.platform === 'win32') return
    const root = await repo()
    const outside = await repo()
    await writeFile(join(root, 'inner.md'), 'inner body')
    await writeFile(join(outside, 'outer.md'), 'outer body')
    await symlink(join(root, 'inner.md'), join(root, 'link-inner.md'))
    await symlink(join(outside, 'outer.md'), join(root, 'link-outer.md'))
    await symlink(join(root, 'missing-target.md'), join(root, 'link-broken.md'))
    const access = createNodeFallbackAccess(root)
    expect((await access.probe(join(root, 'link-inner.md'))).kind).toBe('present')
    expect((await access.probe(join(root, 'link-outer.md'))).kind).toBe('absent')
    expect((await access.probe(join(root, 'link-broken.md'))).kind).toBe('absent')
  })
})

describe('缓存策略（§8.2）', () => {
  it('缓存命中（mtimeNs+size 一致）不重读正文；内容变化后重读出新 digest', async () => {
    const root = await repo()
    const file = join(root, 'a.md')
    await writeFile(file, 'first')
    const access = counting(createNodeFallbackAccess(root))
    const cache = new Map()
    const first = await loadInstruction(access, cache, file, 65536)
    expect(first.loaded?.content).toBe('first')
    expect(access.readCount()).toBe(1)

    const cached = await loadInstruction(access, cache, file, 65536)
    expect(cached.loaded?.content).toBe('first')
    expect(access.readCount()).toBe(1)

    // 内容变化：把 mtime 拨回过去，靠 size 变化使缓存失效重读
    await writeFile(file, 'second-content')
    const updated = await loadInstruction(access, cache, file, 65536)
    expect(updated.loaded?.content).toBe('second-content')
    expect(updated.loaded?.digest).not.toBe(first.loaded?.digest)
    expect(access.readCount()).toBe(2)
  })

  it('mtime 未变但 size 变化 → 缓存失效重读', async () => {
    const root = await repo()
    const file = join(root, 'a.md')
    await writeFile(file, 'v1')
    const access = counting(createNodeFallbackAccess(root))
    const cache = new Map()
    await loadInstruction(access, cache, file, 65536)
    const statBefore = await import('node:fs/promises').then(fs => fs.stat(file))
    await writeFile(file, 'v1-longer')
    const past = new Date(statBefore.mtimeMs - 10_000)
    await utimes(file, past, past)
    const reloaded = await loadInstruction(access, cache, file, 65536)
    expect(reloaded.loaded?.content).toBe('v1-longer')
    expect(access.readCount()).toBe(2)
  })

  it('超限读取不污染缓存（PRD：失败不提交）', async () => {
    const root = await repo()
    const file = join(root, 'a.md')
    await writeFile(file, 'x'.repeat(100))
    const access = counting(createNodeFallbackAccess(root))
    const cache = new Map()
    const result = await loadInstruction(access, cache, file, 10)
    expect(result.loaded).toBeUndefined()
    expect(cache.size).toBe(0)
  })

  it('文件消失后缓存不掩盖缺席', async () => {
    const root = await repo()
    const file = join(root, 'a.md')
    await writeFile(file, 'gone soon')
    const access = counting(createNodeFallbackAccess(root))
    const cache = new Map()
    await loadInstruction(access, cache, file, 65536)
    await rm(file)
    const after = await loadInstruction(access, cache, file, 65536)
    expect(after.probe.kind).toBe('absent')
    expect(after.loaded).toBeUndefined()
  })
})

describe('项目根探测（§5.3 兜底）', () => {
  it('向上回溯找到 .git；没有标记时用 cwd 兜底', async () => {
    const root = await repo()
    await mkdir(join(root, '.git'))
    await mkdir(join(root, 'deep/nested'), { recursive: true })
    const rootFound = await findProjectRoot(join(root, 'deep', 'nested'), createBareNodeAccess())
    expect(resolveSlash(rootFound)).toBe(resolveSlash(root))

    const noMarker = await repo()
    await mkdir(join(noMarker, 'child'), { recursive: true })
    const fallback = await findProjectRoot(join(noMarker, 'child'), createBareNodeAccess())
    expect(resolveSlash(fallback)).toBe(resolveSlash(join(noMarker, 'child')))
  })
})

function resolveSlash(value: string): string {
  return value.replaceAll('\\', '/')
}
