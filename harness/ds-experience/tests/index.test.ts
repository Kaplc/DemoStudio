import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.js'

let dir: string
let nestedDir: string // <root>/.dsh/experience 形态（联想项目根可推导）

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ds-experience-index-'))
  nestedDir = join(dir, '.dsh', 'experience')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

type AnyHandler = (...args: never[]) => unknown

interface TestSetup {
  ctx: Context
  sections: Array<{ name: string; order: number; text: () => string | undefined }>
  registeredTools: string[]
  handlers: Map<string, AnyHandler[]>
  warns: unknown[][]
}

function fakeCtx(): TestSetup {
  const sections: TestSetup['sections'] = []
  const registeredTools: string[] = []
  const handlers = new Map<string, AnyHandler[]>()
  const warns: unknown[][] = []
  const ctx = {
    systemPrompt: {
      section(section: { name: string; order: number; text: () => string | undefined }) {
        sections.push(section)
      },
    },
    tools: {
      register(tool: { name: string }) {
        registeredTools.push(tool.name)
      },
    },
    sessionQuery: {},
    on(event: string, handler: AnyHandler) {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
    },
    logger(name: string) {
      void name
      return {
        warn: (...args: unknown[]) => warns.push(args),
        info: () => {},
        debug: () => {},
      }
    },
  } as unknown as Context
  return { ctx, sections, registeredTools, handlers, warns }
}

describe('apply 注册冒烟', () => {
  it('注册 1 个指导段 + 4 个工具', () => {
    const setup = fakeCtx()
    apply(setup.ctx, { experienceDir: dir })
    expect(setup.sections).toHaveLength(1)
    expect(setup.sections[0]!.name).toBe('experience:guide')
    expect(setup.registeredTools.sort()).toEqual([
      'experience_save', 'experience_search', 'history_read', 'history_search',
    ])
  })

  it('enabled: false — 什么都不注册', () => {
    const setup = fakeCtx()
    apply(setup.ctx, { enabled: false, experienceDir: dir })
    expect(setup.sections).toHaveLength(0)
    expect(setup.registeredTools).toHaveLength(0)
    expect(setup.handlers.size).toBe(0)
  })
})

describe('回合末提醒移交', () => {
  it('2026-09-13 起回合末提醒移交 @demostudio/ds-reminder：本插件不再注册 session/event 提醒监听', () => {
    const setup = fakeCtx()
    apply(setup.ctx, { experienceDir: dir })
    expect(setup.handlers.get('session/event')).toBeUndefined()
    expect(setup.handlers.get('agent/created')).toBeUndefined()
    expect(setup.handlers.get('agent/status')).toBeUndefined()
  })
})

describe('prefix 自动联想装配', () => {
  it('<root>/.dsh/experience 形态启用联想（注册 tools/pre-execute 等监听）', () => {
    const setup = fakeCtx()
    apply(setup.ctx, { experienceDir: nestedDir })
    expect(setup.handlers.get('tools/pre-execute')).toHaveLength(1)
    // tools/result、agent/pre-step 各 1 个：全部来自联想器（回合末提醒的跳过判定已随提醒移交 ds-reminder）
    expect(setup.handlers.get('tools/result')).toHaveLength(1)
    expect(setup.handlers.get('agent/pre-step')).toHaveLength(1)
  })

  it('非标准目录形态：联想停用并 warn，不抛出', () => {
    const setup = fakeCtx()
    apply(setup.ctx, { experienceDir: join(dir, 'somewhere-else') })
    expect(setup.handlers.get('tools/pre-execute')).toBeUndefined()
    expect(setup.warns.length).toBeGreaterThan(0)
  })

  it('enableAutoAssociate: false — 不注册联想监听', () => {
    const setup = fakeCtx()
    apply(setup.ctx, { experienceDir: nestedDir, enableAutoAssociate: false })
    expect(setup.handlers.get('tools/pre-execute')).toBeUndefined()
  })
})
