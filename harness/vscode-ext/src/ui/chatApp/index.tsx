/**
 * React 聊天入口：mount ChatPanel 到 #root
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { ChatPanel } from './ChatPanel'
import './styles.css'

const container = document.getElementById('root')
if (container) {
  const root = createRoot(container)
  root.render(<ChatPanel />)
}
