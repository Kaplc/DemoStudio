import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import electronRenderer from 'vite-plugin-electron-renderer'
import path from 'path'

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 1000,
    outDir: 'dist',
  },
  server: {
    // 资产 JSON（scene/blueprint）必须参与文件监听，
    // 否则修改 .scene.json / .blueprint.json 不会触发 Vite 重载，
    // import.meta.glob 读取到的始终是缓存旧内容。
    watch: {},
  },
  plugins: [
    react(),
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
              external: ['electron'],
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
