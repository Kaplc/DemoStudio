import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { syncDir, type SyncResult } from '../src/sync.js'

let srcDir: string
let destDir: string

function setup(): void {
  srcDir = mkdtempSync(join(tmpdir(), 'ds-sync-src-'))
  destDir = mkdtempSync(join(tmpdir(), 'ds-sync-dest-'))
}

function cleanup(): void {
  if (existsSync(srcDir)) rmSync(srcDir, { recursive: true, force: true })
  if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true })
}

beforeEach(() => {
  cleanup()
  setup()
})

afterAll(() => {
  cleanup()
})

describe('syncDir - 目录镜像同步', () => {
  it('源目录不存在时返回空结果', () => {
    const result = syncDir('/nonexistent/path', destDir)
    expect(result.copied).toBe(0)
    expect(result.deleted).toBe(0)
    expect(result.unchanged).toBe(0)
    expect(result.touched).toEqual([])
  })

  it('首次同步：复制所有文件', () => {
    writeFileSync(join(srcDir, 'a.txt'), 'hello')
    writeFileSync(join(srcDir, 'b.txt'), 'world')
    mkdirSync(join(srcDir, 'sub'))
    writeFileSync(join(srcDir, 'sub', 'c.txt'), 'nested')

    const result = syncDir(srcDir, destDir)
    expect(result.copied).toBe(3)
    expect(result.unchanged).toBe(0)
    expect(result.deleted).toBe(0)
    expect(result.touched).toHaveLength(3)

    expect(readFileSync(join(destDir, 'a.txt'), 'utf8')).toBe('hello')
    expect(readFileSync(join(destDir, 'b.txt'), 'utf8')).toBe('world')
    expect(readFileSync(join(destDir, 'sub', 'c.txt'), 'utf8')).toBe('nested')
  })

  it('内容相同不复制（unchanged）', () => {
    writeFileSync(join(srcDir, 'a.txt'), 'hello')
    syncDir(srcDir, destDir) // 首次同步

    const result = syncDir(srcDir, destDir) // 再次同步
    expect(result.copied).toBe(0)
    expect(result.unchanged).toBe(1)
    expect(result.deleted).toBe(0)
  })

  it('内容变化时更新', () => {
    writeFileSync(join(srcDir, 'a.txt'), 'v1')
    syncDir(srcDir, destDir)

    writeFileSync(join(srcDir, 'a.txt'), 'v2')
    const result = syncDir(srcDir, destDir)
    expect(result.copied).toBe(1)
    expect(result.unchanged).toBe(0)
    expect(readFileSync(join(destDir, 'a.txt'), 'utf8')).toBe('v2')
  })

  it('默认不排除多余文件（deleteExtraneous=false）', () => {
    writeFileSync(join(srcDir, 'a.txt'), 'hello')
    mkdirSync(destDir, { recursive: true })
    writeFileSync(join(destDir, 'extra.txt'), 'extra')

    const result = syncDir(srcDir, destDir)
    expect(result.deleted).toBe(0)
    expect(existsSync(join(destDir, 'extra.txt'))).toBe(true)
  })

  it('deleteExtraneous=true 时删除多余文件', () => {
    writeFileSync(join(srcDir, 'a.txt'), 'hello')
    mkdirSync(destDir, { recursive: true })
    writeFileSync(join(destDir, 'extra.txt'), 'extra')

    const result = syncDir(srcDir, destDir, { deleteExtraneous: true })
    expect(result.deleted).toBe(1)
    expect(existsSync(join(destDir, 'extra.txt'))).toBe(false)
    expect(existsSync(join(destDir, 'a.txt'))).toBe(true)
  })

  it('跳过 node_modules 目录', () => {
    writeFileSync(join(srcDir, 'a.txt'), 'hello')
    mkdirSync(join(srcDir, 'node_modules'), { recursive: true })
    writeFileSync(join(srcDir, 'node_modules', 'pkg.js'), 'module')

    const result = syncDir(srcDir, destDir)
    expect(result.copied).toBe(1) // 只复制 a.txt
    expect(existsSync(join(destDir, 'node_modules'))).toBe(false)
  })

  it('跳过 .git 目录', () => {
    writeFileSync(join(srcDir, 'a.txt'), 'hello')
    mkdirSync(join(srcDir, '.git'), { recursive: true })
    writeFileSync(join(srcDir, '.git', 'config'), 'git config')

    const result = syncDir(srcDir, destDir)
    expect(result.copied).toBe(1)
    expect(existsSync(join(destDir, '.git'))).toBe(false)
  })

  it('extraExcludes 额外排除目录', () => {
    writeFileSync(join(srcDir, 'a.txt'), 'hello')
    mkdirSync(join(srcDir, 'cache'), { recursive: true })
    writeFileSync(join(srcDir, 'cache', 'data.json'), '{}')

    const result = syncDir(srcDir, destDir, { extraExcludes: ['cache'] })
    expect(result.copied).toBe(1)
    expect(existsSync(join(destDir, 'cache'))).toBe(false)
  })

  it('递归同步子目录结构', () => {
    mkdirSync(join(srcDir, 'a', 'b', 'c'), { recursive: true })
    writeFileSync(join(srcDir, 'a', 'b', 'c', 'deep.txt'), 'deep')

    const result = syncDir(srcDir, destDir)
    expect(result.copied).toBe(1)
    expect(readFileSync(join(destDir, 'a', 'b', 'c', 'deep.txt'), 'utf8')).toBe('deep')
  })
})
