#!/usr/bin/env node
/**
 * DemoStudio 依赖完整性检查/自动安装脚本
 *
 * 用法:
 *   node scripts/check-deps.mjs --check    只检查，有缺失时打印列表并 exit 1
 *   node scripts/check-deps.mjs --install  检查，缺失时用国内镜像源自动补装
 *
 * 检查范围:
 *   - package.json 中 dependencies + devDependencies 的顶层包
 *   - electron 二进制是否完整（node_modules/electron/dist/electron.exe）
 *     （npm install 中断时二进制常缺失，导致启动失败）
 */
import { readFileSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'))

// ─── 国内镜像源 ───
const REGISTRY = 'https://registry.npmmirror.com'
const ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'

const MODE = process.argv[2] === '--install' ? 'install' : 'check'

/** 收集所有顶层依赖名 */
function collectDeps() {
  return Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) })
}

/** 返回缺失的包名列表（node_modules/<pkg> 目录不存在） */
function missingPackages() {
  return collectDeps().filter(
    (name) => !existsSync(join(ROOT, 'node_modules', name))
  )
}

/** electron 二进制是否损坏（目录在但 exe 缺失，常见于下载中断） */
function isElectronBroken() {
  const dist = join(ROOT, 'node_modules', 'electron', 'dist')
  if (!existsSync(dist)) return false
  // Windows: electron.exe；其他平台无扩展名
  const exe = process.platform === 'win32' ? 'electron.exe' : 'electron'
  return !existsSync(join(dist, exe))
}

/** 用国内源安装（npm install 增量安装，配合 package-lock.json 快速补齐） */
function installWithMirror() {
  console.log('[Setup] 使用国内镜像源安装依赖...')
  console.log(`        registry  : ${REGISTRY}`)
  console.log(`        electron  : ${ELECTRON_MIRROR}`)
  const res = spawnSync(
    'npm',
    ['install', `--registry=${REGISTRY}`, '--no-audit', '--no-fund'],
    { stdio: 'inherit', cwd: ROOT, shell: true, env: { ...process.env, ELECTRON_MIRROR } }
  )
  if (res.status !== 0) {
    console.error('[Setup] 依赖安装失败！请检查网络后手动运行:')
    console.error('        npm install --registry=' + REGISTRY)
  }
  return res.status ?? 1
}

// ─── 主流程 ───
const missing = missingPackages()
const electronBroken = isElectronBroken()

if (missing.length === 0 && !electronBroken) {
  console.log('[Setup] 依赖检查通过 ✔')
  process.exit(0)
}

console.log('[Setup] 检测到依赖不完整:')
if (missing.length > 0) {
  console.log(`        缺失包 (${missing.length}): ${missing.join(', ')}`)
}
if (electronBroken) {
  console.log('        electron 二进制不完整（可能需要重新下载）')
}

if (MODE === 'check') {
  process.exit(1)
}

// ─── install 模式：自动补装 ───
const code = installWithMirror()
if (code === 0) {
  // 安装后复查
  const stillMissing = missingPackages().filter(
    (name) => !existsSync(join(ROOT, 'node_modules', name))
  )
  if (stillMissing.length === 0 && !isElectronBroken()) {
    console.log('[Setup] 依赖已补全 ✔')
    process.exit(0)
  }
  console.error(`[Setup] 仍缺失: ${stillMissing.join(', ') || 'electron 二进制'}`)
  process.exit(1)
}
process.exit(code)
