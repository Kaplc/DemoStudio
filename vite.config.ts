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
    {
      // 资产 JSON（widget/scene/blueprint/config/table）更新不触发 HMR 整页/引擎刷新：
      // 这些文件由编辑器保存机制驱动（writeJsonFile → loadFromJson/loadSceneAsset/ConfigLoader → 预览重建），
      // 不需要 Vite 热更新传播；文件本身仍被监听，直接改盘不会影响运行中的编辑器。
      // 不在此过滤的话，import.meta.glob 的依赖链会把整个引擎模块树都重载一遍。
      // 游戏运行时数据（src/projects/{name}/data/*.json，如 fish 存档 save.json）同理排除：
      // 游戏中保存存档落盘不应触发整页热重载（会杀掉运行中的游戏会话）。
      // widget 的 HTML 源（*.widget.html）同理排除：UI 源由编辑器编译/反编译链路驱动，
      // 且 MockElectronAPI 的 glob 会把它拉进模块图，html 落盘会触发整页刷新杀掉游戏会话。
      name: 'ignore-asset-json-hmr',
      handleHotUpdate({ file }) {
        if (/(?:widget|scene|blueprint|config|table)\.json$/.test(file)) return []
        if (/[/\\]src[/\\]projects[/\\][^/\\]+[/\\]data[/\\].+\.json$/i.test(file)) return []
        if (/\.widget\.html$/i.test(file)) return []
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
