import { useEffect } from 'react'
import { registerShortcuts } from '../editor'

/**
 * 全局键盘快捷键处理
 * 接管 Electron 移除了原生菜单后丢失的快捷键
 */
export function KeyboardShortcuts() {
  useEffect(() => {
    const cleanup = registerShortcuts()
    return cleanup
  }, [])

  return null
}
