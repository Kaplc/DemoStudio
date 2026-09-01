/**
 * Agent 独立窗口入口（agent.html）
 *
 * 与主入口（main.tsx → App.tsx）完全分离的模块图：
 * 只挂载 AgentPanel 全屏面板，不加载编辑器/引擎/游戏项目。
 * 引擎文件改动时 HMR 不再波及本窗口（分窗隔离，见 devdoc/agent-window-independent-entry）。
 *
 * 共享 setup 与主入口保持同步（防双入口漂移）：
 *  - 全局样式 editor.css（含 --dsw-* 主题变量、agent 面板样式）
 *  - MockElectronAPI（浏览器直开 agent.html 时的 electronAPI 兜底）
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import { AgentPanel } from './components/AgentPanel'
import './styles/editor.css'
import { injectMockElectronAPI } from './editor/MockElectronAPI'

// ─── 浏览器调试模式：注入 Mock Electron API（仅在 electronAPI 不可用时生效）───
injectMockElectronAPI()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div className="agent-window-root">
      <AgentPanel />
    </div>
  </React.StrictMode>
)
