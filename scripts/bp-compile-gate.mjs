/**
 * bp-compile-gate 启动器 — esbuild 现场打包 scripts/bp-compile-main.ts 后执行
 * （照抄 ui-compile-gate.mjs 模式；编辑器离线时的 bp_compile 等效门槛，
 * 也是 MCP bp_compile 的唯一权威管线——单实现，无编辑器侧镜像逻辑）
 *
 * 用法: node scripts/bp-compile-gate.mjs <xxx.blueprint.ts> [--check]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const [, , ...args] = process.argv

const requireFromRoot = createRequire(path.resolve(process.cwd(), 'package.json'))
const esbuild = requireFromRoot('esbuild')

// ?url 资产导入 stub（bp-compile-main 引 registerBuiltinComponents → UI 组件链 →
// TroikaFontPreload 的 woff?url 导入；CLI 下字体用不到，置空串即可。插件不能用 buildSync，故走异步 build）
const stubUrlImports = {
  name: 'stub-url-imports',
  setup(build) {
    build.onResolve({ filter: /\?url$/ }, (a) => ({ path: a.path, namespace: 'stub-url' }))
    build.onLoad({ filter: /.*/, namespace: 'stub-url' }, () => ({ contents: 'module.exports = ""', loader: 'js' }))
  },
}

// 固定目录固定名：临时产物覆盖复用，无累积垃圾
const outDir = path.join(os.tmpdir(), 'demostudio-bp-compiler')
fs.mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, 'bp-compile-gate.cjs')

await esbuild.build({
  entryPoints: [path.resolve(process.cwd(), 'scripts', 'bp-compile-main.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile: outFile,
  logLevel: 'error',
  external: ['electron'],
  plugins: [stubUrlImports],
})

process.argv = [process.argv[0], 'bp-compile-gate', ...args]
await import(pathToFileURL(outFile).href)
