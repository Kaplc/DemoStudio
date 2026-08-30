/**
 * validate_plugin — 验证 DSH 插件是否正常
 *
 * 检查：package.json → dist/ → junction → patch
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { hasPatchEntry } from '../patcher.js'

function getDshHome(): string {
  return path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh')
}

interface CheckResult {
  name: string
  ok: boolean
  detail: string
}

export const validatePluginTool = defineTool({
  name: 'validate_plugin',
  description: '验证 DSH 插件是否正常（检查 package.json / dist / junction / patch）',
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
        checks: { type: 'array' },
        message: { type: 'string' },
      },
    },
    render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: async (args: { directory: string }) => {
    const { directory } = args
    if (!directory) return { success: false, message: 'directory 不能为空' }

    const pluginDir = path.resolve(directory)
    const checks: CheckResult[] = []

    // 1. package.json
    const pkgPath = path.join(pluginDir, 'package.json')
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      checks.push({ name: 'package.json', ok: true, detail: `name: ${pkg.name}` })

      const pkgName = pkg.name
      const entryId = pkgName.replace(/^@demostudio\//, '')
      const dshHome = getDshHome()

      // 2. dist/index.js
      const distMain = path.join(pluginDir, 'dist', 'index.js')
      checks.push({
        name: 'dist/index.js',
        ok: fs.existsSync(distMain),
        detail: fs.existsSync(distMain) ? '存在' : '缺失（需要 npm run build）',
      })

      // 3. Junction（web profile）
      const junctionPath = path.join(dshHome, 'profiles', 'web', 'node_modules', '@demostudio', entryId)
      if (fs.existsSync(junctionPath)) {
        try {
          const target = fs.readlinkSync(junctionPath)
          const correct = path.resolve(target) === path.resolve(pluginDir)
          checks.push({
            name: 'junction (web)',
            ok: correct,
            detail: correct ? `→ ${target}` : `目标错误: ${target}`,
          })
        } catch {
          checks.push({ name: 'junction (web)', ok: false, detail: '无法读取链接目标' })
        }
      } else {
        checks.push({ name: 'junction (web)', ok: false, detail: '不存在' })
      }

      // 4. Patch
      const hasPatch = hasPatchEntry(dshHome, 'web', entryId)
      checks.push({
        name: 'patch (web)',
        ok: hasPatch,
        detail: hasPatch ? 'cordis.patch.yml 中存在 insert 行' : '缺失',
      })
    } else {
      checks.push({ name: 'package.json', ok: false, detail: '不存在' })
    }

    const allOk = checks.every((c) => c.ok)
    const pkgName = checks[0]?.ok ? JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).name : 'unknown'

    return {
      success: allOk,
      pkgName,
      checks,
      message: allOk
        ? `✅ ${pkgName} 验证通过`
        : `⚠️ ${pkgName} 验证失败: ${checks.filter((c) => !c.ok).map((c) => c.name).join(', ')}`,
    }
  },
})
