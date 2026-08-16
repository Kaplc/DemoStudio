/**
 * KeyboardShortcuts — 全局键盘快捷键定义与分发
 *
 * 从 KeyboardShortcuts.tsx 中剥离的非 UI 逻辑。
 * 定义所有编辑器快捷键映射，并通过 CustomEvent 分发到 window。
 */

/** 快捷键映射表：匹配条件 → 分发的 CustomEvent 名称 */
export interface ShortcutBinding {
  /** 条件匹配函数，返回 true 时触发 */
  match: (e: KeyboardEvent) => boolean
  /** 触发的 CustomEvent 名称 */
  eventName: string
}

/** 编辑器默认快捷键绑定 */
export const DEFAULT_SHORTCUTS: ShortcutBinding[] = [
  {
    match: (e) => e.key === 'F5' && !(e.ctrlKey || e.metaKey),
    eventName: 'shortcut-refresh',
  },
  {
    match: (e) => e.key === 'F6',
    eventName: 'shortcut-quick-save',
  },
  {
    match: (e) => e.key === 'F9',
    eventName: 'shortcut-quick-load',
  },
  {
    match: (e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.shiftKey,
    eventName: 'shortcut-launch-game',
  },
  {
    match: (e) => e.key === 'F5' && e.shiftKey,
    eventName: 'shortcut-stop-game',
  },
  {
    match: (e) => e.key === 'F12',
    eventName: 'shortcut-toggle-devtools',
  },
  {
    match: (e) => e.key === '`' || e.key === '~',
    eventName: 'shortcut-toggle-console',
  },
  {
    match: (e) => (e.key === 'n' || e.key === 'N') && (e.ctrlKey || e.metaKey),
    eventName: 'shortcut-new-project',
  },
  {
    match: (e) => (e.key === 'o' || e.key === 'O') && (e.ctrlKey || e.metaKey),
    eventName: 'shortcut-open-project',
  },
  {
    match: (e) => e.key === 's' && (e.ctrlKey || e.metaKey) && !e.shiftKey,
    eventName: 'shortcut-save',
  },
  {
    match: (e) => e.key === 's' && (e.ctrlKey || e.metaKey) && e.shiftKey,
    eventName: 'shortcut-save-as',
  },
  {
    match: (e) => (e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) && !e.shiftKey,
    eventName: 'shortcut-undo',
  },
  {
    match: (e) =>
      ((e.key === 'y' || e.key === 'Y') && (e.ctrlKey || e.metaKey)) ||
      ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) && e.shiftKey),
    eventName: 'shortcut-redo',
  },
  {
    // V — 切换碰撞盒线框显隐（Game 视口与预览视口共用 colliderGizmos 开关）
    match: (e) => (e.key === 'v' || e.key === 'V') && !(e.ctrlKey || e.metaKey),
    eventName: 'shortcut-toggle-collider-gizmos',
  },
]

/**
 * 全局键盘快捷键处理函数
 * 在 keydown 事件中匹配快捷键绑定并分发对应 CustomEvent
 *
 * @param e 键盘事件
 * @param bindings 快捷键绑定列表（默认使用 DEFAULT_SHORTCUTS）
 */
export function handleKeyboardShortcut(
  e: KeyboardEvent,
  bindings: ShortcutBinding[] = DEFAULT_SHORTCUTS,
): void {
  // 避免在输入框中触发
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return

  for (const binding of bindings) {
    if (binding.match(e)) {
      e.preventDefault()

      // F12 — 直接调用 Electron API
      if (binding.eventName === 'shortcut-toggle-devtools') {
        window.electronAPI?.toggleDevTools?.()
        return
      }

      // F5 — 刷新编辑器
      if (binding.eventName === 'shortcut-refresh') {
        window.location.reload()
        return
      }

      window.dispatchEvent(new CustomEvent(binding.eventName))
      return
    }
  }
}

/**
 * 在全局 window 上注册键盘快捷键监听
 * @param bindings 快捷键绑定列表
 * @returns 清理函数
 */
export function registerShortcuts(
  bindings: ShortcutBinding[] = DEFAULT_SHORTCUTS,
): () => void {
  const handler = (e: KeyboardEvent) => handleKeyboardShortcut(e, bindings)
  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}
