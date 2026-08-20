/**
 * OutlineContextMenu — 预览大纲右键浮层菜单
 *
 * 用于资产预览（bp: 3D 蓝图 / bp: widget / sp: 场景预览）的大纲节点右键：
 *  - 「创建」组：预定义节点/控件模板（按预览类型由调用方传入）
 *  - 「操作」组：复制 / 重命名 / 删除
 *
 * 交互：点击外部 / Esc 关闭；重命名在菜单内嵌输入框（Enter 确认 / Esc 取消）。
 * 样式复用编辑器 CSS 变量，与主题一致。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { NodeTemplate } from '../editor/blueprintEdit/nodeTemplates'

export interface OutlineContextMenuProps {
  /** 菜单锚点（视口坐标） */
  x: number
  y: number
  /** 目标节点显示名（标题用） */
  targetLabel: string
  /** 是否允许修改类操作（复制/重命名/删除）：根节点或代码生成节点为 false */
  canModify: boolean
  /** 当前预览类型的模板组（3D 或 UI） */
  templates: NodeTemplate[]
  /** 关闭菜单（点击外部/Esc/操作完成后由调用方关闭） */
  onClose: () => void
  /** 点击创建模板 */
  onCreate: (tpl: NodeTemplate) => void
  /** 复制节点 */
  onDuplicate: () => void
  /** 复制节点名称到剪贴板 */
  onCopyName: () => void
  /** 重命名节点（返回是否成功） */
  onRename: (newName: string) => void
  /** 删除节点 */
  onDelete: () => void
}

const MENU_STYLE: React.CSSProperties = {
  position: 'fixed',
  zIndex: 10000,
  minWidth: 168,
  padding: '4px 0',
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
  fontSize: 12,
  userSelect: 'none',
}

const ITEM_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '5px 14px',
  cursor: 'pointer',
  color: 'var(--text-primary)',
  whiteSpace: 'nowrap',
}

const GROUP_LABEL_STYLE: React.CSSProperties = {
  padding: '3px 14px 2px',
  fontSize: 10,
  color: 'var(--text-dim)',
  cursor: 'default',
}

const SEPARATOR_STYLE: React.CSSProperties = {
  height: 1,
  margin: '4px 8px',
  background: 'var(--border)',
}

export function OutlineContextMenu({
  x, y, targetLabel, canModify, templates, onClose, onCreate, onDuplicate, onCopyName, onRename, onDelete,
}: OutlineContextMenuProps) {
  /** 重命名态：true 显示内嵌输入框 */
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(targetLabel)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭（捕获阶段：避免与其他面板的 mousedown 抢顺序）
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [onClose])

  // Esc 关闭 / 取消重命名；Enter 确认重命名
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (renaming) {
          setRenaming(false)
        } else {
          onClose()
        }
      } else if (e.key === 'Enter' && renaming) {
        e.stopPropagation()
        const v = renameValue.trim()
        setRenaming(false)
        if (v && v !== targetLabel) onRename(v)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [renaming, renameValue, targetLabel, onClose, onRename])

  // 进入重命名态后聚焦输入框并全选
  useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [renaming])

  const hoverBg = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    ;(e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'
  }, [])
  const leaveBg = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    ;(e.currentTarget as HTMLElement).style.background = 'transparent'
  }, [])

  // 视口边界钳制：菜单不超出窗口右下角
  const clampedX = Math.min(x, window.innerWidth - 190)
  const clampedY = Math.min(y, window.innerHeight - 290)

  return (
    <div
      ref={menuRef}
      style={{ ...MENU_STYLE, left: clampedX, top: clampedY }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div style={{ ...GROUP_LABEL_STYLE, color: 'var(--accent)', fontWeight: 600 }}>
        {targetLabel}
      </div>
      <div style={SEPARATOR_STYLE} />

      {renaming ? (
        <div style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            ref={inputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              // Enter/Esc 由全局 keydown 处理（capture 阶段先于 React 合成事件）；
              // 此处阻止输入框默认行为，避免换行/冒泡
              if (e.key === 'Enter' || e.key === 'Escape') e.stopPropagation()
            }}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              flex: 1,
              minWidth: 130,
              padding: '3px 6px',
              fontSize: 12,
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--accent)',
              borderRadius: 3,
              outline: 'none',
            }}
          />
          <span
            style={{ ...ITEM_STYLE, padding: '2px 8px', fontSize: 11, color: 'var(--accent)' }}
            onClick={() => {
              const v = renameValue.trim()
              setRenaming(false)
              if (v && v !== targetLabel) onRename(v)
            }}
          >
            确定
          </span>
        </div>
      ) : (
        <>
          <div style={GROUP_LABEL_STYLE}>创建</div>
          {templates.map((tpl) => (
            <div
              key={tpl.baseName}
              style={ITEM_STYLE}
              onMouseEnter={hoverBg}
              onMouseLeave={leaveBg}
              onClick={() => onCreate(tpl)}
            >
              <span style={{ width: 14, textAlign: 'center', flexShrink: 0 }}>＋</span>
              <span>{tpl.label}</span>
            </div>
          ))}
          <div style={SEPARATOR_STYLE} />
          <div style={GROUP_LABEL_STYLE}>操作</div>
          <div
            style={ITEM_STYLE}
            onMouseEnter={hoverBg}
            onMouseLeave={leaveBg}
            onClick={() => { onCopyName(); onClose() }}
          >
            <span style={{ width: 14, textAlign: 'center', flexShrink: 0 }}>📋</span>
            <span>复制名称</span>
          </div>
          <div
            style={{ ...ITEM_STYLE, ...(canModify ? {} : { opacity: 0.4, cursor: 'default' }) }}
            onMouseEnter={hoverBg}
            onMouseLeave={leaveBg}
            onClick={() => { if (canModify) onDuplicate() }}
          >
            <span style={{ width: 14, textAlign: 'center', flexShrink: 0 }}>⧉</span>
            <span>复制</span>
          </div>
          <div
            style={{ ...ITEM_STYLE, ...(canModify ? {} : { opacity: 0.4, cursor: 'default' }) }}
            onMouseEnter={hoverBg}
            onMouseLeave={leaveBg}
            onClick={() => { if (canModify) { setRenameValue(targetLabel); setRenaming(true) } }}
          >
            <span style={{ width: 14, textAlign: 'center', flexShrink: 0 }}>✎</span>
            <span>重命名</span>
          </div>
          <div
            style={{ ...ITEM_STYLE, ...(canModify ? {} : { opacity: 0.4, cursor: 'default' }) }}
            onMouseEnter={hoverBg}
            onMouseLeave={leaveBg}
            onClick={() => { if (canModify) onDelete() }}
          >
            <span style={{ width: 14, textAlign: 'center', flexShrink: 0, color: '#ff6b6b' }}>🗑</span>
            <span style={{ color: '#ff6b6b' }}>删除</span>
          </div>
        </>
      )}
    </div>
  )
}
