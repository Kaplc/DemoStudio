/**
 * 斜杠命令菜单组件
 * 对标 DSH WebUI 的 slash menu
 */

import React, { useEffect, useRef, useCallback, useState } from 'react'
import type { SlashCommand, TriggerHit } from './types'
import './slash-menu.css'

interface SlashMenuProps {
  /** 是否打开 */
  open: boolean
  /** 触发检测结果 */
  hit: TriggerHit | null
  /** 候选命令列表 */
  candidates: SlashCommand[]
  /** 当前高亮索引 */
  highlightIndex: number
  /** 选择命令回调 */
  onSelect: (command: SlashCommand) => void
  /** 关闭菜单回调 */
  onClose: () => void
  /** 移动高亮回调 */
  onMove: (dir: 1 | -1) => void
  /** 目标元素 ref（用于定位菜单） */
  targetRef?: React.RefObject<HTMLElement>
}

export const SlashMenu: React.FC<SlashMenuProps> = ({
  open,
  hit,
  candidates,
  highlightIndex,
  onSelect,
  onClose,
  onMove,
  targetRef,
}) => {
  const menuRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({})

  // 计算菜单位置和宽度（fixed 定位，始终贴着输入框）
  const updatePosition = useCallback(() => {
    if (!open || !targetRef?.current || !menuRef.current) return

    const target = targetRef.current
    const menu = menuRef.current
    const rect = target.getBoundingClientRect()
    const menuRect = menu.getBoundingClientRect()
    const menuHeight = menuRect.height
    const viewportWidth = window.innerWidth

    // 优先显示在输入框上方，底部贴着输入框顶部
    let top = rect.top - menuHeight - 8
    let left = rect.left

    // 如果上方空间不够，显示在下方，顶部贴着输入框底部
    if (top < 8) {
      top = rect.bottom + 8
    }

    // 水平边界检查
    if (left + 300 > viewportWidth) {
      left = viewportWidth - 316
    }
    if (left < 16) {
      left = 16
    }

    // 使用输入框的宽度
    const width = rect.width

    setMenuStyle({
      position: 'fixed',
      top,
      left,
      width,
    })
  }, [open, targetRef])

  // 当 open 或 targetRef 变化时设置监听器
  useEffect(() => {
    if (!open || !targetRef?.current) return

    updatePosition()

    // 监听滚动和调整大小
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)

    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open, targetRef, updatePosition])

  // 当候选项变化时重新计算位置
  useEffect(() => {
    if (open) {
      // 使用 requestAnimationFrame 等待 DOM 更新后再计算
      requestAnimationFrame(() => {
        updatePosition()
      })
    }
  }, [candidates.length, open, updatePosition])

  // 滚动到高亮项
  useEffect(() => {
    if (!listRef.current || highlightIndex < 0) return
    const item = listRef.current.children[highlightIndex] as HTMLElement
    if (item) {
      item.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightIndex])

  // 点击外部关闭
  useEffect(() => {
    if (!open) return

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open, onClose])

  // 键盘导航
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!open) return

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault()
        onMove(-1)
        break
      case 'ArrowDown':
        e.preventDefault()
        onMove(1)
        break
      case 'Enter':
        e.preventDefault()
        if (highlightIndex >= 0 && candidates[highlightIndex]) {
          onSelect(candidates[highlightIndex])
        }
        break
      case 'Escape':
        e.preventDefault()
        onClose()
        break
    }
  }, [open, highlightIndex, candidates, onSelect, onClose, onMove])

  if (!open || candidates.length === 0) return null

  return (
    <div
      ref={menuRef}
      className="slash-menu"
      style={menuStyle}
      onKeyDown={handleKeyDown}
    >
      <div className="slash-menu__header">
        <span className="slash-menu__trigger">{hit?.trigger}</span>
        {hit?.query && (
          <span className="slash-menu__query">{hit.query}</span>
        )}
      </div>
      <div ref={listRef} className="slash-menu__list" role="listbox">
        {candidates.map((cmd, index) => (
          <div
            key={cmd.name}
            className={`slash-menu__item ${
              index === highlightIndex ? 'slash-menu__item--highlighted' : ''
            }`}
            role="option"
            aria-selected={index === highlightIndex}
            onClick={() => onSelect(cmd)}
            onMouseEnter={() => onMove(index - highlightIndex)}
          >
            <div className="slash-menu__content">
              <span className="slash-menu__name">{cmd.name}</span>
              <span className="slash-menu__description">{cmd.description}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
