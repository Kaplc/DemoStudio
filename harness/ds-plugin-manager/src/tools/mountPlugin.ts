/**
 * mount_plugin — 一键部署：build → junction → patch → validate
 *
 * 合并了 build_plugin / deploy_plugin / validate_plugin 的功能
 */
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ensureJunctions, type JunctionResult } from '../junction.js'
import { ensurePatchEntry, type PatchEntry, type PatchResult } from '../patcher.js'
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

export const mountPluginTool = defineTool({
  name: 'mount_plugin',
  description: '一键部署 DSH 插件（编译 → junction → patch → 验证）',
  parameters: {
    directory: { type: 'string', required: true, description: '插件目录路径（如 harness/ds-memory）' },
    config: { type: 'object', additionalProperties: true, description: 'patch config（可选，如 {"memoryDir":"E:/DemoStudio/.dsh/memory"}）' },
    forceBuild: { type: 'boolean', description: '强制重新编译（默认 dist 存在时跳过）' },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        success: { type: 'boolean' },
        pkgName: { type: 'string' },
        steps: { type: 'array' },
        message: { type: 'string' },
      },
    },
    render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: async (args: { directory: string; config?: Record<string, unknown>; forceBuild?: boolean }) => {
    const { directory, config, forceBuild } = args
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
    const steps: Array<{ name: string; ok: boolean; detail: string }> = []

    // Step 1: Build
    const distExists = fs.existsSync(path.join(pluginDir, 'dist'))
    if (distExists && !forceBuild) {
      steps.push({ name: 'build', ok: true, detail: 'dist/ 已存在，跳过（用 forceBuild=true 强制）' })
    } else {
      // 先确保 node_modules 存在
      if (!fs.existsSync(path.join(pluginDir, 'node_modules'))) {
        try {
          execFileSync('npm', ['install', '--legacy-peer-deps'], {
            cwd: pluginDir,
            stdio: 'pipe',
            timeout: 60_000,
            shell: true,
          })
        } catch {
          // install 失败不阻断，继续尝试 build
        }
      }
      try {
        execFileSync('npm', ['run', 'build'], {
          cwd: pluginDir,
          stdio: 'pipe',
          timeout: 30_000,
          shell: true,
        })
        steps.push({ name: 'build', ok: true, detail: '编译成功' })
      } catch (err: any) {
        const stderr = err.stderr?.toString() || err.message
        steps.push({ name: 'build', ok: false, detail: stderr.slice(0, 200) })
        return { success: false, pkgName, steps, message: '❌ 编译失败，部署中止' }
      }
    }

    // Step 2: Junction
    const junctionResults: JunctionResult[] = ensureJunctions(pluginDir, pkgName, dshHome)
    const junctionOk = junctionResults.every((r: JunctionResult) => r.action !== 'error')
    steps.push({
      name: 'junction',
      ok: junctionOk,
      detail: junctionResults.map((r: JunctionResult) => `${r.profile}: ${r.action}`).join(', '),
    })

    // Step 3: Patch
    const patchEntry: PatchEntry = { id: entryId, name: pkgName }
    if (config && Object.keys(config).length > 0) {
      patchEntry.config = config
    }
    const patchResults: PatchResult[] = []
    for (const profile of ['web', 'headless']) {
      patchResults.push(ensurePatchEntry(dshHome, profile, patchEntry))
    }
    steps.push({
      name: 'patch',
      ok: true,
      detail: patchResults.map((r: PatchResult) => `${r.profile}: ${r.action}`).join(', '),
    })

    // Step 4: Validate
    const validateOk = junctionOk && fs.existsSync(path.join(pluginDir, 'dist', 'index.js'))
    steps.push({
      name: 'validate',
      ok: validateOk,
      detail: validateOk ? 'dist/index.js 存在，junction 正常' : '验证失败',
    })

    const allOk = steps.every((s) => s.ok)
    return {
      success: allOk,
      pkgName,
      steps,
      message: allOk
        ? `✅ ${pkgName} 部署成功（重启 DSH 后生效）`
        : `⚠️ ${pkgName} 部署部分失败`,
    }
  },
})
