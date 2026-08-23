// 扩展主体构建脚本（Node CJS）
// 输出 dist/extension.js，供 VS Code 加载
const esbuild = require('esbuild')
const path = require('path')

const isWatch = process.argv.includes('--watch')

const config = {
  entryPoints: [path.resolve(__dirname, 'src/extension.ts')],
  bundle: true,
  outfile: path.resolve(__dirname, 'dist/extension.js'),
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: [
    'vscode',
    '@deepseek-ai/dsh-headless',
    'cordis',
  ],
  sourcemap: true,
  logLevel: 'info'
}

async function run() {
  if (isWatch) {
    const ctx = await esbuild.context(config)
    await ctx.watch()
    console.log('[harness] watch mode: extension.js rebuilding...')
  } else {
    await esbuild.build(config)
    console.log('[harness] build complete: dist/extension.js')
  }
}

run().catch((err) => {
  console.error('[harness] build failed:', err)
  process.exit(1)
})
