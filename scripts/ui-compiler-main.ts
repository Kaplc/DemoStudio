/**
 * ui-compiler 主逻辑（TS）— CLI 的编译/反编译/lint 门禁实现
 *
 * 直接复用 src/editor/asset/uiCompiler 的 TS 实现（单一事实来源），
 * 由 scripts/ui-compiler-cli.mjs 用 esbuild 现场打包后执行——
 * 不再维护第二份 mjs 手工镜像（旧模式双实现易漂移，已废弃）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { compileWidgetHtml, decompileWidgetJson } from '../src/editor/asset/uiCompiler/index'

const [, , cmd, inputArg, outputArg] = process.argv

function usage(): void {
  console.log(`用法:
  node scripts/ui-compiler-cli.mjs compile <xxx.widget.html> [输出路径.json]
  node scripts/ui-compiler-cli.mjs decompile <xxx.widget.json> [输出路径.html]`)
}

if (!cmd || !inputArg) {
  usage()
  process.exit(cmd ? 0 : 1)
}

const inputPath = path.resolve(process.cwd(), inputArg)
if (!fs.existsSync(inputPath)) {
  console.error(`输入文件不存在: ${inputPath}`)
  process.exit(1)
}

// ════════════════ compile / decompile ════════════════

if (cmd === 'compile') {
  const source = fs.readFileSync(inputPath, 'utf-8')
  // 外部样式表（link/@import）：相对源文件解析读取
  const result = compileWidgetHtml(source, {
    resolveInclude: (href) => fs.readFileSync(path.resolve(path.dirname(inputPath), href), 'utf-8'),
  })
  if (!result.ok) {
    console.error('编译失败:')
    for (const err of result.errors) console.error(`  行 ${err.line}: ${err.message}`)
    process.exit(3)
  }
  for (const w of result.warnings) console.warn(`  ⚠ 行 ${w.line}: ${w.message}`)
  const outPath = outputArg
    ? path.resolve(process.cwd(), outputArg)
    : inputPath.replace(/\.widget\.html$/i, '.widget.json')
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(result.doc, null, 2) + '\n', 'utf-8')
  console.log(`✅ 编译成功: ${outPath}（sourceHash=${(result.doc as { sourceHash: string }).sourceHash}）`)
  runEditorAssetLint(outPath).then((code) => { process.exitCode = code })
} else if (cmd === 'decompile') {
  const raw = fs.readFileSync(inputPath, 'utf-8')
  const doc = JSON.parse(raw.replace(/^\uFEFF/, ''))
  const result = decompileWidgetJson(doc)
  if (!result.ok) {
    console.error('反编译失败:')
    for (const w of result.warnings) console.error(`  ${w}`)
    process.exit(5)
  }
  const outPath = outputArg
    ? path.resolve(process.cwd(), outputArg)
    : inputPath.replace(/\.widget\.json$/i, '.widget.html')
  fs.writeFileSync(outPath, result.html!, 'utf-8')
  console.log(`✅ 反编译成功: ${outPath}`)
  for (const w of result.warnings) console.log(`  ⚠ ${w}`)
} else {
  usage()
  process.exit(1)
}

// ════════════════ 编辑器 assetLint 自动执行（compile 成功后） ════════════════
// 经编辑器 MCP HTTP API（:9877+ 多实例自动探测）调 run_asset_lint，
// 过滤本资产的违规：error 档阻断（exit 4），warn 档透传；编辑器未运行则降级跳过。
// 注意：用 exitCode + 自然退出，勿 process.exit()——Windows Node 下 fetch(undici)
// 句柄清理中强退会触发 libuv 断言崩溃（uv_handle_closing）。

const LINT_PROBE_TIMEOUT_MS = 800
const LINT_SCAN_TIMEOUT_MS = 30000
const LINT_PORT_BASE = 9877
const LINT_PORT_SPAN = 10

async function fetchJson(url: string, { method = 'GET', body, timeoutMs }: { method?: string; body?: unknown; timeoutMs: number }): Promise<any> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    return await resp.json()
  } finally {
    clearTimeout(timer)
  }
}

async function findEditorPort(): Promise<number | null> {
  for (let i = 0; i < LINT_PORT_SPAN; i++) {
    const port = LINT_PORT_BASE + i
    try {
      const status = await fetchJson(`http://127.0.0.1:${port}/api/status`, { timeoutMs: LINT_PROBE_TIMEOUT_MS })
      if (status?.status === 'running') return port
    } catch { /* 端口未监听或非编辑器：探测下一个 */ }
  }
  return null
}

function parseWidgetPath(outPath: string): { folder: string | null; assetRel: string } {
  const norm = outPath.replaceAll('\\', '/')
  const m = /src\/projects\/([^/]+)\/(.+\.widget\.json)$/i.exec(norm)
  if (!m) return { folder: null, assetRel: norm }
  return { folder: m[1], assetRel: `src/projects/${m[1]}/${m[2]}` }
}

async function runEditorAssetLint(outPath: string): Promise<number> {
  const port = await findEditorPort()
  if (port === null) {
    console.log('ℹ 未探测到运行中的编辑器实例（:9877+），跳过 assetLint 自动检查（由编辑器内 ui_compile/MCP 兜底）')
    return 0
  }
  const { folder, assetRel } = parseWidgetPath(outPath)
  const projectParam = folder ?? undefined
  console.log(`lint: 经编辑器实例 :${port} 执行 assetLint${projectParam ? `（project=${projectParam}）` : ''}...`)
  let result: any
  try {
    result = await fetchJson(`http://127.0.0.1:${port}/api/command`, {
      method: 'POST',
      body: { command: 'run_asset_lint', params: projectParam ? { project: projectParam } : {} },
      timeoutMs: LINT_SCAN_TIMEOUT_MS,
    })
  } catch (err) {
    console.warn(`⚠ assetLint 调用失败（${(err as Error).message}）：跳过（由编辑器内 ui_compile/MCP 兜底）`)
    return 0
  }
  if (result?.status === 'error') {
    console.warn(`⚠ assetLint 返回错误（${result.message ?? '未知'}）：跳过（由编辑器内 ui_compile/MCP 兜底）`)
    return 0
  }
  const issues: Array<{ file: string; severity: string; rule: string; nodePath: string; field: string; message: string }> =
    Array.isArray(result?.issues) ? result.issues : []
  const mine = issues.filter((i) => String(i.file ?? '').replaceAll('\\', '/') === assetRel)
  const mineErrors = mine.filter((i) => i.severity === 'error')
  const mineWarns = mine.filter((i) => i.severity === 'warn')
  if (mine.length === 0) {
    console.log(`✅ assetLint 通过: ${assetRel} 零违规（工程共 ${result.total ?? issues.length} 个问题，均非本资产）`)
    return 0
  }
  for (const i of mine) {
    const mark = i.severity === 'error' ? '❌' : '⚠'
    console.error(`  ${mark} [${i.rule}] ${i.nodePath} > ${i.field}: ${i.message}`)
  }
  if (mineErrors.length > 0) {
    console.error(`❌ assetLint 零错误门槛未过: ${assetRel}（error ${mineErrors.length} / warn ${mineWarns.length}）`)
    return 4
  }
  console.warn(`⚠ assetLint 本资产 ${mine.length} 个 warn（不阻断）: ${assetRel}`)
  return 0
}
