/**
 * list_plugins — 列出所有已注册的 DSH 插件
 *
 * 扫描 harness/dsh-* 目录和 profile patch，汇总状态
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { readPatchEntries } from '../patcher.js'

function getDshHome(): string {
  return path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh')
}

interface PluginInfo {
  name: string
  directory: string
  hasDist: boolean
  hasJunction: boolean
  hasPatch: boolean
  description?: string
}

export const listPluginsTool = defineTool({
  name: 'list_plugins',
  description: '列出所有已注册的 DSH 插件（扫描 harness/dsh-* 目录 + profile patch）',
  parameters: {},
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        plugins: { type: 'array' },
        total: { type: 'number' },
        mounted: { type: 'number' },
      },
    },
    render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: async () => {
    const harnessDir = path.resolve('harness')
    const dshHome = getDshHome()

    if (!fs.existsSync(harnessDir)) {
      return { plugins: [], total: 0, mounted: 0 }
    }

    // 扫描 harness/dsh-* 目录
    const entries = fs.readdirSync(harnessDir, { withFileTypes: true })
    const dshDirs = entries.filter((e) => e.isDirectory() && e.name.startsWith('dsh-'))

    // 读取 patch 条目
    const webPatches = readPatchEntries(dshHome, 'web')
    const patchIds = new Set(webPatches.map((p: { id: string }) => p.id))

    const plugins: PluginInfo[] = []
    for (const dir of dshDirs) {
      const pluginDir = path.join(harnessDir, dir.name)
      const pkgPath = path.join(pluginDir, 'package.json')

      if (!fs.existsSync(pkgPath)) continue

      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      const name = pkg.name || dir.name
      const entryId = name.replace(/^@demostudio\//, '')

      // 检查 junction
      const junctionPath = path.join(dshHome, 'profiles', 'web', 'node_modules', '@demostudio', entryId)
      const hasJunction = fs.existsSync(junctionPath)

      plugins.push({
        name,
        directory: `harness/${dir.name}`,
        hasDist: fs.existsSync(path.join(pluginDir, 'dist')),
        hasJunction,
        hasPatch: patchIds.has(entryId),
        description: pkg.description,
      })
    }

    const mounted = plugins.filter((p) => p.hasJunction && p.hasPatch).length
    return { plugins, total: plugins.length, mounted }
  },
})
