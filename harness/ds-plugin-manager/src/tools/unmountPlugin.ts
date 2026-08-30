/**
 * unmount_plugin — 卸载 DSH 插件
 *
 * 移除 junction + 删除 patch insert 行
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { removeJunctions } from '../junction.js'
import { removePatchEntry } from '../patcher.js'
import { PROJECT_ROOT } from '../projectRoot.js'

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
    directory: { type: 'string', required: true, description: '插件目录路径（如 harness/ds-memory）' },
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

    // 支持相对路径（相对于项目根）和绝对路径
    const pluginDir = path.isAbsolute(directory) ? directory : path.join(PROJECT_ROOT, directory)

    // 校验：只能操作 harness/ 下的插件
    const harnessDir = path.join(PROJECT_ROOT, 'harness')
    const normalizedDir = path.resolve(pluginDir)
    if (!normalizedDir.startsWith(path.resolve(harnessDir) + path.sep) && normalizedDir !== path.resolve(harnessDir)) {
      return { success: false, message: `安全限制：只能操作 harness/ 目录下的插件（${pluginDir} 不在 harness/ 下）` }
    }

    const pkgName = readPackageName(pluginDir)
    if (!pkgName) return { success: false, message: `无法读取包名: ${pluginDir}/package.json` }

    const dshHome = getDshHome()
    const entryId = pkgName.replace(/^@demostudio\//, '')

    // 1. 移除 junction（必须传 entryId，与 mount 侧一致；junction.ts 内部会拼 @demostudio 前缀）
    const junctionResults = removeJunctions(entryId, dshHome)

    // 2. 移除 patch 行
    const patchResults = []
    for (const profile of ['web', 'headless']) {
      patchResults.push(removePatchEntry(dshHome, profile, entryId))
    }

    return {
      success: true,
      pkgName,
      junctions: junctionResults.map((r) => ({ profile: r.profile, action: r.action })),
      patches: patchResults.map((r) => ({ profile: r.profile, action: r.action })),
      message: `✅ ${pkgName} 已卸载（junction + patch 已移除）`,
    }
  },
})
