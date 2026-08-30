/**
 * unmount_plugin — 卸载 DSH 插件
 *
 * 移除 junction + 删除 patch insert 行
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { removeJunctions } from '../junction.js'
import { removePatchEntry, readPatchEntries } from '../patcher.js'

function getDshHome(): string {
  return path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh')
}

function readPackageName(pluginDir: string): string | null {
  const pkgPath = path.join(pluginDir, 'package.json')
  if (!fs.existsSync(pkgPath)) return null
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
  return pkg.name || null
}

export const unmountPluginTool = defineTool({
  name: 'unmount_plugin',
  description: '卸载 DSH 插件（移除 junction + 删除 patch insert 行）',
  parameters: {
    directory: { type: 'string', required: true, description: '插件目录路径（如 harness/dsh-memory）' },
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
  execute: async (args: { directory: string }) => {
    const { directory } = args
    if (!directory) return { success: false, message: 'directory 不能为空' }

    const pluginDir = path.resolve(directory)
    const pkgName = readPackageName(pluginDir)
    if (!pkgName) return { success: false, message: `无法读取包名: ${pluginDir}/package.json` }

    const dshHome = getDshHome()
    const entryId = pkgName.replace(/^@demostudio\//, '')

    // 1. 移除 junction
    const junctionResults = removeJunctions(pkgName, dshHome)

    // 2. 移除 patch 行
    const patchResults = []
    for (const profile of ['web', 'headless']) {
      patchResults.push(removePatchEntry(dshHome, profile, entryId))
    }

    return {
      success: true,
      pkgName,
      junctions: junctionResults,
      patches: patchResults,
      message: `✅ ${pkgName} 已卸载（junction + patch 已移除）`,
    }
  },
})
