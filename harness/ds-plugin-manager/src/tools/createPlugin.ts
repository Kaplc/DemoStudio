/**
 * create_plugin — 创建 DSH 插件脚手架
 *
 * 自动在 harness/ 下生成完整插件目录结构（package.json / tsconfig.json / src/index.ts）
 */
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createScaffold, type ScaffoldOptions } from '../scaffold.js'
import { PROJECT_ROOT } from '../projectRoot.js'

export const createPluginTool = defineTool({
  name: 'create_plugin',
  description: '在 harness/ 下创建新 DSH 插件脚手架（package.json + tsconfig + src/index.ts）',
  parameters: {
    name: { type: 'string', required: true, description: '插件短名（如 screenshot），会自动加 @demostudio/ 包名前缀；目录名自动以 ds- 开头' },
    description: { type: 'string', required: true, description: '插件功能描述' },
    directory: { type: 'string', description: '自定义目录名（可选，默认将 name 转为 ds- 前缀）' },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        success: { type: 'boolean' },
        pluginDir: { type: 'string' },
        files: { type: 'array', items: { type: 'string' } },
        message: { type: 'string' },
      },
    },
    render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: async (args: { name: string; description: string; directory?: string }) => {
    const { name, description, directory } = args
    if (!name) return { success: false, message: 'name 不能为空' }

    const pkgName = name.startsWith('@demostudio/') ? name : `@demostudio/${name}`
    // 目录名自动以 ds- 开头：去掉用户可能输入的 dsh- 前缀，统一加 ds-
    const dirName = directory || `ds-${name.replace(/^(dsh?[-_]?)/, '')}`
    const pluginDir = path.join(PROJECT_ROOT, 'harness', dirName)

    // 检查是否已存在
    if (fs.existsSync(pluginDir)) {
      return { success: false, pluginDir, files: [], message: `目录已存在: ${pluginDir}` }
    }

    const options: ScaffoldOptions = {
      pluginDir,
      packageName: pkgName,
      description: description || `${pkgName} DSH 插件`,
      pluginName: name,
      inject: ['tools'],
    }

    const result = createScaffold(options)

    // npm install（失败不阻断，用户可以手动装）
    try {
      execFileSync('npm', ['install', '--legacy-peer-deps'], {
        cwd: pluginDir,
        stdio: 'pipe',
        timeout: 60_000,
        shell: true,
      })
    } catch {
      // ignore
    }

    return {
      success: true,
      pluginDir: result.pluginDir,
      files: result.files,
      message: `插件 ${pkgName} 已创建在 ${pluginDir}`,
    }
  },
})
