/**
 * 性能分析器独立窗口入口（perf.html）
 *
 * 与主入口（main.tsx → App.tsx）完全分离的模块图：
 * 只挂载 PerfProfilerPanel 全屏面板，不加载编辑器/引擎/游戏项目。
 * 引擎文件改动时 HMR 不再波及本窗口（分窗隔离，同 agent-window-independent-entry）。
 *
 * 依赖闭包红线：本入口与 PerfProfilerPanel 禁止 import 引擎 barrel——
 * 快照类型只走 src/types/perf.ts（纯类型零依赖）。
 *
 * 共享 setup 与主入口保持同步（防双入口漂移）：
 *  - 全局样式 editor.css（--dsw-* 主题变量）
 *  - 面板专属样式 perfPanel.css
 *  - MockElectronAPI（浏览器直开 perf.html 时的 electronAPI 兜底）
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import { PerfProfilerPanel } from './components/PerfProfilerPanel'
import './styles/editor.css'
import './styles/perfPanel.css'
import { injectMockElectronAPI } from './editor/MockElectronAPI'

// ─── 浏览器调试模式：注入 Mock Electron API（仅在 electronAPI 不可用时生效）───
injectMockElectronAPI()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div className="perf-window-root">
      <PerfProfilerPanel />
    </div>
  </React.StrictMode>
)
