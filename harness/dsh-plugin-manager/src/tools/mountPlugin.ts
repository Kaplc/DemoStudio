/**
 * mount_plugin — 挂载插件到 DSH profile
 *
 * 自动创建 junction + 追加 patch insert 行
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ensureJunctions, type JunctionResult } from '../junction.js'
import { ensurePatchEntry, type PatchEntry } from '../patcher.js'

function getDshHome(): string {
  return path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh')
}

function readPackageName(pluginDir: string): string | null {
  const pkgPath = path.join(pluginDir, 'package.json')
  if (!fs.existsSync(pkgPath)) return null
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
  return pkg.name || null
}

export const mountPluginTool = defineTool({
  name: 'mount_plugin',
  description: '将插件挂载到 DSH profile（创建 junction + 写 patch insert 行）',
  parameters: {
    directory: { type: 'string', required: true, description: '插件目录路径（如 harness/dsh-memory）' },
    config: { type: 'object', additionalProperties: true, description: 'patch config（可选，如 {"memoryDir":"E:/DemoStudio/.dsh/memory"}）' },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        success: { type: 'boolean' },
        pkgName: { type: 'string' },
        junctions: { type: 'array' },
        patches: { type: 'array' },
        message: { type: 'string' },
      },
    },
    render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: async (args: { directory: string; config?: Record<string, unknown> }) => {
    const { directory, config } = args
    if (!directory) return { success: false, message: 'directory 不能为空' }

    const pluginDir = path.resolve(directory)
    const pkgName = readPackageName(pluginDir)
    if (!pkgName) return { success: false, message: `无法读取包名: ${pluginDir}/package.json` }

    const dshHome = getDshHome()

    // 1. 创建 junction
    const junctionResults = ensureJunctions(pluginDir, pkgName, dshHome)

    // 2. 追加 patch 行
    const patchEntry: PatchEntry = { id: pkgName.replace(/^@demostudio\//, ''), name: pkgName }
    if (config && Object.keys(config).length > 0) {
      patchEntry.config = config
    }

    const patchResults = []
    for (const profile of ['web', 'headless']) {
      patchResults.push(ensurePatchEntry(dshHome, profile, patchEntry))
    }

    const allOk = junctionResults.every((r: JunctionResult) => r.action !== 'error')
    return {
      success: allOk,
      pkgName,
      junctions: junctionResults,
      patches: patchResults,
      message: allOk
        ? `✅ ${pkgName} 已挂载（junction + patch，web + headless）`
        : `⚠️ 部分操作失败，请检查结果`,
    }
  },
})
