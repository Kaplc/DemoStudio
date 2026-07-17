import { useEffect } from 'react'

/**
 * 全局键盘快捷键处理
 * 接管 Electron 移除了原生菜单后丢失的快捷键
 */
export function KeyboardShortcuts() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 避免在输入框中触发
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      const isMod = e.ctrlKey || e.metaKey

      // F5 — 刷新整个编辑器
      if (e.key === 'F5' && !isMod) {
        e.preventDefault()
        window.location.reload()
        return
      }

      // F6 — 快速存档
      if (e.key === 'F6') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('shortcut-quick-save'))
        return
      }

      // F9 — 快速读档
      if (e.key === 'F9') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('shortcut-quick-load'))
        return
      }

      // Ctrl+Enter / Cmd+Enter — 启动/停止游戏
      if (e.key === 'Enter' && isMod && !e.shiftKey) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('shortcut-launch-game'))
        return
      }

      // Shift+F5 — 停止游戏
      if (e.key === 'F5' && e.shiftKey) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('shortcut-stop-game'))
        return
      }

      // F12 — 打开/关闭 DevTools（仅 Electron 环境）
      if (e.key === 'F12') {
        e.preventDefault()
        window.electronAPI?.toggleDevTools?.()
        return
      }

      // ` — 切换控制台
      if (e.key === '`' || e.key === '~') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('shortcut-toggle-console'))
        return
      }

      // Ctrl+N / Cmd+N — 新建工程
      if (e.key === 'n' && isMod) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('shortcut-new-project'))
        return
      }

      // Ctrl+O / Cmd+O — 打开工程
      if (e.key === 'o' && isMod) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('shortcut-open-project'))
        return
      }

      // Ctrl+S / Cmd+S — 保存
      if (e.key === 's' && isMod && !e.shiftKey) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('shortcut-save'))
        return
      }

      // Ctrl+Shift+S / Cmd+Shift+S — 另存为
      if (e.key === 's' && isMod && e.shiftKey) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('shortcut-save-as'))
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return null
}
