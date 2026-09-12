import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  MAX_ASSOCIATE_TOTAL_CHARS,
  buildAssociateSummary,
  composeExperienceAssociateMessage,
  deriveExperienceProjectRoot,
  matchTriggerFiles,
  normalizeRelPath,
  registerExperienceAssociator,
} from '../src/associate.js'
import { parseTriggerFileList, renderEpisodeFile } from '../src/experienceTypes.js'
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

describe('matchTriggerFiles（具体文件精确匹配）', () => {
  it('命中：被读路径与列表中任一条目全等', () => {
    expect(matchTriggerFiles('src/engine/a.ts', ['src/engine/a.ts'])).toBe(true)
    expect(matchTriggerFiles('src/engine/a.ts', ['doc/x.md', 'src/engine/a.ts'])).toBe(true)
  })

  it('多文件列表任一命中即触发（OR 语义）', () => {
    const files = ['harness/ds-experience/src/associate.ts', 'doc/engine/render.md']
    expect(matchTriggerFiles('doc/engine/render.md', files)).toBe(true)
    expect(matchTriggerFiles('harness/ds-experience/src/associate.ts', files)).toBe(true)
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

describe('parseTriggerFileList（frontmatter 触发文件列表解析）', () => {
  it('方括号数组/裸单文件/引号写法按数组解析；空值 undefined', () => {
    expect(parseTriggerFileList('[a.ts, b.md]')).toEqual(['a.ts', 'b.md'])
    expect(parseTriggerFileList('a.ts')).toEqual(['a.ts'])
    expect(parseTriggerFileList(`'a.ts'`)).toEqual(['a.ts'])
    expect(parseTriggerFileList('  ')).toBeUndefined()
    expect(parseTriggerFileList('[]')).toBeUndefined()
  })
})

describe('composeExperienceAssociateMessage', () => {
  const hits = [
    { fileName: 'exp_one.md', taskType: 'feature', outcome: 'success', date: '2026-09-09', prefix: ['src/engine/a.ts'], content: '## Summary\n\ns\n\n## Lessons\n\nl' },
    { fileName: 'exp_two.md', taskType: 'debug', outcome: 'partial', content: '短正文' },
  ]

  it('组装标题/标签/页脚；omitted 计入预算外条数', () => {
    const composed = composeExperienceAssociateMessage(hits, 'src/engine/a.ts', MAX_ASSOCIATE_TOTAL_CHARS)
    expect(composed.included).toEqual(['exp_one.md', 'exp_two.md'])
    expect(composed.omitted).toBe(0)
    expect(composed.text).toContain('## 自动联想经验（读取 `src/engine/a.ts` 触发）')
    expect(composed.text).toContain('### exp_one.md [feature/success]（2026-09-09 · prefix [src/engine/a.ts]）')
    expect(composed.text).toContain('### exp_two.md [debug/partial]')
    expect(composed.text).toContain('experience_save 覆盖更新')
    expect(composed.text).toContain('以下经验的 prefix 声明了当前读取的文件')
  })

  it('多文件触发列表以逗号拼接展示', () => {
    const hit = { ...hits[0]!, prefix: ['src/engine/a.ts', 'doc/engine/b.md'] }
    const composed = composeExperienceAssociateMessage([hit], 'src/engine/a.ts', MAX_ASSOCIATE_TOTAL_CHARS)
    expect(composed.text).toContain('prefix [src/engine/a.ts, doc/engine/b.md]')
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

describe('buildAssociateSummary（注入卡片摘要：条数 + 逐行文件名）', () => {
  it('首行条数，随后每行一个实际装入的经验文件名', () => {
    expect(buildAssociateSummary(['fix_junction_mount.md', 'scan_assets.md'], 0))
      .toBe('自动联想经验 2 条\nfix_junction_mount.md\nscan_assets.md')
  })

  it('超预算截断时首行附 omitted 数', () => {
    expect(buildAssociateSummary(['newest.md'], 2))
      .toBe('自动联想经验 1 条（另有 2 条超出预算未加载）\nnewest.md')
  })

  it('空装入列表返回仅条数行', () => {
    expect(buildAssociateSummary([], 0)).toBe('自动联想经验 0 条')
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
// registerExperienceAssociator 集成：登记 → 结果确认 → 精确匹配 → pre-step 注入
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
  // projectHits 是 fire-and-forget 异步链（扫描经验目录→匹配），并行负载下 10ms 不够，放宽等待
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

describe('registerExperienceAssociator 集成', () => {
  it('读到 prefix 列表中的文件 → pre-step 注入经验全文，同会话不重复', async () => {
    const root = await tempDir('int')
    const experienceDirectory = join(root, '.dsh', 'experience')
    await saveExperience(experienceDirectory, {
      name: 'assoc_hit', taskType: 'feature', outcome: 'success',
      summary: '联想命中经验', lessons: '坑 A', prefix: ['src/a.ts'],
    })
    const { ctx, handlers } = fakeCtx()
    registerExperienceAssociator(ctx, { experienceDirectory, projectRoot: root })

    const agent = { session: { header: {} } }
    await readAs(handlers, agent, 't1', 'src/a.ts')
    const first = await preStep(handlers, agent, 2)
    expect(first.messages).toHaveLength(2)
    const text = JSON.stringify(first.messages[1])
    expect(text).toContain('自动联想经验')
    expect(text).toContain('assoc_hit.md')
    expect(text).toContain('坑 A')

    // 第二次读取同文件：本会话已注入，不再追加消息
    await readAs(handlers, agent, 't2', 'src/a.ts')
    const second = await preStep(handlers, agent, 3)
    expect(second.messages).toHaveLength(1)
  })

  it('列表外文件不触发；多文件列表任一命中触发；未声明 prefix 的经验不参与', async () => {
    const root = await tempDir('multi')
    const experienceDirectory = join(root, '.dsh', 'experience')
    await saveExperience(experienceDirectory, {
      name: 'multi_hit', taskType: 'feature', outcome: 'success',
      summary: 's', lessons: 'l', prefix: ['src/x.ts', 'src/y.ts'],
    })
    await saveExperience(experienceDirectory, {
      name: 'no_prefix', taskType: 'debug', outcome: 'failure',
      summary: 's2', lessons: 'l2',
    })
    const { ctx, handlers } = fakeCtx()
    registerExperienceAssociator(ctx, { experienceDirectory, projectRoot: root })

    const agent = { session: { header: {} } }
    await readAs(handlers, agent, 'm1', 'src/z.ts')
    const miss = await preStep(handlers, agent, 2)
    expect(miss.messages).toHaveLength(1)
    await readAs(handlers, agent, 'm2', 'src/y.ts')
    const hit = await preStep(handlers, agent, 3)
    expect(hit.messages).toHaveLength(2)
    expect(JSON.stringify(hit.messages[1])).toContain('multi_hit.md')
    expect(JSON.stringify(hit.messages[1])).not.toContain('no_prefix.md')
  })

  it('子 agent / 失败结果 / 未跟踪工具不触发注入', async () => {
    const root = await tempDir('gate')
    const experienceDirectory = join(root, '.dsh', 'experience')
    await saveExperience(experienceDirectory, {
      name: 'gated', taskType: 'debug', outcome: 'failure',
      summary: 's', lessons: 'l', prefix: ['src/a.ts'],
    })
    const { ctx, handlers } = fakeCtx()
    registerExperienceAssociator(ctx, { experienceDirectory, projectRoot: root })

    const childAgent = { session: { header: { delegationDepth: 1 } } }
    await readAs(handlers, childAgent, 'c1', 'src/a.ts')
    const child = await preStep(handlers, childAgent, 2)
    expect(child.messages).toHaveLength(1)

    const mainAgent = { session: { header: {} } }
    const exec = { token: 'f1', name: 'read', arguments: { file_path: 'src/a.ts' }, agent: mainAgent, parent: undefined, signal: { aborted: false } }
    await handlers.get('tools/pre-execute')![0](exec as never, async () => ({}) as never)
    handlers.get('tools/result')![0](exec as never, { isError: true } as never)
    await new Promise(resolve => setTimeout(resolve, 50))
    const failed = await preStep(handlers, mainAgent, 2)
    expect(failed.messages).toHaveLength(1)

    const writeExec = { token: 'w1', name: 'write', arguments: { file_path: 'src/a.ts' }, agent: mainAgent, parent: undefined, signal: { aborted: false } }
    await handlers.get('tools/pre-execute')![0](writeExec as never, async () => ({}) as never)
    handlers.get('tools/result')![0](writeExec as never, { isError: false } as never)
    await new Promise(resolve => setTimeout(resolve, 50))
    const untracked = await preStep(handlers, mainAgent, 3)
    expect(untracked.messages).toHaveLength(1)
  })
})

describe('renderEpisodeFile + prefix 往返', () => {
  it('render 带方括号数组 prefix 行，parseTriggerFileList 可解析回', () => {
    const file = renderEpisodeFile({
      name: 'x', taskType: 'feature', outcome: 'success',
      summary: 's', lessons: 'l', prefix: ['a.ts', 'b.md'],
    }, '2026-09-09')
    expect(file).toContain('prefix: [a.ts, b.md]')
    expect(parseTriggerFileList('[a.ts, b.md]')).toEqual(['a.ts', 'b.md'])
  })

  it('prefix 空数组不写 prefix 行', () => {
    const file = renderEpisodeFile({
      name: 'x', taskType: 'feature', outcome: 'success',
      summary: 's', lessons: 'l', prefix: [],
    }, '2026-09-09')
    expect(file).not.toContain('prefix:')
  })
})
