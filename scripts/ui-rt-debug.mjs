/**
 * round-trip 差异调试：单资产 编译→反编译→再编译，按名字配对输出两轮几何
 * 用法: node scripts/ui-rt-debug.mjs <xxx.widget.html> [节点名过滤]
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const requireFromRoot = createRequire(path.resolve(process.cwd(), 'package.json'))
const esbuild = requireFromRoot('esbuild')
const outDir = path.join(os.tmpdir(), 'demostudio-ui-compiler')
fs.mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, 'ui-rt-debug.cjs')
esbuild.buildSync({
  entryPoints: [path.resolve(process.cwd(), 'scripts', 'ui-rt-debug-main.ts')],
  bundle: true, format: 'cjs', platform: 'node', outfile: outFile, logLevel: 'error', external: ['electron'],
})
process.argv = [process.argv[0], 'ui-rt-debug', ...process.argv.slice(2)]
await import(pathToFileURL(outFile).href)
void execFileSync
