import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createScaffold, type ScaffoldOptions } from '../src/scaffold.js'

let pluginDir: string

function setup(): void {
  pluginDir = mkdtempSync(join(tmpdir(), 'ds-plugin-scaffold-'))
}

function cleanup(): void {
  if (existsSync(pluginDir)) rmSync(pluginDir, { recursive: true, force: true })
}

beforeEach(() => {
  cleanup()
  setup()
})

afterAll(() => {
  cleanup()
})

describe('scaffold - 插件脚手架生成', () => {
  it('生成基本文件结构', () => {
    const options: ScaffoldOptions = {
      pluginDir,
      packageName: '@demostudio/test-plugin',
      description: '测试插件',
      pluginName: 'test-plugin',
    }

    const result = createScaffold(options)
    expect(result.pluginDir).toBe(pluginDir)
    expect(result.files).toContain('package.json')
    expect(result.files).toContain('tsconfig.json')
    expect(result.files).toContain('src/index.ts')

    // 检查文件是否存在
    expect(existsSync(join(pluginDir, 'package.json'))).toBe(true)
    expect(existsSync(join(pluginDir, 'tsconfig.json'))).toBe(true)
    expect(existsSync(join(pluginDir, 'src', 'index.ts'))).toBe(true)
  })

  it('package.json 内容正确', () => {
    const options: ScaffoldOptions = {
      pluginDir,
      packageName: '@demostudio/test-plugin',
      description: '测试插件',
      pluginName: 'test-plugin',
    }

    createScaffold(options)
    const pkg = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'))
    expect(pkg.name).toBe('@demostudio/test-plugin')
    expect(pkg.description).toBe('测试插件')
    expect(pkg.type).toBe('module')
    expect(pkg.main).toBe('dist/index.js')
    expect(pkg.scripts.build).toBe('tsc')
  })

  it('src/index.ts 包含正确的导出', () => {
    const options: ScaffoldOptions = {
      pluginDir,
      packageName: '@demostudio/test-plugin',
      description: '测试插件',
      pluginName: 'test-plugin',
      inject: ['tools', 'systemPrompt'],
    }

    createScaffold(options)
    const indexContent = readFileSync(join(pluginDir, 'src', 'index.ts'), 'utf8')
    expect(indexContent).toContain("export const name = '@demostudio/test-plugin'")
    // 脚手架使用双引号生成 inject 数组
    expect(indexContent).toContain('export const inject = ["tools","systemPrompt"]')
    expect(indexContent).toContain('export function apply')
  })

  it('默认 inject = ["tools"]', () => {
    const options: ScaffoldOptions = {
      pluginDir,
      packageName: '@demostudio/test-plugin',
      description: '测试插件',
      pluginName: 'test-plugin',
    }

    createScaffold(options)
    const indexContent = readFileSync(join(pluginDir, 'src', 'index.ts'), 'utf8')
    expect(indexContent).toContain('export const inject = ["tools"]')
  })

  it('目录已存在时不覆盖', () => {
    mkdirSync(join(pluginDir, 'src'), { recursive: true })
    writeFileSync(join(pluginDir, 'package.json'), '{"existing": true}')

    const options: ScaffoldOptions = {
      pluginDir,
      packageName: '@demostudio/test-plugin',
      description: '测试插件',
      pluginName: 'test-plugin',
    }

    createScaffold(options)
    const pkg = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'))
    expect(pkg.name).toBe('@demostudio/test-plugin') // 被覆盖了
  })
})
