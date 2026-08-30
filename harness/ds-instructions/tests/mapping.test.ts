/**
 * §14.1 路径映射与配置单元测试：默认映射、最长前缀、段级边界、
 * 相对/绝对/反斜杠路径、越界拒绝、大小写平台规则。
 */
import { describe, expect, it } from 'vitest'
import { bindRootConfig, resolveConfig, DEFAULT_MAPPINGS } from '../src/config.js'
import { instructionPaths, normalizeTouchedPath, resolveTouch } from '../src/mapping.js'

const win32 = process.platform === 'win32'

function boundRoot(root: string) {
  const resolved = bindRootConfig(resolveConfig({ projectRoot: root }), root)
  expect(resolved).toBeDefined()
  return resolved!
}

describe('默认映射（§5.1）', () => {
  it('src/engine/X.ts 命中 engine.instructions.md', () => {
    const resolved = boundRoot('E:/DemoStudio')
    const touch = resolveTouch('E:/DemoStudio', 'E:/DemoStudio/src/engine/Entity.ts', resolved)
    expect(touch?.instructionFile).toBe('engine.instructions.md')
  })

  it('src/projects/snake/X.ts 命中 project.instructions.md', () => {
    const resolved = boundRoot('E:/DemoStudio')
    const touch = resolveTouch('E:/DemoStudio', 'src/projects/snake/SnakePawn.ts', resolved)
    expect(touch?.instructionFile).toBe('project.instructions.md')
  })

  it('src/engine2/X.ts 不匹配 engine（段级边界，非 includes）', () => {
    const resolved = boundRoot('E:/DemoStudio')
    expect(resolveTouch('E:/DemoStudio', 'src/engine2/a.ts', resolved)).toBeUndefined()
  })

  it('src/engineFoo/bar.ts 不匹配；src/engine/bar.ts 匹配', () => {
    const resolved = boundRoot('E:/DemoStudio')
    expect(resolveTouch('E:/DemoStudio', 'src/engineFoo/bar.ts', resolved)).toBeUndefined()
    expect(resolveTouch('E:/DemoStudio', 'src/engine/bar.ts', resolved)).toBeDefined()
  })

  it('目录前缀本身（src/engine）也命中', () => {
    const resolved = boundRoot('E:/DemoStudio')
    expect(resolveTouch('E:/DemoStudio', 'src/engine', resolved)).toBeDefined()
  })

  it('不相关的路径不匹配', () => {
    const resolved = boundRoot('E:/DemoStudio')
    expect(resolveTouch('E:/DemoStudio', 'docs/readme.md', resolved)).toBeUndefined()
    expect(resolveTouch('E:/DemoStudio', 'test/src/engine/x.ts', resolved)).toBeUndefined()
  })
})

describe('全局前缀 prefix: /（匹配项目根下所有路径）', () => {
  it('任意路径都命中全局指令，且与具体前缀共存时最长前缀优先', () => {
    const resolved = bindRootConfig(resolveConfig({
      projectRoot: 'E:/DemoStudio',
      mappings: [
        { prefix: 'src/engine', file: 'engine.instructions.md' },
        { prefix: '/', file: 'global.instructions.md' },
      ],
    }), 'E:/DemoStudio')!
    // 具体前缀优先（段多者胜）
    expect(resolveTouch('E:/DemoStudio', 'src/engine/Entity.ts', resolved)?.instructionFile)
      .toBe('engine.instructions.md')
    // 其余路径落入全局
    expect(resolveTouch('E:/DemoStudio', 'docs/readme.md', resolved)?.instructionFile)
      .toBe('global.instructions.md')
    expect(resolveTouch('E:/DemoStudio', 'package.json', resolved)?.instructionFile)
      .toBe('global.instructions.md')
    expect(resolveTouch('E:/DemoStudio', '.dsh/instructions/engine.instructions.md', resolved)?.instructionFile)
      .toBe('global.instructions.md')
  })

  it('frontmatter 自动扫描：prefix: / 生成全局映射', async () => {
    const { scanFrontmatterMappings } = await import('../src/frontmatter.js')
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'dsh-instr-global-'))
    writeFileSync(join(dir, 'global.instructions.md'), '---\nprefix: /\n---\n# 全局规范\n')
    const mappings = await scanFrontmatterMappings(dir)
    expect(mappings).toEqual([{ prefix: '/', file: 'global.instructions.md' }])
  })

  it('空字符串 prefix 仍然无效（与旧语义一致）', () => {
    const resolved = resolveConfig({ mappings: [{ prefix: '', file: 'empty.md' }] })
    expect(resolved.mappings).toHaveLength(0)
  })
})

describe('路径规范化（§5.2）', () => {
  it('相对路径基于 projectRoot 解析', () => {
    const resolved = boundRoot('E:/DemoStudio')
    const touch = resolveTouch('E:/DemoStudio', 'src/engine/a.ts', resolved)
    expect(touch).toBeDefined()
  })

  it('Windows 反斜杠路径', () => {
    const resolved = boundRoot('E:/DemoStudio')
    expect(resolveTouch('E:/DemoStudio', 'src\\engine\\a.ts', resolved)).toBeDefined()
    expect(resolveTouch('E:/DemoStudio', 'E:\\DemoStudio\\src\\engine\\a.ts', resolved)).toBeDefined()
  })

  it('越界（..）路径被拒绝', () => {
    const resolved = boundRoot('E:/DemoStudio')
    expect(resolveTouch('E:/DemoStudio', '../outside/a.ts', resolved)).toBeUndefined()
    expect(normalizeTouchedPath('E:/DemoStudio', '../../etc/passwd')).toBeUndefined()
  })

  it('绝对路径越过项目根（不同盘/上级）被拒绝', () => {
    const resolved = boundRoot('E:/DemoStudio')
    expect(resolveTouch('E:/DemoStudio', 'E:/Other/src/engine/a.ts', resolved)).toBeUndefined()
    expect(resolveTouch('E:/DemoStudio', 'E:/src/engine/a.ts', resolved)).toBeUndefined()
  })

  it('空值与非字符串 file_path 被忽略', () => {
    const resolved = boundRoot('E:/DemoStudio')
    expect(resolveTouch('E:/DemoStudio', undefined, resolved)).toBeUndefined()
    expect(resolveTouch('E:/DemoStudio', null, resolved)).toBeUndefined()
    expect(resolveTouch('E:/DemoStudio', 1, resolved)).toBeUndefined()
    expect(resolveTouch('E:/DemoStudio', '   ', resolved)).toBeUndefined()
  })

  it('win32 前缀大小写不敏感；POSIX 敏感', () => {
    const resolved = boundRoot('E:/DemoStudio')
    const caseResult = resolveTouch('E:/DemoStudio', 'SRC/ENGINE/a.ts', resolved)
    if (win32) expect(caseResult).toBeDefined()
    else expect(caseResult).toBeUndefined()
  })
})

describe('最长前缀优先（§5.1 显式映射）', () => {
  it('重叠前缀时更长的映射获胜', () => {
    const resolved = bindRootConfig(resolveConfig({
      projectRoot: 'E:/DemoStudio',
      mappings: [
        { prefix: 'src/engine', file: 'engine.instructions.md' },
        { prefix: 'src/engine/render', file: 'render.instructions.md' },
      ],
    }), 'E:/DemoStudio')!
    expect(resolveTouch('E:/DemoStudio', 'src/engine/render/pass.ts', resolved)?.instructionFile)
      .toBe('render.instructions.md')
    expect(resolveTouch('E:/DemoStudio', 'src/engine/other.ts', resolved)?.instructionFile)
      .toBe('engine.instructions.md')
  })

  it('配置校验：含分隔符或保留段的映射被丢弃', () => {
    const resolved = resolveConfig({
      mappings: [
        { prefix: 'src/engine', file: '../escape.md' },
        { prefix: '', file: 'empty.md' },
        { prefix: 'a/../b', file: 'ok.md' },
        { prefix: 'src/projects', file: 'project.instructions.md' },
      ],
    })
    expect(resolved.mappings).toHaveLength(1)
    expect(resolved.mappings[0]!.file).toBe('project.instructions.md')
  })

  it('映射全被丢弃时绑定失败（跳过注入）', () => {
    const bound = bindRootConfig(resolveConfig({ mappings: [{ prefix: '', file: 'x.md' }] }), 'E:/DemoStudio')
    expect(bound).toBeUndefined()
  })
})

describe('指令目录与 scope（§8.1/§10.1）', () => {
  it('默认指令目录为 <root>/.dsh/instructions，scope 为 目录\\0文件名', () => {
    const resolved = boundRoot('E:/DemoStudio')
    expect(resolved.instructionsDir.replace(/\\/g, '/')).toBe('E:/DemoStudio/.dsh/instructions')
    const paths = instructionPaths(resolved, 'engine.instructions.md')
    expect(paths.displayPath).toBe('.dsh/instructions/engine.instructions.md')
    expect(paths.scope).toBe('.dsh/instructions\u0000engine.instructions.md')
  })

  it('instructionsDir 可配置；越出项目根时绑定失败', () => {
    const ok = bindRootConfig(resolveConfig({
      projectRoot: 'E:/DemoStudio',
      instructionsDir: 'E:/DemoStudio/docs/instructions',
    }), 'E:/DemoStudio')
    expect(ok?.instructionsDisplayDir).toBe(win32 ? 'docs/instructions' : 'docs/instructions')
    const bad = bindRootConfig(resolveConfig({
      projectRoot: 'E:/DemoStudio',
      instructionsDir: 'E:/Outside/instructions',
    }), 'E:/DemoStudio')
    expect(bad).toBeUndefined()
  })
})

describe('默认配置值（§8.4）', () => {
  it('maxSourceBytes=262144、maxMessageBytes=65536、跟踪 read/read_image', () => {
    const resolved = resolveConfig({})
    expect(resolved.maxSourceBytes).toBe(262_144)
    expect(resolved.maxMessageBytes).toBe(65_536)
    expect(resolved.trackedTools.has('read')).toBe(true)
    expect(resolved.trackedTools.has('read_image')).toBe(true)
    expect(resolved.trackedTools.has('write')).toBe(false)
    expect(resolved.trackedTools.has('edit')).toBe(false)
    expect(DEFAULT_MAPPINGS).toEqual([
      { prefix: 'src/engine', file: 'engine.instructions.md' },
      { prefix: 'src/projects', file: 'project.instructions.md' },
    ])
  })

  it('write/edit 由配置显式开启（§6.1）', () => {
    const resolved = resolveConfig({ trackedTools: ['read', 'write', 'edit'] })
    expect(resolved.trackedTools.has('write')).toBe(true)
    expect(resolved.trackedTools.has('edit')).toBe(true)
  })

  it('非正数 maxMessageBytes 表示禁用注入（由 bindSession 拦截）', () => {
    const resolved = resolveConfig({ maxMessageBytes: 0 })
    expect(resolved.maxMessageBytes).toBe(0)
  })
})
