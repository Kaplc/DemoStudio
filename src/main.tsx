import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/editor.css'
import { injectMockElectronAPI } from './editor/MockElectronAPI'

// ─── 浏览器调试模式：注入 Mock Electron API（仅在 electronAPI 不可用时生效）───
injectMockElectronAPI()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
