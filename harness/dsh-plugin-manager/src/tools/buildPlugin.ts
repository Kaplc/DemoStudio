/**
 * build_plugin — 编译 DSH 插件
 *
 * 在插件目录执行 npm run build，产出 dist/
 */
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const buildPluginTool = defineTool({
  name: 'build_plugin',
  description: '编译指定 DSH 插件（npm run build → dist/）',
  parameters: {
    directory: { type: 'string', required: true, description: '插件目录路径（相对项目根或绝对路径，如 harness/dsh-memory）' },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        success: { type: 'boolean' },
        pluginDir: { type: 'string' },
        message: { type: 'string' },
        error: { type: 'string' },
      },
    },
    render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: async (args: { directory: string }) => {
    const { directory } = args
    if (!directory) return { success: false, message: 'directory 不能为空' }

    const pluginDir = path.resolve(directory)

    if (!fs.existsSync(path.join(pluginDir, 'package.json'))) {
      return { success: false, pluginDir, message: `插件目录不存在或缺少 package.json: ${pluginDir}` }
    }

    try {
      execFileSync('npm', ['run', 'build'], {
        cwd: pluginDir,
        stdio: 'pipe',
        timeout: 30_000,
      })

      const distExists = fs.existsSync(path.join(pluginDir, 'dist'))
      return {
        success: distExists,
        pluginDir,
        message: distExists
          ? `✅ 编译成功: ${pluginDir}/dist/`
          : `⚠️ build 执行了但 dist/ 不存在（可能 tsc 无输出）`,
      }
    } catch (err: any) {
      const stderr = err.stderr?.toString() || err.message
      return { success: false, pluginDir, message: `❌ 编译失败`, error: stderr }
    }
  },
})
