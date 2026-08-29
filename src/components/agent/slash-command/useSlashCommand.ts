/**
 * 斜杠命令 React Hook
 * 简化在组件中使用斜杠命令
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import type { SlashCommand, TriggerHit } from './types'
import { commandRegistry } from './CommandRegistry'
import { detectTrigger } from './SlashDetector'
import { logger } from '../../../engine/Logger'

interface UseSlashCommandOptions {
  /** 输入框 ref */
  inputRef: React.RefObject<HTMLTextAreaElement>
  /** 命令执行回调，newText 是替换后的完整文本 */
  onCommand?: (command: SlashCommand, args?: string, newText?: string) => void
  /** 是否启用 */
  enabled?: boolean
}

interface UseSlashCommandResult {
  /** 菜单是否打开 */
  isMenuOpen: boolean
  /** 触发检测结果 */
  hit: TriggerHit | null
  /** 候选命令列表 */
  candidates: SlashCommand[]
  /** 当前高亮索引 */
  highlightIndex: number
  /** 处理输入变化 */
  handleInput: (value: string, caret: number) => void
  /** 处理键盘事件 */
  handleKeyDown: (e: React.KeyboardEvent) => boolean
  /** 选择命令 */
  selectCommand: (command: SlashCommand) => void
  /** 关闭菜单 */
  closeMenu: () => void
  /** 移动高亮 */
  moveHighlight: (dir: 1 | -1) => void
}

export function useSlashCommand({
  inputRef,
  onCommand,
  enabled = true,
}: UseSlashCommandOptions): UseSlashCommandResult {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [hit, setHit] = useState<TriggerHit | null>(null)
  const [candidates, setCandidates] = useState<SlashCommand[]>([])
  const [highlightIndex, setHighlightIndex] = useState(0)

  // 用于防抖的 ref
  const fetchTimeoutRef = useRef<NodeJS.Timeout>()

  // 获取候选命令
  const fetchCandidates = useCallback(async (query: string) => {
    try {
      logger.debug(`[SlashCommand] 获取候选命令: "${query}"`)
      const results = await commandRegistry.getCandidates(query)
      logger.debug(`[SlashCommand] 找到 ${results.length} 个匹配命令`)
      setCandidates(results)
      setHighlightIndex(0)
    } catch (error) {
      logger.warn('[SlashCommand] 获取候选命令失败')
      setCandidates([])
    }
  }, [])

  // 处理输入变化
  const handleInput = useCallback((value: string, caret: number) => {
    if (!enabled) return

    const hitResult = detectTrigger(value, caret)

    if (hitResult === null) {
      setIsMenuOpen(false)
      setHit(null)
      setCandidates([])
      return
    }

    setHit(hitResult)
    setIsMenuOpen(true)

    // 防抖获取候选
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current)
    }
    fetchTimeoutRef.current = setTimeout(() => {
      fetchCandidates(hitResult.query)
    }, 50)
  }, [enabled, fetchCandidates])

  // 关闭菜单（无依赖，可先声明）
  const closeMenu = useCallback(() => {
    setIsMenuOpen(false)
    setHit(null)
    setCandidates([])
    setHighlightIndex(0)
  }, [])

  // 移动高亮
  const moveHighlight = useCallback((dir: 1 | -1) => {
    setHighlightIndex(prev => {
      const next = prev + dir
      if (next < 0) return candidates.length - 1
      if (next >= candidates.length) return 0
      return next
    })
  }, [candidates.length])

  // 选择命令（依赖 closeMenu）
  const selectCommand = useCallback((command: SlashCommand) => {
    if (!hit || !inputRef.current) return

    // 计算替换文本
    const textarea = inputRef.current
    const before = textarea.value.slice(0, hit.span.start)
    const after = textarea.value.slice(hit.span.end)
    const newText = `${before}/${command.name} ${after}`

    // 关闭菜单（先关闭，再更新）
    closeMenu()

    // 触发回调，让父组件处理文本更新
    const args = hit.query.replace(command.name, '').trim()
    onCommand?.(command, args || undefined, newText)
  }, [hit, inputRef, onCommand, closeMenu])

  // 处理键盘事件（依赖 closeMenu / selectCommand / moveHighlight）
  const handleKeyDown = useCallback((e: React.KeyboardEvent): boolean => {
    if (!isMenuOpen) return false

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault()
        moveHighlight(-1)
        return true
      case 'ArrowDown':
        e.preventDefault()
        moveHighlight(1)
        return true
      case 'Enter':
        if (highlightIndex >= 0 && candidates[highlightIndex]) {
          e.preventDefault()
          selectCommand(candidates[highlightIndex])
          return true
        }
        return false
      case 'Escape':
        e.preventDefault()
        closeMenu()
        return true
      default:
        return false
    }
  }, [isMenuOpen, highlightIndex, candidates, closeMenu, selectCommand, moveHighlight])

  // 清理 timeout
  useEffect(() => {
    return () => {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current)
      }
    }
  }, [])

  return {
    isMenuOpen,
    hit,
    candidates,
    highlightIndex,
    handleInput,
    handleKeyDown,
    selectCommand,
    closeMenu,
    moveHighlight,
  }
}
