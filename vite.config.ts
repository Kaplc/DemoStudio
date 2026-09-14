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
 * 全量禁用自动热重载：任何文件改动都不再触发 HMR / 整页刷新，统一手动 F5 后生效。
 * 文件监听必须保留（server.watch: {}）——改动仍会使 Vite 模块缓存失效，F5 拿到的就是新代码。
 *
 * 两层拦截缺一不可（对齐 vite 6.4 hmr 实现语义）：
 * 1. hotUpdate 返回 []：跳过所有模块的 HMR 更新（react-refresh / css / ts / 资产 JSON /
 *    游戏运行时数据 / widget HTML 一视同仁），终端也不再刷 "hmr update" 日志。
 *    但 vite 有一条硬编码旁路：更新列表为空且文件以 .html 结尾时仍会广播 full-reload；
 * 2. 再包一层 hot channel send，丢弃 full-reload / update 推送，把 .html 旁路与
 *    optimizeDeps 重发现等零散 reload 一并拦下。ws 连接保留，报错浮层与自定义事件不受影响。
 */
function noAutoReloadPlugin(): Plugin {
  const isReloadPush = (payload: unknown): boolean => {
    const type = (payload as { type?: string } | null)?.type
    return type === 'full-reload' || type === 'update'
  }
  return {
    name: 'no-auto-reload',
    hotUpdate: {
      order: 'post',
      handler: () => [],
    },
    configureServer(server) {
      const client = server.environments.client
      if (client) {
        const hot = client.hot as unknown as { send: (payload: unknown) => void }
        const originalSend = hot.send.bind(hot)
        hot.send = (payload) => {
          if (!isReloadPush(payload)) originalSend(payload)
        }
      }
      // server.ws 是旧式插件用的广播口，一并拦截
      if (server.ws) {
        const ws = server.ws as unknown as { send: (payload: unknown) => void }
        const originalSend = ws.send.bind(ws)
        ws.send = (payload) => {
          if (!isReloadPush(payload)) originalSend(payload)
        }
      }
    },
  }
}

/**
 * electron 主进程 / preload 重建后不再自动重启应用或刷新页面（配合 no-auto-reload 的手动重载策略）：
 *   - 首次构建（process.electronApp 尚不存在）必须拉起 Electron，否则 npm run dev 起不来。
 *     注意 vite-plugin-electron 只把「两个 entry 都完成首轮构建后最后收尾的那个」的 onstart
 *     当作启动点调用一次，之后每次重建各调各的 onstart，所以两个 entry 都要带首启分支。
 *   - 主进程代码重建只提示：F5 无法替换主进程代码，需重启 npm run dev。
 *   - preload 重建只提示：按 F5 刷新页面后生效。
 */
function manualElectronOnstart(label: string, howToApply: string) {
  return (args: { startup(): void; reload(): void }) => {
    if (!(process as { electronApp?: unknown }).electronApp) {
      args.startup()
      return
    }
    console.log(`[electron] ${label}已重新构建（不自动重载），${howToApply}`)
  }
}

export default defineConfig({
  // 相对路径 base：Electron 生产模式 loadFile（file:// 协议）加载 dist/*.html 时，
  // 绝对路径 /assets/* 会 404，必须用 ./assets/* 相对引用（dev/preview 模式同样兼容）。
  base: './',
  define: {
    // 应用根目录绝对路径，注入 renderer：浏览器调试模式（MockElectronAPI）下
    // Agent 面板用它作为 DSH 会话默认工作区；Electron 模式走 main 进程 get-app-info。
    __DEMOSTUDIO_ROOT__: JSON.stringify(path.resolve(__dirname)),
  },
  build: {
    chunkSizeWarningLimit: 1000,
    outDir: 'dist',
    // 双入口 MPA：主编辑器（index.html）+ Agent 独立窗口（agent.html）。
    // 两入口模块图分离，agent 图只含面板闭包（无引擎/项目），HMR 按入口分窗隔离。
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        agent: path.resolve(__dirname, 'agent.html'),
      },
    },
  },
  server: {
    // 文件监听必须保留：改动虽不再触发自动重载（见 no-auto-reload 插件），
    // 但要靠它使 Vite 模块缓存失效——手动 F5 才能拿到新代码；
    // 同时 electron 主进程/preload 的 rebuild watch 也依赖它。
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
    noAutoReloadPlugin(),
    electron([
      {
        entry: 'electron/main.ts',
        // 主进程不再自动重启 Electron：重建只提示，重启 npm run dev 后生效
        onstart: manualElectronOnstart('主进程代码', '重启 npm run dev 后生效'),
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
        // preload 不再自动刷新页面（原 args.reload()）：重建只提示，F5 后生效
        onstart: manualElectronOnstart('preload', '按 F5 刷新页面后生效'),
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
