import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  MAX_ASSOCIATE_TOTAL_CHARS,
  composeExperienceAssociateMessage,
  deriveExperienceProjectRoot,
  evalPrefixGroups,
  matchExperiencePrefix,
  normalizeRelPath,
  registerExperienceAssociator,
} from '../src/associate.js'
import { parsePrefixExpr, renderEpisodeFile } from '../src/experienceTypes.js'
import { saveExperience } from '../src/experienceStore.js'

const createdDirs: string[] = []
async function tempDir(tag: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `ds-experience-assoc-${tag}-`))
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

describe('matchExperiencePrefix（段级前缀）', () => {
  it('命中：前缀段与路径前缀一致', () => {
    expect(matchExperiencePrefix('src/engine/a.ts', 'src/engine')).toBe(true)
    expect(matchExperiencePrefix('src/engine/a/b/c.ts', 'src/engine')).toBe(true)
    expect(matchExperiencePrefix('src/engine', 'src/engine')).toBe(true)
  })

  it('不命中：段边界误匹配/前缀更长/非法段', () => {
    expect(matchExperiencePrefix('src/engine2/a.ts', 'src/engine')).toBe(false)
    expect(matchExperiencePrefix('lib/src/engine/a.ts', 'src/engine')).toBe(false)
    expect(matchExperiencePrefix('src/engines/x.ts', 'src/engine')).toBe(false)
    expect(matchExperiencePrefix('src/a.ts', 'src/engine')).toBe(false)
    expect(matchExperiencePrefix('src/engine/a.ts', 'a/../src/engine')).toBe(false)
  })

  it('prefix: / 全局匹配任意路径；空串/undefined 不匹配', () => {
    expect(matchExperiencePrefix('anything/x.ts', '/')).toBe(true)
    expect(matchExperiencePrefix('src/a.ts', '/')).toBe(true)
    expect(matchExperiencePrefix('src/a.ts', '')).toBe(false)
    expect(matchExperiencePrefix('src/a.ts', undefined)).toBe(false)
  })

  it('兼容反斜杠分隔；win32 忽略大小写', () => {
    expect(matchExperiencePrefix('src\\engine\\a.ts', 'src/engine')).toBe(true)
    expect(matchExperiencePrefix('src/engine/a.ts', 'src\\engine')).toBe(true)
    const expected = process.platform === 'win32'
    expect(matchExperiencePrefix('SRC/Engine/a.ts', 'src/engine')).toBe(expected)
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
    const step2 = evalPrefixGroups(step1.remaining, 'b/2.ts')
    expect(step2.triggered).toBe(true)
  })
})

describe('parsePrefixExpr（frontmatter 表达式解析）', () => {
  it('单值/||/&&/混用按 DNF 解析；空值 undefined', () => {
    expect(parsePrefixExpr('harness')).toEqual([['harness']])
    expect(parsePrefixExpr('a || b')).toEqual([['a'], ['b']])
    expect(parsePrefixExpr('a && b')).toEqual([['a', 'b']])
    expect(parsePrefixExpr('a && b || c')).toEqual([['a', 'b'], ['c']])
    expect(parsePrefixExpr('  ')).toBeUndefined()
    expect(parsePrefixExpr('||')).toBeUndefined()
  })
})

describe('composeExperienceAssociateMessage', () => {
  const hits = [
    { fileName: 'exp_one.md', taskType: 'feature', outcome: 'success', date: '2026-09-09', prefix: 'src/engine', content: '## Summary\n\ns\n\n## Lessons\n\nl' },
    { fileName: 'exp_two.md', taskType: 'debug', outcome: 'partial', content: '短正文' },
  ]

  it('组装标题/标签/页脚；omitted 计入预算外条数', () => {
    const composed = composeExperienceAssociateMessage(hits, 'src/engine/a.ts', MAX_ASSOCIATE_TOTAL_CHARS)
    expect(composed.included).toEqual(['exp_one.md', 'exp_two.md'])
    expect(composed.omitted).toBe(0)
    expect(composed.text).toContain('## 自动联想经验（读取 `src/engine/a.ts` 触发）')
    expect(composed.text).toContain('### exp_one.md [feature/success]（2026-09-09 · prefix src/engine）')
    expect(composed.text).toContain('### exp_two.md [debug/partial]')
    expect(composed.text).toContain('experience_save 覆盖更新')
  })

  it('总预算超限时跳过并提示 omitted', () => {
    const composed = composeExperienceAssociateMessage(hits, 'x.ts', 10)
    expect(composed.included).toEqual([])
    expect(composed.omitted).toBe(2)
    expect(composed.text).toBe('')
  })

  it('部分装入：预算内的装入，预算外的计入 omitted 并在文本提示', () => {
    const big = { fileName: 'big.md', content: 'x'.repeat(5000) }
    const composed = composeExperienceAssociateMessage([hits[0]!, big], 'x.ts', 1000)
    expect(composed.included).toEqual(['exp_one.md'])
    expect(composed.omitted).toBe(1)
    expect(composed.text).toContain('其余 1 条匹配经验超出单次注入字符上限')
  })
})

describe('deriveExperienceProjectRoot', () => {
  it('<root>/.dsh/experience 形态推导项目根', () => {
    expect(deriveExperienceProjectRoot('E:/DemoStudio/.dsh/experience')).toBe(resolve('E:/DemoStudio'))
  })
  it('相对形态 .dsh/experience 按 cwd 解析后同样命中', () => {
    expect(deriveExperienceProjectRoot('.dsh/experience')).toBe(resolve(process.cwd(), '.dsh', 'experience', '..', '..'))
  })
  it('非标准形态返回 undefined', () => {
    expect(deriveExperienceProjectRoot('E:/some/other/dir')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// registerExperienceAssociator 集成：登记 → 结果确认 → pre-step 注入
// ---------------------------------------------------------------------------

type AnyHandler = (...args: never[]) => unknown

function fakeCtx() {
  const handlers = new Map<string, AnyHandler[]>()
  const warns: unknown[][] = []
  const infos: unknown[][] = []
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
        info: (...args: unknown[]) => infos.push(args),
        debug: () => {},
      }
    },
  } as unknown as Context
  return { ctx, handlers, warns, infos }
}

describe('registerExperienceAssociator 集成', () => {
  it('读到满足 prefix 的文件 → pre-step 注入经验全文，同会话不重复', async () => {
    const root = await tempDir('int')
    const experienceDirectory = join(root, '.dsh', 'experience')
    await saveExperience(experienceDirectory, {
      name: 'assoc_hit', taskType: 'feature', outcome: 'success',
      summary: '联想命中经验', lessons: '坑 A', prefix: 'src',
    })
    const { ctx, handlers } = fakeCtx()
    registerExperienceAssociator(ctx, { experienceDirectory, projectRoot: root })

    const agent = { session: { header: {} } }
    const exec = {
      token: 't1', name: 'read', arguments: { file_path: 'src/a.ts' },
      agent, parent: undefined, signal: { aborted: false },
    }
    // pre-execute 登记
    await handlers.get('tools/pre-execute')![0](exec as never, async () => ({}) as never)
    // result 确认成功 → 异步 projectHits
    handlers.get('tools/result')![0](exec as never, { isError: false } as never)
    await new Promise(resolve => setTimeout(resolve, 10))

    // pre-step 注入
    const decision = { kind: 'continue', messages: [{ role: 'user' }] } as never
    let result: unknown
    await handlers.get('agent/pre-step')![0]({ agent, step: 2, signal: undefined } as never, async () => decision)
      .then((value: unknown) => { result = value })
    const messages = (result as { messages: Array<{ content: Array<{ text: string }> }> }).messages
    expect(messages).toHaveLength(2)
    const text = JSON.stringify(messages[1])
    expect(text).toContain('自动联想经验')
    expect(text).toContain('assoc_hit.md')
    expect(text).toContain('坑 A')

    // 第二次读取同前缀：本会话已注入，不再追加消息
    await handlers.get('tools/pre-execute')![0](
      { ...exec, token: 't2' } as never,
      async () => ({}) as never,
    )
    handlers.get('tools/result')![0]({ ...exec, token: 't2' } as never, { isError: false } as never)
    await new Promise(resolve => setTimeout(resolve, 10))
    let second: unknown
    await handlers.get('agent/pre-step')![0]({ agent, step: 3, signal: undefined } as never, async () => decision)
      .then((value: unknown) => { second = value })
    expect((second as { messages: unknown[] }).messages).toHaveLength(1)
  })

  it('子 agent / 失败结果 / 未跟踪工具不触发注入', async () => {
    const root = await tempDir('gate')
    const experienceDirectory = join(root, '.dsh', 'experience')
    await saveExperience(experienceDirectory, {
      name: 'gated', taskType: 'debug', outcome: 'failure',
      summary: 's', lessons: 'l', prefix: 'src',
    })
    const { ctx, handlers } = fakeCtx()
    registerExperienceAssociator(ctx, { experienceDirectory, projectRoot: root })

    const childAgent = { session: { header: { delegationDepth: 1 } } }
    const childExec = {
      token: 'c1', name: 'read', arguments: { file_path: 'src/a.ts' },
      agent: childAgent, parent: undefined, signal: { aborted: false },
    }
    await handlers.get('tools/pre-execute')![0](childExec as never, async () => ({}) as never)
    handlers.get('tools/result')![0](childExec as never, { isError: false } as never)
    await new Promise(resolve => setTimeout(resolve, 10))
    const decision = { kind: 'continue', messages: [{ role: 'user' }] } as never
    let childResult: unknown
    await handlers.get('agent/pre-step')![0]({ agent: childAgent, step: 2, signal: undefined } as never, async () => decision)
      .then((value: unknown) => { childResult = value })
    expect((childResult as { messages: unknown[] }).messages).toHaveLength(1)

    // 失败结果：不登记
    const mainAgent = { session: { header: {} } }
    const failExec = {
      token: 'f1', name: 'read', arguments: { file_path: 'src/a.ts' },
      agent: mainAgent, parent: undefined, signal: { aborted: false },
    }
    await handlers.get('tools/pre-execute')![0](failExec as never, async () => ({}) as never)
    handlers.get('tools/result')![0](failExec as never, { isError: true } as never)
    await new Promise(resolve => setTimeout(resolve, 10))
    let failResult: unknown
    await handlers.get('agent/pre-step')![0]({ agent: mainAgent, step: 2, signal: undefined } as never, async () => decision)
      .then((value: unknown) => { failResult = value })
    expect((failResult as { messages: unknown[] }).messages).toHaveLength(1)
  })

  it('AND 前缀跨读取累计：集齐两个路径才注入', async () => {
    const root = await tempDir('and')
    const experienceDirectory = join(root, '.dsh', 'experience')
    await saveExperience(experienceDirectory, {
      name: 'and_exp', taskType: 'feature', outcome: 'success',
      summary: 's', lessons: 'l', prefix: 'src && doc',
    })
    const { ctx, handlers } = fakeCtx()
    registerExperienceAssociator(ctx, { experienceDirectory, projectRoot: root })
    const agent = { session: { header: {} } }
    const decision = { kind: 'continue', messages: [{ role: 'user' }] } as never
    const read = async (token: string, path: string): Promise<void> => {
      const exec = { token, name: 'read', arguments: { file_path: path }, agent, parent: undefined, signal: { aborted: false } }
      await handlers.get('tools/pre-execute')![0](exec as never, async () => ({}) as never)
      handlers.get('tools/result')![0](exec as never, { isError: false } as never)
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    const preStep = async (step: number): Promise<unknown> => {
      let value: unknown
      await handlers.get('agent/pre-step')![0]({ agent, step, signal: undefined } as never, async () => decision)
        .then((v: unknown) => { value = v })
      return value
    }
    await read('r1', 'src/a.ts')
    const step1 = await preStep(2) as { messages: unknown[] }
    expect(step1.messages).toHaveLength(1) // 只集齐 src，不注入
    await read('r2', 'doc/b.md')
    const step2 = await preStep(3) as { messages: unknown[] }
    expect(step2.messages).toHaveLength(2) // 集齐 → 注入
    expect(JSON.stringify(step2.messages[1])).toContain('and_exp.md')
  })
})

describe('renderEpisodeFile + prefix 往返', () => {
  it('render 带 prefix 行，parsePrefixExpr 可解析', () => {
    const file = renderEpisodeFile({
      name: 'x', taskType: 'feature', outcome: 'success',
      summary: 's', lessons: 'l', prefix: 'a || b',
    }, '2026-09-09')
    expect(file).toContain('prefix: a || b')
    expect(parsePrefixExpr('a || b')).toEqual([['a'], ['b']])
  })
})
