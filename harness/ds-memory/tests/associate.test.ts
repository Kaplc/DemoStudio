import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { relative, resolve, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  MAX_ASSOCIATE_TOTAL_CHARS,
  buildAssociateSummary,
  composeAssociateMessage,
  deriveProjectRoot,
  matchTriggerFiles,
  normalizeRelPath,
  registerAssociator,
} from '../src/associate.js'
import { parseTriggerFileList } from '../src/memoryTypes.js'
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

describe('matchTriggerFiles（具体文件精确匹配）', () => {
  it('命中：被读路径与列表中任一条目全等', () => {
    expect(matchTriggerFiles('src/engine/a.ts', ['src/engine/a.ts'])).toBe(true)
    expect(matchTriggerFiles('src/engine/a.ts', ['doc/x.md', 'src/engine/a.ts'])).toBe(true)
  })

  it('多文件列表任一命中即触发（OR 语义）', () => {
    const files = ['harness/ds-memory/src/associate.ts', 'doc/engine/render.md']
    expect(matchTriggerFiles('doc/engine/render.md', files)).toBe(true)
    expect(matchTriggerFiles('harness/ds-memory/src/associate.ts', files)).toBe(true)
    expect(matchTriggerFiles('src/other.ts', files)).toBe(false)
  })

  it('目录条目不再命中其下文件（旧目录联想已废弃）', () => {
    expect(matchTriggerFiles('src/engine/a.ts', ['src/engine'])).toBe(false)
    expect(matchTriggerFiles('src/engine/sub/deep.ts', ['src/engine'])).toBe(false)
    expect(matchTriggerFiles('harness/a.ts', ['harness/'])).toBe(false)
  })

  it('不命中：同目录不同文件名/路径形似', () => {
    expect(matchTriggerFiles('src/engine/a.ts', ['src/engine/a.ts.bak'])).toBe(false)
    expect(matchTriggerFiles('src/engine/a.ts', ['src/engine2/a.ts'])).toBe(false)
    expect(matchTriggerFiles('lib/src/engine/a.ts', ['src/engine/a.ts'])).toBe(false)
  })

  it('undefined / 空数组 / 全空条目不匹配', () => {
    expect(matchTriggerFiles('src/engine/a.ts', undefined)).toBe(false)
    expect(matchTriggerFiles('src/engine/a.ts', [])).toBe(false)
    expect(matchTriggerFiles('src/engine/a.ts', ['  '])).toBe(false)
  })

  it('兼容反斜杠分隔（两侧归一）；win32 忽略大小写', () => {
    expect(matchTriggerFiles('src\\engine\\a.ts', ['src/engine/a.ts'])).toBe(true)
    expect(matchTriggerFiles('src/engine/a.ts', ['src\\engine\\a.ts'])).toBe(true)
    const expected = process.platform === 'win32'
    expect(matchTriggerFiles('SRC/Engine/A.TS', ['src/engine/a.ts'])).toBe(expected)
  })

  it('全链路：parseTriggerFileList 解析 frontmatter 值后可匹配', () => {
    const files = parseTriggerFileList('[src/engine/a.ts, doc/engine/b.md]')
    expect(matchTriggerFiles('doc/engine/b.md', files)).toBe(true)
  })
})

describe('composeAssociateMessage', () => {
  const now = Date.now()
  const base = {
    fileName: 'engine_pitfall.md',
    type: 'project',
    content: '**Problem:** 现象\n**Solution:** 解法',
    mtimeMs: now,
    prefix: ['src/engine/a.ts'],
  }

  it('组出带触发路径与条目标题的消息，含时点警告', () => {
    const { text, included, omitted } = composeAssociateMessage([base], 'src/engine/a.ts', now)
    expect(text).toContain('## 自动联想记忆')
    expect(text).toContain('`src/engine/a.ts`')
    expect(text).toContain('### engine_pitfall.md [project]')
    expect(text).toContain('prefix [src/engine/a.ts]')
    expect(text).toContain('**Problem:** 现象')
    expect(text).toContain('记忆是时点观察')
    expect(text).toContain('以下记忆的 prefix 声明了当前读取的文件')
    expect(included).toEqual(['engine_pitfall.md'])
    expect(omitted).toBe(0)
  })

  it('多文件触发列表以逗号拼接展示在条目标题中', () => {
    const hit = { ...base, prefix: ['src/engine/a.ts', 'doc/engine/b.md'] }
    const { text } = composeAssociateMessage([hit], 'src/engine/a.ts', now)
    expect(text).toContain('prefix [src/engine/a.ts, doc/engine/b.md]')
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

describe('buildAssociateSummary（注入卡片摘要：条数 + 逐行文件名）', () => {
  it('首行条数，随后每行一个实际装入的记忆文件名', () => {
    expect(buildAssociateSummary(['engine_pitfall.md', 'ui_no_icon.md'], 0))
      .toBe('自动联想记忆 2 条\nengine_pitfall.md\nui_no_icon.md')
  })

  it('超预算截断时首行附 omitted 数', () => {
    expect(buildAssociateSummary(['newest.md'], 2))
      .toBe('自动联想记忆 1 条（另有 2 条超出预算未加载）\nnewest.md')
  })

  it('空装入列表返回仅条数行', () => {
    expect(buildAssociateSummary([], 0)).toBe('自动联想记忆 0 条')
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

describe('prefix 文件列表落盘 → 读取 → 扫描全链路', () => {
  it('writeMemory 写入 prefix 数组行，readAllMemories/scanMemoryFiles 都能读回', async () => {
    const mem = await memoryDirectory()
    await writeMemory(mem, {
      name: 'engine_pitfall',
      content: '**Problem:** 现象',
      type: 'project',
      description: '引擎坑',
      prefix: ['src/engine/a.ts', 'doc/engine/b.md'],
    })
    const text = await readFile(join(mem, 'engine_pitfall.md'), 'utf8')
    expect(text).toContain('prefix: [src/engine/a.ts, doc/engine/b.md]')
    const records = await readAllMemories(mem)
    expect(records[0]?.prefix).toEqual(['src/engine/a.ts', 'doc/engine/b.md'])
    const headers = await scanMemoryFiles(mem)
    expect(headers.find(header => header.filename === 'engine_pitfall.md')?.prefix)
      .toEqual(['src/engine/a.ts', 'doc/engine/b.md'])
  })

  it('同名更新未带 prefix 时保留旧联想键；带新 prefix 时覆盖', async () => {
    const mem = await memoryDirectory()
    await writeMemory(mem, {
      name: 'dup_mem',
      content: 'v1',
      type: 'project',
      description: '描述',
      prefix: ['src/engine/a.ts'],
    })
    // 不带 prefix 更新 → 保留旧 prefix
    await writeMemory(mem, { name: 'dup_mem', content: 'v2', type: 'project', description: '描述' })
    let records = await readAllMemories(mem)
    expect(records.find(record => record.fileName === 'dup_mem.md')?.prefix).toEqual(['src/engine/a.ts'])
    // 带新 prefix 更新 → 覆盖
    await writeMemory(mem, {
      name: 'dup_mem',
      content: 'v3',
      type: 'project',
      description: '描述',
      prefix: ['harness/ds-memory/src/tools.ts'],
    })
    records = await readAllMemories(mem)
    expect(records.find(record => record.fileName === 'dup_mem.md')?.prefix)
      .toEqual(['harness/ds-memory/src/tools.ts'])
  })
})

// ---------------------------------------------------------------------------
// registerAssociator 集成：登记 → 结果确认 → 精确匹配 → pre-step 注入
// ---------------------------------------------------------------------------

type AnyHandler = (...args: never[]) => unknown

function fakeCtx() {
  const handlers = new Map<string, AnyHandler[]>()
  const warns: unknown[][] = []
  const ctx = {
    on(event: string, handler: AnyHandler) {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
    },
    logger(name: string) {
      void name
      return {
        warn: (...args: unknown[]) => warns.push(args),
        info: (...args: unknown[]) => warns.push(args),
        debug: () => {},
      }
    },
  } as unknown as Context
  return { ctx, handlers, warns }
}

/** 走一遍"读文件"事件序列：pre-execute 登记 → result 确认成功（异步匹配落定）。 */
async function readAs(
  handlers: Map<string, AnyHandler[]>,
  agent: unknown,
  token: string,
  filePath: string,
): Promise<void> {
  const exec = { token, name: 'read', arguments: { file_path: filePath }, agent, parent: undefined, signal: { aborted: false } }
  await handlers.get('tools/pre-execute')![0](exec as never, async () => ({}) as never)
  handlers.get('tools/result')![0](exec as never, { isError: false } as never)
  // projectHits 是 fire-and-forget 异步链（扫描记忆目录→匹配），并行负载下 10ms 不够，放宽等待
  await new Promise(resolve => setTimeout(resolve, 50))
}

async function preStep(
  handlers: Map<string, AnyHandler[]>,
  agent: unknown,
  step: number,
): Promise<{ messages: unknown[] }> {
  const decision = { kind: 'continue', messages: [{ role: 'user' }] }
  let value: unknown
  await handlers.get('agent/pre-step')![0]({ agent, step, signal: undefined } as never, async () => decision as never)
    .then((v: unknown) => { value = v })
  return value as { messages: unknown[] }
}

describe('registerAssociator 集成', () => {
  it('读到 prefix 列表中的文件 → pre-step 注入记忆全文，同会话不重复', async () => {
    const root = await memoryDirectory()
    const memoryDir = join(root, '.dsh', 'memory')
    await writeMemory(memoryDir, {
      name: 'assoc_hit', content: '命中的记忆正文', type: 'project', description: '联想命中',
      prefix: ['src/a.ts'],
    })
    const { ctx, handlers } = fakeCtx()
    registerAssociator(ctx, { memoryDirectory: memoryDir, projectRoot: root })

    const agent = { session: { header: {} } }
    await readAs(handlers, agent, 't1', 'src/a.ts')
    const first = await preStep(handlers, agent, 2)
    expect(first.messages).toHaveLength(2)
    const text = JSON.stringify(first.messages[1])
    expect(text).toContain('自动联想记忆')
    expect(text).toContain('assoc_hit.md')
    expect(text).toContain('命中的记忆正文')

    // 再次读取同文件：本会话已注入，不再追加消息
    await readAs(handlers, agent, 't2', 'src/a.ts')
    const second = await preStep(handlers, agent, 3)
    expect(second.messages).toHaveLength(1)
  })

  it('读列表外的文件 / 未声明 prefix 的记忆不触发；多文件列表任一命中触发', async () => {
    const root = await memoryDirectory()
    const memoryDir = join(root, '.dsh', 'memory')
    await writeMemory(memoryDir, {
      name: 'multi_hit', content: '多文件联想', type: 'project', description: 'd',
      prefix: ['src/x.ts', 'src/y.ts'],
    })
    await writeMemory(memoryDir, {
      name: 'no_prefix', content: '无联想', type: 'project', description: 'd2',
    })
    const { ctx, handlers } = fakeCtx()
    registerAssociator(ctx, { memoryDirectory: memoryDir, projectRoot: root })

    const agent = { session: { header: {} } }
    // 列表外的文件（即使是同目录）不触发
    await readAs(handlers, agent, 'm1', 'src/z.ts')
    const miss = await preStep(handlers, agent, 2)
    expect(miss.messages).toHaveLength(1)
    // 列表内第二个文件命中
    await readAs(handlers, agent, 'm2', 'src/y.ts')
    const hit = await preStep(handlers, agent, 3)
    expect(hit.messages).toHaveLength(2)
    expect(JSON.stringify(hit.messages[1])).toContain('multi_hit.md')
  })

  it('子 agent / 失败结果 / 未跟踪工具不触发注入', async () => {
    const root = await memoryDirectory()
    const memoryDir = join(root, '.dsh', 'memory')
    await writeMemory(memoryDir, {
      name: 'gated', content: '正文', type: 'project', description: 'd', prefix: ['src/a.ts'],
    })
    const { ctx, handlers } = fakeCtx()
    registerAssociator(ctx, { memoryDirectory: memoryDir, projectRoot: root })

    // 子 agent（delegationDepth>0）
    const childAgent = { session: { header: { delegationDepth: 1 } } }
    await readAs(handlers, childAgent, 'c1', 'src/a.ts')
    const child = await preStep(handlers, childAgent, 2)
    expect(child.messages).toHaveLength(1)

    // 失败结果不登记
    const mainAgent = { session: { header: {} } }
    const exec = { token: 'f1', name: 'read', arguments: { file_path: 'src/a.ts' }, agent: mainAgent, parent: undefined, signal: { aborted: false } }
    await handlers.get('tools/pre-execute')![0](exec as never, async () => ({}) as never)
    handlers.get('tools/result')![0](exec as never, { isError: true } as never)
    await new Promise(resolve => setTimeout(resolve, 50))
    const failed = await preStep(handlers, mainAgent, 2)
    expect(failed.messages).toHaveLength(1)

    // 未跟踪工具（write）不登记
    const writeExec = { token: 'w1', name: 'write', arguments: { file_path: 'src/a.ts' }, agent: mainAgent, parent: undefined, signal: { aborted: false } }
    await handlers.get('tools/pre-execute')![0](writeExec as never, async () => ({}) as never)
    handlers.get('tools/result')![0](writeExec as never, { isError: false } as never)
    await new Promise(resolve => setTimeout(resolve, 50))
    const untracked = await preStep(handlers, mainAgent, 3)
    expect(untracked.messages).toHaveLength(1)
  })
})
