/**
 * ui-compile-gate 启动器 — esbuild 现场打包 scripts/ui-compile-gate.ts 后执行
 * （与 ui-compiler-cli.mjs 同一打包模式；编辑器离线时的 ui_compile 等效门槛）
 *
 * 用法: node scripts/ui-compile-gate.mjs <xxx.widget.html>
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const [, , ...args] = process.argv

const requireFromRoot = createRequire(path.resolve(process.cwd(), 'package.json'))
const esbuild = requireFromRoot('esbuild')

const outDir = path.join(os.tmpdir(), 'demostudio-ui-compiler')
fs.mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, 'ui-compile-gate.cjs')

esbuild.buildSync({
  entryPoints: [path.resolve(process.cwd(), 'scripts', 'ui-compile-gate.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile: outFile,
  logLevel: 'error',
  external: ['electron'],
})

process.argv = [process.argv[0], 'ui-compile-gate', ...args]
await import(pathToFileURL(outFile).href)
