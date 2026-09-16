/**
 * bp-compile-main 主逻辑（TS）— 蓝图 TS 源编译管线（doc-dev/bp-ts-compile 方案 §6.2）
 *
 * 完整门槛：读源 → esbuild 打包用户源 → import 执行 build() → compileBlueprint
 * → assetLint 零 error → 落盘 .blueprint.json（源码恒为权威）。
 * 不依赖编辑器在线（MCP bp_compile 直接 spawn 本管线）。
 *
 * exit code：1 用法错误 / 2 文件错误 / 3 编译错误 / 4 lint 门槛未过 / 5 --check 不一致。
 * 由 scripts/bp-compile-gate.mjs 用 esbuild 现场打包后执行。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
// 副作用注册：doc:blueprint / node:* / comp:* / doc:ui-design 全部 checker
// ★ 漏了 = getChecker 全空 = lint 假通过（ui-compile-gate.ts:12 同款坑）
import '../src/editor/asset/assetLint/checkers/index'
// ★ Node 侧没有编辑器模块图，必须显式注册组件工厂——否则 resolveChecker 的
// 工厂判定从紧（unknown），合法游戏组件（SphereMesh 等）会被误报 unknown-kind error
import { registerBuiltinComponents } from '../src/engine/tools/registerBuiltinComponents'
import { sourceHashOf } from '../src/editor/asset/bpCompiler/hash'
import { compileBlueprint } from '../src/editor/asset/bpCompiler/compile'
import { validateWidgetDoc } from '../src/editor/asset/uiCompiler/lintBridge'
import { registeredKinds } from '../src/editor/asset/assetLint/AssetCheckerRegistry'

registerBuiltinComponents()

// ─── 参数解析 ───

const args = process.argv.slice(2)
let srcArg: string | null = null
let checkMode = false
for (const a of args) {
  if (a === '--check') checkMode = true
  else if (srcArg === null) srcArg = a
}
if (!srcArg) {
  console.error('用法: node scripts/bp-compile-gate.mjs <xxx.blueprint.ts> [--check]')
  process.exit(1)
}
const srcPath = path.resolve(process.cwd(), srcArg)
if (!fs.existsSync(srcPath) || !fs.statSync(srcPath).isFile()) {
  console.error(`源文件不存在: ${srcPath}`)
  process.exit(2)
}
if (!/\.blueprint\.ts$/i.test(srcPath)) {
  console.error(`源文件须为 *.blueprint.ts: ${srcPath}`)
  process.exit(2)
}

const outPath = srcPath.replace(/\.blueprint\.ts$/i, '.blueprint.json')

// ─── ① 读源 + sourceHash（去 BOM，与 uiCompiler 同规则） ───

const source = fs.readFileSync(srcPath, 'utf-8').replace(/^\uFEFF/, '')
const sourceHash = sourceHashOf(source)

// ─── ② esbuild 打包用户源（'@' 别名与 vite/vitest 对齐；buildSync 无插件——
//      用户源应是纯 TS，误 import 引擎运行时会在这里以打包错误暴露） ───

const repoRoot = process.cwd()
const requireFromRoot = createRequire(path.resolve(repoRoot, 'package.json'))
const esbuild = requireFromRoot('esbuild') as {
  buildSync: (opts: Record<string, unknown>) => { errors: Array<{ text?: string }> }
}
const tmpDir = path.join(os.tmpdir(), 'demostudio-bp-compiler')
fs.mkdirSync(tmpDir, { recursive: true })
const defBundle = path.join(tmpDir, 'bp-def.cjs')

let userBundle: { errors: Array<{ text?: string }> }
try {
  userBundle = esbuild.buildSync({
    entryPoints: [srcPath],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    alias: { '@': path.resolve(repoRoot, 'src') },
    outfile: defBundle,
    logLevel: 'silent',
    external: ['electron'],
  })
} catch (e) {
  console.error('用户源打包失败（esbuild 异常）:')
  console.error(`  ${String((e as Error)?.message ?? e)}`)
  process.exit(3)
}
if (userBundle.errors.length > 0) {
  console.error('用户源打包失败:')
  for (const err of userBundle.errors) console.error(`  ${err.text ?? '未知错误'}`)
  process.exit(3)
}

// ─── ③ require 临时产物 → default export（产物为 cjs，直接 require 免顶层 await） ───

let def: unknown
try {
  def = (requireFromRoot(defBundle) as { default?: unknown }).default
} catch (e) {
  console.error('用户源执行失败（加载产物异常）:')
  console.error(`  ${String((e as Error)?.message ?? e)}`)
  process.exit(3)
}

// ─── ④ compileBlueprint ───

const result = compileBlueprint(def, { sourceHash })
if (!result.ok) {
  console.error('编译失败:')
  for (const err of result.errors) console.error(`  ${err.path}: [${err.rule}] ${err.message}`)
  process.exit(3)
}
const doc = result.doc

// ─── ⑤ lint 门槛（复用 validateWidgetDoc：.blueprint.json 路径不会误触发 ui-design） ───

const issues = validateWidgetDoc(doc, outPath)
const errors = issues.filter((i) => i.severity === 'error')
const warns = issues.filter((i) => i.severity === 'warn')
for (const i of issues) {
  const mark = i.severity === 'error' ? '❌' : '⚠'
  console.error(`  ${mark} [${i.ruleId}] ${i.nodePath} > ${i.field}: ${i.message}`)
}
if (errors.length > 0) {
  console.error(`❌ assetLint 零错误门槛未过（error ${errors.length} / warn ${warns.length}），json 未落盘`)
  process.exit(4)
}
console.log(`✅ assetLint 通过（已注册 checker: ${registeredKinds().join(', ')}；error 0 / warn ${warns.length}）`)

// ─── ⑥ --check：与磁盘 json 深比较（忽略 sourceHash），不落盘 ───

function firstDiffPath(a: unknown, b: unknown, root = ''): string | null {
  if (a === b) return null
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return root || '<根>'
  if (Array.isArray(a) !== Array.isArray(b)) return root || '<根>'
  if (Array.isArray(a) && Array.isArray(b)) {
    const len = Math.max(a.length, b.length)
    for (let i = 0; i < len; i++) {
      if (i >= a.length) return `${root}[${i}]（磁盘多出）`
      if (i >= b.length) return `${root}[${i}]（编译产物多出）`
      const d = firstDiffPath(a[i], b[i], `${root}[${i}]`)
      if (d) return d
    }
    return null
  }
  const aa = a as Record<string, unknown>
  const bb = b as Record<string, unknown>
  const keys = new Set([...Object.keys(aa), ...Object.keys(bb)])
  for (const k of keys) {
    const childRoot = root ? `${root}.${k}` : k
    if (!(k in aa)) return `${childRoot}（磁盘多出）`
    if (!(k in bb)) return `${childRoot}（编译产物多出）`
    const d = firstDiffPath(aa[k], bb[k], childRoot)
    if (d) return d
  }
  return null
}

if (checkMode) {
  if (!fs.existsSync(outPath)) {
    console.error(`❌ --check: 磁盘上没有产物（先编译落盘）: ${outPath}`)
    process.exit(5)
  }
  let disk: unknown
  try {
    disk = JSON.parse(fs.readFileSync(outPath, 'utf-8'))
  } catch (e) {
    console.error(`❌ --check: 磁盘 json 解析失败: ${String((e as Error)?.message ?? e)}`)
    process.exit(5)
  }
  const strip = (x: unknown) => {
    const { sourceHash: _ignored, ...rest } = x as Record<string, unknown>
    return rest
  }
  const diff = firstDiffPath(strip(doc), strip(disk))
  if (diff) {
    console.error(`❌ --check: 编译产物与磁盘 json 不一致（源码为权威，重跑编译可恢复）。首个差异: ${diff}`)
    process.exit(5)
  }
  console.log(`✅ --check: 编译产物与磁盘 json 一致（忽略 sourceHash）: ${outPath}`)
  process.exit(0)
}

// ─── ⑦ 落盘（源码恒为权威；覆盖前置态三分支告警，TC-C6） ───

let prior: { sourceHash?: unknown } | null = null
if (fs.existsSync(outPath)) {
  try {
    prior = JSON.parse(fs.readFileSync(outPath, 'utf-8')) as { sourceHash?: unknown }
  } catch {
    prior = null // 磁盘 json 损坏：视同无前置态，直接覆盖
  }
}
if (prior !== null) {
  if (typeof prior.sourceHash !== 'string') {
    console.warn('⚠ 迁移转换：手写资产将被编译产物接管（此后修改请走 .blueprint.ts 源码；逃生门 = 删除 json 中 sourceHash）')
  } else if (prior.sourceHash !== sourceHash) {
    console.warn('⚠ 现有 json 曾被手改，本次以源码为准覆盖（逃生门 = 删除 json 中 sourceHash 转手写资产）')
  }
}
fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n', 'utf-8')
console.log(`✅ 编译+lint 落盘: ${outPath}（sourceHash=${sourceHash}）`)
