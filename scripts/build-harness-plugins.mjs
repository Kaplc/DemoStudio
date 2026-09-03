#!/usr/bin/env node
/**
 * DemoStudio Harness 插件构建脚本（editor.bat 调用）
 *
 * 功能:
 *   1. 遍历 harness/ds-* 插件，依赖缺失（node_modules/@deepseek-ai 不存在）时
 *      用国内镜像源自动 npm install（编译与运行时 import 都需要）
 *   2. 增量编译：src/**、package.json、tsconfig.json 比 dist/index.js 新才重新编译，
 *      插件源码更新后无需手动删 dist
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'fs'
import { join, dirname, basename } from 'path'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const HARNESS = join(ROOT, 'harness')

// ─── 国内镜像源（与 check-deps.mjs 保持一致） ───
const REGISTRY = 'https://registry.npmmirror.com'

/** 列出 harness 下的插件目录（ds-* 且含 package.json） */
function listPlugins() {
  if (!existsSync(HARNESS)) return []
  return readdirSync(HARNESS, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('ds-'))
    .map((e) => join(HARNESS, e.name))
    .filter((dir) => existsSync(join(dir, 'package.json')))
}

/** 递归返回目录下所有文件的最新修改时间（目录不存在返回 0） */
function newestMtime(dir) {
  let newest = 0
  if (!existsSync(dir)) return newest
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestMtime(full))
    } else {
      newest = Math.max(newest, statSync(full).mtimeMs)
    }
  }
  return newest
}

/** dist 是否过期：dist/index.js 不存在，或源码/配置比它新 */
function isStale(pluginDir) {
  const distEntry = join(pluginDir, 'dist', 'index.js')
  if (!existsSync(distEntry)) return true
  const distMtime = statSync(distEntry).mtimeMs
  const sources = [
    newestMtime(join(pluginDir, 'src')),
    statSync(join(pluginDir, 'package.json')).mtimeMs,
    existsSync(join(pluginDir, 'tsconfig.json'))
      ? statSync(join(pluginDir, 'tsconfig.json')).mtimeMs
      : 0,
  ]
  return Math.max(...sources) > distMtime
}

/** 依赖是否缺失（所有插件的外部依赖都在 @deepseek-ai 域） */
function depsMissing(pluginDir) {
  return !existsSync(join(pluginDir, 'node_modules', '@deepseek-ai'))
}

/** 用国内源安装插件依赖，返回是否成功 */
function installDeps(pluginDir, name) {
  console.log(`      [Deps] ${name} 缺少依赖，使用国内镜像源自动安装...`)
  const res = spawnSync(
    'npm',
    ['install', `--registry=${REGISTRY}`, '--no-audit', '--no-fund'],
    { stdio: 'inherit', cwd: pluginDir, shell: true }
  )
  if (res.status !== 0) {
    console.log(`        [WARN] ${name} 依赖安装失败，编译可能报错`)
    return false
  }
  return true
}

/** 调根目录的 tsc 编译插件，成功以 dist/index.js 产出为准 */
function compile(pluginDir, name) {
  console.log(`      编译 ${name}...`)
  const res = spawnSync(
    process.execPath,
    [
      join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
      '--project', join(pluginDir, 'tsconfig.json'),
      '--skipLibCheck',
    ],
    { stdio: 'pipe' }
  )
  if (res.status !== 0) {
    // 打印最后的错误信息，方便定位（原 bat 静默吞掉导致失败无原因可查）
    const out = (res.stdout?.toString() || '') + (res.stderr?.toString() || '')
    const lines = out.trim().split('\n').filter(Boolean)
    if (lines.length > 0) {
      console.log('        ' + lines.slice(-6).join('\n        '))
    }
  }
  return res.status === 0 && existsSync(join(pluginDir, 'dist', 'index.js'))
}

// ─── 主流程 ───
const plugins = listPlugins()
if (plugins.length === 0) {
  console.log('      未发现 harness/ds-* 插件，跳过')
  process.exit(0)
}

let built = 0
let skipped = 0
let failed = 0
let depFixed = 0

for (const pluginDir of plugins) {
  const name = basename(pluginDir)

  // 1) 依赖缺失时自动补装（安装失败也继续尝试编译，行为与原 bat 一致）
  if (depsMissing(pluginDir)) {
    if (installDeps(pluginDir, name)) depFixed++
  }

  // 2) 增量编译：仅 dist 过期（不存在或源码更新）时才重新编译
  if (isStale(pluginDir)) {
    if (compile(pluginDir, name)) {
      console.log(`        [OK] ${name} 编译成功`)
      built++
    } else {
      console.log(`        [WARN] ${name} 编译失败`)
      failed++
    }
  } else {
    console.log(`      ${name}: dist 已是最新，跳过`)
    skipped++
  }
}

console.log(`      合计: 编译 ${built} / 最新 ${skipped} / 失败 ${failed} / 补装依赖 ${depFixed}`)
process.exit(failed > 0 ? 1 : 0)
