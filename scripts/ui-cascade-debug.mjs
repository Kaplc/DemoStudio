/**
 * cascade 调试：复算指定 html 的样式级联，打印指定 class 元素的 computed style 与规则命中
 * 用法: node scripts/ui-cascade-debug.mjs <xxx.widget.html> <ClassName>
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
const outFile = path.join(outDir, 'ui-cascade-debug.cjs')
esbuild.buildSync({
  entryPoints: [path.resolve(process.cwd(), 'scripts', 'ui-cascade-debug-main.ts')],
  bundle: true, format: 'cjs', platform: 'node', outfile: outFile, logLevel: 'error', external: ['electron'],
})
process.argv = [process.argv[0], 'ui-cascade-debug', ...process.argv.slice(2)]
await import(pathToFileURL(outFile).href)
void execFileSync
