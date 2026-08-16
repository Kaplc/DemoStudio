import { useEffect } from 'react'
import { registerShortcuts } from '../editor'
import { colliderGizmos } from '../engine'

/**
 * 全局键盘快捷键处理
 * 接管 Electron 移除了原生菜单后丢失的快捷键
 */
export function KeyboardShortcuts() {
  useEffect(() => {
    const cleanup = registerShortcuts()

    // V — 切换碰撞盒线框显隐（Game 视口 gizmos 绘制 + 预览视口 ColliderDebugDrawer 共用开关）
    const onToggleCollider = () => {
      colliderGizmos.toggle()
      // 通知各预览视口立即刷新显隐（无需等下一帧）
      window.dispatchEvent(new CustomEvent('collider-gizmos-toggled'))
    }
    window.addEventListener('shortcut-toggle-collider-gizmos', onToggleCollider)

    return () => {
      cleanup()
      window.removeEventListener('shortcut-toggle-collider-gizmos', onToggleCollider)
    }
  }, [])

  return null
}
