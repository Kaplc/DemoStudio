import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import electronRenderer from 'vite-plugin-electron-renderer'
import path from 'path'
import fs from 'fs'
import type { Plugin } from 'vite'

/**
 * troika-three-text 的 unicode fallback 数据（codepoint-index / font-meta / font-files）
 * 默认从 jsDelivr CDN 请求。这里提供本地缓存代理：
 *   - 本地 cache/unicode-fonts/ 已有 → 直接返回（不再联网）
 *   - 没有 → 首次从 CDN 下载并写入本地缓存，之后永远读本地
 * 前端通过 TroikaText.unicodeFontsURL = '/__unicode_fonts' 指向本代理。
 */
const UNICODE_FONTS_CDN = 'https://cdn.jsdelivr.net/gh/lojjic/unicode-font-resolver@v1.0.1/packages/data'
const UNICODE_FONTS_CACHE = path.resolve(__dirname, 'cache/unicode-fonts')

function mimeOf(filePath: string): string {
  if (filePath.endsWith('.json')) return 'application/json'
  if (filePath.endsWith('.woff')) return 'font/woff'
  if (filePath.endsWith('.woff2')) return 'font/woff2'
  return 'application/octet-stream'
}

/** dev 缓存代理插件：首次下载后本地复用，之后不再发起网络请求 */
function unicodeFontsCachePlugin(): Plugin {
  return {
    name: 'unicode-fonts-local-cache',
    configureServer(server) {
      server.middlewares.use('/__unicode_fonts', async (req, res) => {
        try {
          const rel = decodeURIComponent((req.url ?? '').replace(/^\//, ''))
          const localPath = path.join(UNICODE_FONTS_CACHE, rel)
          // 路径穿越防护：解析后的路径必须在缓存目录内
          if (!localPath.startsWith(UNICODE_FONTS_CACHE + path.sep)) {
            res.statusCode = 400
            res.end('bad path')
            return
          }
          // 命中本地缓存 → 直接返回（不再联网）
          if (fs.existsSync(localPath)) {
            res.setHeader('Content-Type', mimeOf(localPath))
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
            res.end(fs.readFileSync(localPath))
            return
          }
          // 首次：从 CDN 下载并写入本地缓存
          const remote = `${UNICODE_FONTS_CDN}/${rel}`
          const resp = await fetch(remote)
          if (!resp.ok) {
            res.statusCode = resp.status
            res.end(resp.statusText)
            return
          }
          const buf = Buffer.from(await resp.arrayBuffer())
          fs.mkdirSync(path.dirname(localPath), { recursive: true })
          fs.writeFileSync(localPath, buf)
          res.setHeader('Content-Type', mimeOf(localPath))
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
          res.end(buf)
        } catch (err) {
          res.statusCode = 500
          res.end(String(err))
        }
      })
    },
  }
}

/**
 * Agent HMR 守卫插件
 *
 * 设计目标：Agent 回合期间暂停 HMR，回合结束后只在真正修改了引擎文件时才触发一次重启。
 *
 * 时序：
 *   Agent 回合开始 → pause（收集变更，不触发 HMR）
 *   Agent 写文件 A、B、C → 变更被收集，不触发重启
 *   Agent 回合结束 → 若有 src/ 文件变更 → flush（一次重启）；否则 resume（丢弃，不重启）
 *
 * HTTP API：
 *   POST /__hmr/pause           暂停 HMR，开始收集变更
 *   POST /__hmr/flush           恢复 HMR 并触发收集到的变更（一次重启）
 *   POST /__hmr/resume          恢复 HMR 但丢弃收集的变更（不重启）
 *   GET  /__hmr/status          查询状态
 */
function agentHmrGuardPlugin(): Plugin {
  let paused = false
  let server: any = null

  // 收集暂停期间的文件变更
  const pendingUpdates = new Map<string, { modules: any[]; timestamp: number }>()
  // 收集暂停期间变更的文件路径（用于判断是否改了引擎文件）
  const changedFiles = new Set<string>()

  /** 刷新所有收集的变更（触发一次 HMR） */
  function flushPending() {
    const updates = Array.from(pendingUpdates.values())
    const files = Array.from(changedFiles)
    pendingUpdates.clear()
    changedFiles.clear()

    if (updates.length === 0) return

    console.log(`[HMR Guard] 刷新 ${updates.length} 个变更模块: ${files.join(', ')}`)
    for (const update of updates) {
      for (const mod of update.modules) {
        server?.ws.send({ type: 'update', ...mod })
      }
    }
  }

  /** 丢弃所有收集的变更（不触发 HMR） */
  function discardPending() {
    const count = pendingUpdates.size
    pendingUpdates.clear()
    changedFiles.clear()
    if (count > 0) {
      console.log(`[HMR Guard] 丢弃 ${count} 个变更模块（无引擎文件修改）`)
    }
  }

  /** 解析请求 body */
  function readBody(req: any): Promise<any> {
    return new Promise((resolve) => {
      let body = ''
      req.on('data', (chunk: any) => body += chunk)
      req.on('end', () => {
        try { resolve(JSON.parse(body)) } catch { resolve({}) }
      })
    })
  }

  return {
    name: 'agent-hmr-guard',
    configureServer(s) {
      server = s

      s.middlewares.use('/__hmr', async (req: any, res: any) => {
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Access-Control-Allow-Origin', '*')

        // POST /pause — 暂停 HMR，开始收集变更
        if (req.method === 'POST' && req.url === '/pause') {
          paused = true
          discardPending() // 清空之前的残留
          console.log('[HMR Guard] HMR 已暂停，开始收集变更')
          res.end(JSON.stringify({ paused: true }))
          return
        }

        // POST /flush — 恢复 HMR 并触发收集到的变更（回合结束时调用）
        if (req.method === 'POST' && req.url === '/flush') {
          paused = false
          const count = pendingUpdates.size
          if (count > 0) {
            console.log(`[HMR Guard] 回合结束，触发重启（${count} 个文件变更）`)
            flushPending()
          } else {
            console.log('[HMR Guard] 回合结束，无文件变更')
          }
          res.end(JSON.stringify({ paused: false, flushed: count > 0, changedFiles: Array.from(changedFiles) }))
          return
        }

        // POST /resume — 恢复 HMR 但丢弃变更（无引擎修改时调用）
        if (req.method === 'POST' && req.url === '/resume') {
          paused = false
          discardPending()
          console.log('[HMR Guard] HMR 已恢复（丢弃变更）')
          res.end(JSON.stringify({ paused: false, flushed: false }))
          return
        }

        // GET /status — 查询状态
        if (req.method === 'GET' && req.url === '/status') {
          res.end(JSON.stringify({
            paused,
            pendingFiles: Array.from(changedFiles),
            pendingCount: pendingUpdates.size,
          }))
          return
        }

        res.statusCode = 404
        res.end(JSON.stringify({ error: 'not found' }))
      })
    },

    handleHotUpdate(ctx) {
      // 忽略 logs 文件夹的变更
      if (ctx.file.includes('/logs/') || ctx.file.includes('\\logs\\')) {
        return undefined
      }

      // 暂停状态：收集变更，不触发 HMR
      if (paused) {
        pendingUpdates.set(ctx.file, { modules: ctx.modules, timestamp: Date.now() })
        changedFiles.add(ctx.file)
        console.log(`[HMR Guard] 收集变更: ${ctx.file}`)
        return []
      }

      // 非暂停状态：正常 HMR
      return undefined
    },
  }
}

export default defineConfig({
  define: {
    // 应用根目录绝对路径，注入 renderer：浏览器调试模式（MockElectronAPI）下
    // Agent 面板用它作为 DSH 会话默认工作区；Electron 模式走 main 进程 get-app-info。
    __DEMOSTUDIO_ROOT__: JSON.stringify(path.resolve(__dirname)),
  },
  build: {
    chunkSizeWarningLimit: 1000,
    outDir: 'dist',
  },
  server: {
    // 资产 JSON（scene/blueprint）必须参与文件监听，
    // 否则修改 .scene.json / .blueprint.json 不会触发 Vite 重载，
    // import.meta.glob 读取到的始终是缓存旧内容。
    watch: {},
    // 代理 DSH RPC 请求，绕过 CORS（开发模式下浏览器直连 DSH 用）
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3080',
        changeOrigin: true,
        // DSH 事件下行流走 WebSocket（/api/events.mux、/api/events.host）
        ws: true,
        // DSH 校验 Origin，需要伪造为同源
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Origin', 'http://127.0.0.1:3080')
          })
          // WS upgrade 时也伪造 Origin（question/requested 等下行帧走 WS）
          proxy.on('proxyReqWs', (proxyReq) => {
            proxyReq.setHeader('Origin', 'http://127.0.0.1:3080')
          })
        },
      },
    },
  },
  plugins: [
    react(),
    unicodeFontsCachePlugin(),
    agentHmrGuardPlugin(),
    {
      // 资产 JSON（widget/scene/blueprint）更新不触发 HMR 整页/引擎刷新：
      // 这些文件由编辑器保存机制驱动（writeJsonFile → loadFromJson/loadSceneAsset → 预览重建），
      // 不需要 Vite 热更新传播；文件本身仍被监听，直接改盘不会影响运行中的编辑器。
      // 不在此过滤的话，import.meta.glob 的依赖链会把整个引擎模块树都重载一遍。
      name: 'ignore-asset-json-hmr',
      handleHotUpdate({ file }) {
        if (/(?:widget|scene|blueprint)\.json$/.test(file)) return []
      },
    },
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron', 'ws'],
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(args) {
          args.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
    electronRenderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
