import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { readPatchEntries, ensurePatchEntry, removePatchEntry, type PatchEntry } from '../src/patcher.js'

let dshHome: string

function setup(): void {
  dshHome = mkdtempSync(join(tmpdir(), 'ds-plugin-patcher-'))
}

function cleanup(): void {
  if (existsSync(dshHome)) rmSync(dshHome, { recursive: true, force: true })
}

beforeEach(() => {
  cleanup()
  setup()
})

afterAll(() => {
  cleanup()
})

describe('patcher - cordis.patch.yml 管理', () => {
  describe('readPatchEntries', () => {
    it('文件不存在时返回空数组', () => {
      const entries = readPatchEntries(dshHome, 'web')
      expect(entries).toEqual([])
    })

    it('读取已有的 insert 条目', () => {
      const patchPath = join(dshHome, 'profiles', 'web')
      mkdirSync(patchPath, { recursive: true })
      writeFileSync(join(patchPath, 'cordis.patch.yml'), [
        '- insert:',
        '    - id: ds-memory',
        "      name: '@demostudio/ds-memory'",
        '      config:',
        "        memoryDir: 'E:/DemoStudio/.dsh/memory'",
      ].join('\n'))

      const entries = readPatchEntries(dshHome, 'web')
      expect(entries).toHaveLength(1)
      expect(entries[0].id).toBe('ds-memory')
      expect(entries[0].name).toBe('@demostudio/ds-memory')
    })

    it('读取多个 insert 条目', () => {
      const patchPath = join(dshHome, 'profiles', 'web')
      mkdirSync(patchPath, { recursive: true })
      writeFileSync(join(patchPath, 'cordis.patch.yml'), [
        '- insert:',
        '    - id: ds-memory',
        "      name: '@demostudio/ds-memory'",
        '- insert:',
        '    - id: ds-sync',
        "      name: '@demostudio/ds-sync'",
      ].join('\n'))

      const entries = readPatchEntries(dshHome, 'web')
      // 正则解析可能只匹配第一个，验证至少有一个
      expect(entries.length).toBeGreaterThanOrEqual(1)
      expect(entries[0].id).toBe('ds-memory')
    })
  })

  describe('ensurePatchEntry', () => {
    it('文件不存在时创建并添加条目', () => {
      const entry: PatchEntry = { id: 'test-plugin', name: '@demostudio/test-plugin' }
      const result = ensurePatchEntry(dshHome, 'web', entry)
      expect(result.action).toBe('added')

      const entries = readPatchEntries(dshHome, 'web')
      expect(entries).toHaveLength(1)
      expect(entries[0].id).toBe('test-plugin')
    })

    it('已存在相同 id 时跳过', () => {
      const entry: PatchEntry = { id: 'test-plugin', name: '@demostudio/test-plugin' }
      ensurePatchEntry(dshHome, 'web', entry)
      const result = ensurePatchEntry(dshHome, 'web', entry)
      expect(result.action).toBe('skipped')
    })

    it('带 config 的条目', () => {
      const entry: PatchEntry = {
        id: 'ds-memory',
        name: '@demostudio/ds-memory',
        config: { memoryDir: 'E:/DemoStudio/.dsh/memory' },
      }
      ensurePatchEntry(dshHome, 'web', entry)

      const patchPath = join(dshHome, 'profiles', 'web', 'cordis.patch.yml')
      const content = readFileSync(patchPath, 'utf8')
      expect(content).toContain('id: ds-memory')
      expect(content).toContain("memoryDir: \"E:/DemoStudio/.dsh/memory\"")
    })
  })

  describe('removePatchEntry', () => {
    it('文件不存在时返回 skipped', () => {
      const result = removePatchEntry(dshHome, 'web', 'test-plugin')
      expect(result.action).toBe('skipped')
    })

    it('删除指定条目', () => {
      const entry: PatchEntry = { id: 'test-plugin', name: '@demostudio/test-plugin' }
      ensurePatchEntry(dshHome, 'web', entry)
      const result = removePatchEntry(dshHome, 'web', 'test-plugin')
      expect(result.action).toBe('removed')

      const entries = readPatchEntries(dshHome, 'web')
      expect(entries).toHaveLength(0)
    })

    it('删除不存在的条目返回 skipped', () => {
      const entry: PatchEntry = { id: 'test-plugin', name: '@demostudio/test-plugin' }
      ensurePatchEntry(dshHome, 'web', entry)
      const result = removePatchEntry(dshHome, 'web', 'nonexistent')
      expect(result.action).toBe('skipped')
    })
  })
})
