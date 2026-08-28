import { useEffect } from 'react'
import { registerShortcuts } from '../editor'
import { useEditorStore } from '../stores/editorStore'

/**
 * 全局键盘快捷键处理
 * 接管 Electron 移除了原生菜单后丢失的快捷键
 */
export function KeyboardShortcuts() {
  const { setShowPluginCenter } = useEditorStore()

  useEffect(() => {
    const cleanup = registerShortcuts()

    // Ctrl+Shift+A — 在独立窗口打开 Agent
    const onToggleAgent = () => {
      window.electronAPI?.dshOpenAgentWindow?.().catch(() => {})
    }
    window.addEventListener('shortcut-toggle-agent', onToggleAgent)

    // Ctrl+Shift+P — 打开插件控制中心
    const onPluginCenter = () => {
      setShowPluginCenter(true)
    }
    window.addEventListener('shortcut-plugin-center', onPluginCenter)

    return () => {
      cleanup()
      window.removeEventListener('shortcut-toggle-agent', onToggleAgent)
      window.removeEventListener('shortcut-plugin-center', onPluginCenter)
    }
  }, [setShowPluginCenter])

  return null
}
