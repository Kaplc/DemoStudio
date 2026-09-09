import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { relative, resolve, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  MAX_ASSOCIATE_TOTAL_CHARS,
  composeAssociateMessage,
  deriveProjectRoot,
  evalPrefixGroups,
  matchMemoryPrefix,
  normalizeRelPath,
} from '../src/associate.js'
import { parsePrefixExpr } from '../src/memoryTypes.js'
import { readAllMemories, writeMemory } from '../src/memoryStore.js'
import { scanMemoryFiles } from '../src/memoryScan.js'

const createdDirs: string[] = []
async function memoryDirectory(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ds-memory-'))
  createdDirs.push(dir)
  return dir
}

afterAll(async () => {
  for (const dir of createdDirs) await rm(dir, { recursive: true, force: true })
})

describe('normalizeRelPath', () => {
  const root = resolve(tmpdir(), 'assoc-root')

  it('项目根内的相对路径原样归一', () => {
    const raw = 'src/engine/a.ts'
    expect(normalizeRelPath(root, raw)).toBe(relative(root, resolve(root, raw)))
  })

  it('项目根内的绝对路径归一为相对', () => {
    const absolute = resolve(root, 'src', 'engine', 'a.ts')
    expect(normalizeRelPath(root, absolute)).toBe(relative(root, absolute))
  })

  it('越界（.. 逃逸）返回 undefined', () => {
    expect(normalizeRelPath(root, '..\\outside.ts')).toBeUndefined()
    expect(normalizeRelPath(root, resolve(root, '..', 'x.ts'))).toBeUndefined()
  })

  it('非法输入返回 undefined（空串/非字符串）', () => {
    expect(normalizeRelPath(root, '')).toBeUndefined()
    expect(normalizeRelPath(root, '   ')).toBeUndefined()
    expect(normalizeRelPath(root, 42)).toBeUndefined()
  })
})

describe('matchMemoryPrefix（段级前缀）', () => {
  it('命中：前缀段与路径前缀一致', () => {
    expect(matchMemoryPrefix('src/engine/a.ts', 'src/engine')).toBe(true)
    expect(matchMemoryPrefix('src/engine/a/b/c.ts', 'src/engine')).toBe(true)
    expect(matchMemoryPrefix('src/engine', 'src/engine')).toBe(true)
  })

  it('不命中：段边界误匹配/前缀更长/非法段', () => {
    expect(matchMemoryPrefix('src/engine2/a.ts', 'src/engine')).toBe(false)
    expect(matchMemoryPrefix('lib/src/engine/a.ts', 'src/engine')).toBe(false)
    expect(matchMemoryPrefix('src/engines/x.ts', 'src/engine')).toBe(false)
    expect(matchMemoryPrefix('src/a.ts', 'src/engine')).toBe(false)
    expect(matchMemoryPrefix('src/engine/a.ts', 'a/../src/engine')).toBe(false)
  })

  it('prefix: / 全局匹配任意路径；空串/undefined 不匹配', () => {
    expect(matchMemoryPrefix('anything/x.ts', '/')).toBe(true)
    expect(matchMemoryPrefix('src/a.ts', '/')).toBe(true)
    expect(matchMemoryPrefix('src/a.ts', '')).toBe(false)
    expect(matchMemoryPrefix('src/a.ts', undefined)).toBe(false)
  })

  it('兼容反斜杠分隔；win32 忽略大小写', () => {
    expect(matchMemoryPrefix('src\\engine\\a.ts', 'src/engine')).toBe(true)
    expect(matchMemoryPrefix('src/engine/a.ts', 'src\\engine')).toBe(true)
    const expected = process.platform === 'win32'
    expect(matchMemoryPrefix('SRC/Engine/a.ts', 'src/engine')).toBe(expected)
  })
})

describe('evalPrefixGroups（&&/|| 求值与 AND 跨读取累计）', () => {
  it('单前缀：命中即触发（旧语义），未命中返回剩余项', () => {
    const groups = [['src/engine']]
    expect(evalPrefixGroups(groups, 'src/engine/a.ts').triggered).toBe(true)
    const miss = evalPrefixGroups(groups, 'src/engine2/a.ts')
    expect(miss.triggered).toBe(false)
    expect(miss.remaining).toEqual([['src/engine']])
  })

  it('|| 任一组命中即触发', () => {
    const groups = [['src/engine'], ['doc/engine']]
    expect(evalPrefixGroups(groups, 'doc/engine/x.md').triggered).toBe(true)
    const miss = evalPrefixGroups(groups, 'src/render/x.ts')
    expect(miss.triggered).toBe(false)
    expect(miss.remaining).toEqual(groups)
  })

  it('&& 跨调用累计：先读 a 不触发，再读 b 集齐触发', () => {
    const groups = [['src/engine', 'doc/editor']]
    const step1 = evalPrefixGroups(groups, 'src/engine/a.ts')
    expect(step1.triggered).toBe(false)
    expect(step1.remaining).toEqual([['doc/editor']])
    expect(evalPrefixGroups(step1.remaining, 'doc/editor/readme.md').triggered).toBe(true)
  })

  it('&& 顺序不限：先读 b 后读 a 同样集齐', () => {
    const step1 = evalPrefixGroups([['src/engine', 'doc/editor']], 'doc/editor/x.md')
    expect(step1.triggered).toBe(false)
    expect(step1.remaining).toEqual([['src/engine']])
    expect(evalPrefixGroups(step1.remaining, 'src/engine/y.ts').triggered).toBe(true)
  })

  it('AND 与 OR 混合：a&&b 集齐 或 c 单独命中都触发', () => {
    const groups = [['a', 'b'], ['c']]
    expect(evalPrefixGroups(groups, 'c/x.ts').triggered).toBe(true)
    const step1 = evalPrefixGroups(groups, 'a/1.ts')
    expect(step1.triggered).toBe(false)
    expect(step1.remaining).toEqual([['b'], ['c']])
    expect(evalPrefixGroups(step1.remaining, 'b/2.ts').triggered).toBe(true)
  })

  it('全链路：parsePrefixExpr 解析表达式后求值；prefix: / 全局任意路径立即触发', () => {
    const parsed = parsePrefixExpr('src/engine && doc/editor || harness')!
    expect(evalPrefixGroups(parsed, 'harness/ds-memory/src/index.ts').triggered).toBe(true)
    const global = parsePrefixExpr('/')!
    expect(evalPrefixGroups(global, 'anywhere/file.txt').triggered).toBe(true)
  })
})

describe('composeAssociateMessage', () => {
  const now = Date.now()
  const base = {
    fileName: 'engine_pitfall.md',
    type: 'project',
    content: '**Problem:** 现象\n**Solution:** 解法',
    mtimeMs: now,
    prefix: 'src/engine',
  }

  it('组出带触发路径与条目标题的消息，含时点警告', () => {
    const { text, included, omitted } = composeAssociateMessage([base], 'src/engine/a.ts', now)
    expect(text).toContain('## 自动联想记忆')
    expect(text).toContain('`src/engine/a.ts`')
    expect(text).toContain('### engine_pitfall.md [project]')
    expect(text).toContain('prefix src/engine')
    expect(text).toContain('**Problem:** 现象')
    expect(text).toContain('记忆是时点观察')
    expect(included).toEqual(['engine_pitfall.md'])
    expect(omitted).toBe(0)
  })

  it('表达式 prefix 原样展示在条目标题中', () => {
    const hit = { ...base, prefix: 'src/engine && doc/editor || harness' }
    const { text } = composeAssociateMessage([hit], 'harness/a.ts', now)
    expect(text).toContain('prefix src/engine && doc/editor || harness')
  })

  it('超过 8000 字符的正文被截断并标注', () => {
    const hit = { ...base, content: 'x'.repeat(9000) }
    const { text } = composeAssociateMessage([hit], 'src/engine/a.ts', now)
    expect(text).toContain('[...内容过长已截断]')
  })

  it('超出总字符预算：只装入新→旧头部条目并报告 omitted', () => {
    const newer = { ...base, fileName: 'newest.md', mtimeMs: now }
    const older = { ...base, fileName: 'older.md', mtimeMs: now - 1000, content: 'z'.repeat(5000) }
    // 预算只够 newer 条目
    const { included, omitted, text } = composeAssociateMessage([newer, older], 'src/engine/a.ts', now, 3000)
    expect(included).toEqual(['newest.md'])
    expect(omitted).toBe(1)
    expect(text).toContain('超出单次注入字符上限未加载')
  })

  it('无可装入条目返回空文本', () => {
    const { text, included } = composeAssociateMessage([], 'src/engine/a.ts', now)
    expect(text).toBe('')
    expect(included).toEqual([])
  })

  it('超过 1 天的记忆带过期标记', () => {
    const stale = { ...base, mtimeMs: now - 3 * 86_400_000 }
    const { text } = composeAssociateMessage([stale], 'src/engine/a.ts', now)
    expect(text).toContain('⚠️ 可能过期')
  })

  it('默认预算常量存在且为正', () => {
    expect(MAX_ASSOCIATE_TOTAL_CHARS).toBeGreaterThan(0)
  })
})

describe('deriveProjectRoot', () => {
  it('<root>/.dsh/memory 形态推导出 <root>', () => {
    const root = resolve(tmpdir(), 'proj-root')
    expect(deriveProjectRoot(join(root, '.dsh', 'memory'))).toBe(root)
  })
  it('非 .dsh/memory 形态返回 undefined', () => {
    const root = resolve(tmpdir(), 'proj-root')
    expect(deriveProjectRoot(join(root, 'memories'))).toBeUndefined()
    expect(deriveProjectRoot(join(root, '.dsh'))).toBeUndefined()
  })
})

describe('prefix 落盘 → 读取 → 扫描全链路', () => {
  it('writeMemory 写入 prefix 行，readAllMemories/scanMemoryFiles 都能读回', async () => {
    const mem = await memoryDirectory()
    await writeMemory(mem, {
      name: 'engine_pitfall',
      content: '**Problem:** 现象',
      type: 'project',
      description: '引擎坑',
      prefix: 'src/engine',
    })
    const text = await readFile(join(mem, 'engine_pitfall.md'), 'utf8')
    expect(text).toContain('prefix: src/engine')
    const records = await readAllMemories(mem)
    expect(records[0]?.prefix).toBe('src/engine')
    const headers = await scanMemoryFiles(mem)
    expect(headers.find(header => header.filename === 'engine_pitfall.md')?.prefix).toBe('src/engine')
  })

  it('同名更新未带 prefix 时保留旧联想键；带新 prefix 时覆盖', async () => {
    const mem = await memoryDirectory()
    await writeMemory(mem, {
      name: 'dup_mem',
      content: 'v1',
      type: 'project',
      description: '描述',
      prefix: 'src/engine',
    })
    // 不带 prefix 更新 → 保留旧 prefix
    await writeMemory(mem, { name: 'dup_mem', content: 'v2', type: 'project', description: '描述' })
    let records = await readAllMemories(mem)
    expect(records.find(record => record.fileName === 'dup_mem.md')?.prefix).toBe('src/engine')
    // 带新 prefix 更新 → 覆盖
    await writeMemory(mem, {
      name: 'dup_mem',
      content: 'v3',
      type: 'project',
      description: '描述',
      prefix: 'harness',
    })
    records = await readAllMemories(mem)
    expect(records.find(record => record.fileName === 'dup_mem.md')?.prefix).toBe('harness')
  })
})
