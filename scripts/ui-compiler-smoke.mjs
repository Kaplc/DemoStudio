/**
 * ui-compiler 冒烟回归启动器 — 用法：node scripts/ui-compiler-smoke.mjs
 * 与 ui-compiler-cli.mjs 同模式：esbuild 现场打包 TS 源后执行（单一事实来源）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const requireFromRoot = createRequire(path.resolve(process.cwd(), 'package.json'))
const esbuild = requireFromRoot('esbuild')

const outDir = path.join(os.tmpdir(), 'demostudio-ui-compiler')
fs.mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, 'ui-compiler-smoke.cjs')

esbuild.buildSync({
  entryPoints: [path.resolve(process.cwd(), 'scripts', 'ui-compiler-smoke.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile: outFile,
  logLevel: 'error',
  external: ['electron'],
})

process.argv = [process.argv[0], 'ui-compiler-smoke']
await import(pathToFileURL(outFile).href)
