// Webview UI 构建脚本：输出 chat.js + chat.css（IIFE bundle）
const esbuild = require('esbuild')
const path = require('path')

const isWatch = process.argv.includes('--watch')

const config = {
  entryPoints: [path.resolve(__dirname, 'src/ui/chatApp/index.tsx')],
  bundle: true,
  outdir: path.resolve(__dirname, 'dist-webview'),
  entryNames: 'chat',
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  loader: { '.css': 'css', '.svg': 'dataurl' },
  sourcemap: true,
  logLevel: 'info',
  jsx: 'automatic',
  minify: false,
}

async function run() {
  if (isWatch) {
    const ctx = await esbuild.context(config)
    await ctx.watch()
    console.log('[harness] webview watch mode: rebuilding...')
  } else {
    await esbuild.build(config)
    console.log('[harness] webview build complete: dist-webview/')
  }
}

run().catch((err) => {
  console.error('[harness] webview build failed:', err)
  process.exit(1)
})
