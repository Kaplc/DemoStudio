/**
 * ui-compiler CLI — Node 命令行编译/反编译 .widget.html ↔ .widget.json
 *
 * 用法（项目根目录）：
 *   node scripts/ui-compiler-cli.mjs compile  <.../xxx.widget.html> [输出.json]
 *   node scripts/ui-compiler-cli.mjs decompile <.../xxx.widget.json> [输出.html]
 *
 * 实现说明：本文件只是启动器——用 esbuild JS API 把 scripts/ui-compiler-main.ts
 * （直接 import src/editor/asset/uiCompiler 的 TS 实现）现场打包到临时文件后执行。
 * 单一事实来源，不再维护第二份手工镜像（旧版双实现易漂移，已废弃）。
 * 注意用 esbuild 的 JS API 而非 .cmd 二进制：Node ≥18.20 spawnSync 禁止 .cmd（CVE）。
 * assetLint 零错误门槛：compile 成功后自动探测本机运行中的编辑器实例（MCP API
 * :9877+），error 档阻断（exit 4）；编辑器未运行时降级跳过。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const [, , ...args] = process.argv

// esbuild 从项目根解析（vite 的直接依赖，项目内必有）
const requireFromRoot = createRequire(path.resolve(process.cwd(), 'package.json'))
const esbuild = requireFromRoot('esbuild')

const outDir = path.join(os.tmpdir(), 'demostudio-ui-compiler')
fs.mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, 'ui-compiler-main.cjs')

esbuild.buildSync({
  entryPoints: [path.resolve(process.cwd(), 'scripts', 'ui-compiler-main.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile: outFile,
  logLevel: 'error',
  external: ['electron'],
})

// 转发 argv：主逻辑读取 process.argv[2..]
process.argv = [process.argv[0], 'ui-compiler-main', ...args]
await import(pathToFileURL(outFile).href)
void execFileSync
