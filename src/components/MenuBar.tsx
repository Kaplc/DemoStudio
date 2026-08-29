import React, { useState, useRef, useEffect } from 'react'
import { useEditorStore } from '../stores/editorStore'
import { useEditorPrefsStore } from '../stores/editorPrefsStore'
import { pluginService } from '../editor/PluginService'

interface MenuState {
  open: string | null
}

type MenuAction = (action: string) => void

function DropdownItem({
  label,
  shortcut,
  onClick,
  separator,
}: {
  label: string
  shortcut?: string
  onClick?: () => void
  separator?: boolean
}) {
  if (separator) return <div className="dropdown-separator" />
  return (
    <button className="dropdown-item" onClick={onClick}>
      <span>{label}</span>
      {shortcut && <span className="shortcut">{shortcut}</span>}
    </button>
  )
}

export function MenuBar() {
  const [menu, setMenu] = useState<MenuState>({ open: null })
  const menuRef = useRef<HTMLDivElement>(null)
  const { addConsoleOutput, setShowProjectSelector, setShowNewProjectDialog, launchGame, stopGame, gameState, currentProject, setShowPluginCenter } = useEditorStore()
  const toggleConsole = useEditorPrefsStore((s) => s.toggleConsole)

  const closeMenu = () => setMenu({ open: null })

  const handleAction: MenuAction = (action) => {
    closeMenu()
    addConsoleOutput(`[菜单] ${action}`)

    switch (action) {
      case 'toggle-console':
        toggleConsole()
        break
      case 'open-project':
        setShowProjectSelector(true)
        break
      case 'new-project':
        setShowNewProjectDialog(true)
        break
      case 'launch-game':
        launchGame()
        break
      case 'stop-game':
        stopGame()
        break
      case 'open-agent-window': {
        const api = window.electronAPI
        if (!api?.dshOpenAgentWindow) {
          addConsoleOutput('[Agent] 当前环境不支持独立窗口（浏览器模式）')
          break
        }
        api.dshOpenAgentWindow().then(() => {
          addConsoleOutput('[Agent] Agent 独立窗口已打开')
        }).catch((error: Error) => {
          addConsoleOutput(`[Agent] 打开独立窗口失败: ${error.message}`)
        })
        break
      }
      case 'agent-settings':
        // TODO: 打开 Agent 设置
        addConsoleOutput('[Agent] 设置功能开发中...')
        break
      case 'plugin-center':
        setShowPluginCenter(true)
        addConsoleOutput('[Plugin] 打开插件控制中心')
        break
      default:
        break
    }
  }

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu()
      }
    }
    if (menu.open) {
      document.addEventListener('click', handleClick)
    }
    return () => document.removeEventListener('click', handleClick)
  }, [menu.open])

  const menuItems: Array<{
    label: string
    items: Array<{ label: string; shortcut?: string; action?: string } | 'separator'>
  }> = [
    {
      label: 'Project',
      items: [
        { label: 'New Project', shortcut: 'Ctrl+N', action: 'new-project' },
        { label: 'Open Project...', shortcut: 'Ctrl+O', action: 'open-project' },
        'separator',
        { label: 'Save', shortcut: 'Ctrl+S', action: 'save' },
        { label: 'Save As...', shortcut: 'Ctrl+Shift+S', action: 'save-as' },
        'separator',
        { label: 'Exit', shortcut: 'Alt+F4', action: 'exit' },
      ],
    },
    {
      label: 'Game',
      items: [
        { label: 'Launch Game', shortcut: 'Ctrl+Enter', action: 'launch-game' },
        { label: 'Stop Game', shortcut: 'Shift+F5', action: 'stop-game' },
        'separator',
        { label: 'Project Settings', action: 'project-settings' },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Scene View', action: 'toggle-scene' },
        { label: 'Game View', action: 'toggle-game-view' },
        { label: 'Inspector', action: 'toggle-inspector' },
        { label: 'Console', shortcut: '`', action: 'toggle-console' },
      ],
    },
    {
      label: 'Agent',
      items: [
        { label: '打开 Agent', shortcut: 'Ctrl+Shift+A', action: 'open-agent-window' },
      ],
    },
    {
      label: 'Help',
      items: [
        { label: 'Documentation', action: 'docs' },
        { label: 'About DemoStudio', action: 'about' },
      ],
    },
  ]

  return (
    <div className="menu-bar" ref={menuRef}>
      {menuItems.map((item) => (
        <div key={item.label} style={{ position: 'relative' }}>
          <button
            className={`menu-item ${menu.open === item.label ? 'active' : ''}`}
            onClick={() => setMenu({ open: menu.open === item.label ? null : item.label })}
          >
            {item.label}
          </button>
          {menu.open === item.label && (
            <div className="dropdown-menu">
              {item.items.map((sub, i) =>
                sub === 'separator' ? (
                  <div key={`sep-${i}`} className="dropdown-separator" />
                ) : (
                  <DropdownItem
                    key={sub.label}
                    label={sub.label}
                    shortcut={sub.shortcut}
                    onClick={() => handleAction(sub.action || '')}
                  />
                )
              )}
            </div>
          )}
        </div>
      ))}
      <div className="menu-spacer" />

      {/* 中间: 启动/停止按钮 */}
      <div className="menu-status" style={{ gap: 8 }}>
        {currentProject && (
          <button
            className={`btn ${gameState.running ? 'btn-danger' : 'btn-primary'}`}
            style={{ fontSize: 11, padding: '1px 10px', height: 20 }}
            onClick={() => gameState.running ? stopGame() : launchGame()}
          >
            {gameState.running ? '■ Stop' : '▶ Launch'}
          </button>
        )}
        <span>{currentProject?.name || 'No project'}</span>
        <span style={{ color: 'var(--text-dim)' }}>|</span>
        <span>{gameState.running ? 'Running' : 'Stopped'}</span>
      </div>
    </div>
  )
}
