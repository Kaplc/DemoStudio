import React, { useState, useRef, useEffect } from 'react'
import { useEditorStore } from '../stores/editorStore'

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
  const { toggleConsole, togglePanel, addConsoleOutput, setShowProjectSelector } = useEditorStore()

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
      label: 'File',
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
      label: 'Project',
      items: [
        { label: 'Launch Game', shortcut: 'F5', action: 'launch-game' },
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
      <div className="menu-status">
        <span>DemoStudio Editor</span>
      </div>
    </div>
  )
}
