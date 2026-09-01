/**
 * ui-compile-gate 主逻辑（TS）— 编辑器离线时的 ui_compile 等效管线
 *
 * 复现 MCP ui_compile 的完整门槛：compileUiSource → assetLint（零 error）→ 落盘 json。
 * lintBridge 在编辑器进程内靠编辑器模块图完成 checker 副作用注册；本入口在 Node
 * 下运行，必须显式 import checkers barrel（否则 getChecker 全空 → lint 假通过）。
 * 由 scripts/ui-compile-gate.mjs 用 esbuild 现场打包后执行。
 */
import fs from 'node:fs'
import path from 'node:path'
// 副作用注册：doc:blueprint / node:* / comp:* / doc:ui-design 全部 checker
import '../src/editor/asset/assetLint/checkers/index'
import { compileWidgetHtml } from '../src/editor/asset/uiCompiler/index'
import { validateWidgetDoc } from '../src/editor/asset/uiCompiler/lintBridge'
import { registeredKinds } from '../src/editor/asset/assetLint/AssetCheckerRegistry'

const inputArg = process.argv[2]
if (!inputArg) {
  console.error('用法: node scripts/ui-compile-gate.mjs <xxx.widget.html>')
  process.exit(1)
}
const inputPath = path.resolve(process.cwd(), inputArg)
const source = fs.readFileSync(inputPath, 'utf-8')

const result = compileWidgetHtml(source, {
  resolveInclude: (href) => fs.readFileSync(path.resolve(path.dirname(inputPath), href), 'utf-8'),
})
if (!result.ok) {
  console.error('编译失败:')
  for (const err of result.errors) console.error(`  行 ${err.line}: ${err.message}`)
  process.exit(3)
}
for (const w of result.warnings) console.warn(`  ⚠ 行 ${w.line}: ${w.message}`)

const outPath = inputPath.replace(/\.widget\.html$/i, '.widget.json')
const issues = validateWidgetDoc(result.doc, outPath)
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
fs.writeFileSync(outPath, JSON.stringify(result.doc, null, 2) + '\n', 'utf-8')
console.log(`✅ 编译+lint 落盘: ${outPath}（sourceHash=${(result.doc as { sourceHash: string }).sourceHash}）`)
