/**
 * bp-compile-all — 全量编译所有蓝图 TS 源（doc-dev/bp-ts-compile 方案 §6.3 P1）
 *
 * 用法: node scripts/bp-compile-all.mjs [--check]
 *   收集工程根 projects/ 下 asset/blueprints 目录树中的
 *   .blueprint.ts 源，逐个走权威管线（bp-compile-gate.mjs），任一失败即非零退出。
 *   --check 原样透传（CI/全量门用：产物与源不一致即失败）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const repoRoot = process.cwd()
const extraArgs = process.argv.slice(2).filter((a) => a === '--check')

/** 递归收集 dir 下全部 *.blueprint.ts */
function collect(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) collect(p, out)
    else if (/\.blueprint\.ts$/i.test(e.name)) out.push(p)
  }
  return out
}

const roots = ['projects'].map((r) => path.join(repoRoot, r))
// <root>/<project folder>/asset/blueprints 下的全部源
const sources = roots.flatMap((root) => {
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .flatMap((e) => collect(path.join(root, e.name, 'asset', 'blueprints')))
})

if (sources.length === 0) {
  console.log('bp:all 未找到任何 *.blueprint.ts 源（无事可做）')
  process.exit(0)
}
console.log(`bp:all 共 ${sources.length} 个源${extraArgs.length ? `（${extraArgs.join(' ')}）` : ''}`)

const failed = []
for (const src of sources) {
  const rel = path.relative(repoRoot, src)
  const r = spawnSync('node', ['scripts/bp-compile-gate.mjs', rel, ...extraArgs], {
    cwd: repoRoot,
    encoding: 'utf-8',
    windowsHide: true,
  })
  const out = ((r.stdout ?? '') + (r.stderr ?? '')).trim()
  const ok = r.status === 0
  console.log(`${ok ? '✅' : '❌'} ${rel}`)
  if (!ok) {
    failed.push(rel)
    // 失败明细原样回显（gate 输出已面向源，可直接定位）
    console.log(out.split('\n').map((l) => `    ${l}`).join('\n'))
  }
}

if (failed.length > 0) {
  console.error(`\nbp:all 失败 ${failed.length}/${sources.length}:`)
  for (const f of failed) console.error(`  ❌ ${f}`)
  process.exit(1)
}
console.log(`\nbp:all 全部通过（${sources.length}/${sources.length}）`)
