/**
 * VirtualList — 轻量虚拟滚动容器
 *
 * 针对聊天面板优化：不定高 items + 底部对齐 + 动态内容。
 * 核心思路：只渲染可视区域附近的 DOM 节点，上下用 spacer 撑起滚动高度。
 */
import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react'

export interface VirtualListProps<T> {
  /** 全量数据 */
  items: T[]
  /** 每个 item 的预估高度（px），用于计算 spacer */
  estimatedItemHeight?: number
  /** 可视区域上下额外渲染的 item 数量（缓冲区） */
  overscan?: number
  /** 单个 item 的渲染函数 */
  renderItem: (item: T, index: number) => React.ReactNode
  /** item 的唯一 key 提取器 */
  getItemKey: (item: T, index: number) => string
  /** 容器类名 */
  className?: string
  /** 是否自动滚动到底部 */
  autoScrollToBottom?: boolean
}

const DEFAULT_ESTIMATED_HEIGHT = 80
const DEFAULT_OVERSCAN = 5

export function VirtualList<T>({
  items,
  estimatedItemHeight = DEFAULT_ESTIMATED_HEIGHT,
  overscan = DEFAULT_OVERSCAN,
  renderItem,
  getItemKey,
  className,
  autoScrollToBottom = true,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(600)
  const heightCacheRef = useRef<Map<string, number>>(new Map())
  const isNearBottomRef = useRef(true)
  const prevItemCountRef = useRef(0)

  // 计算每个 item 的累计偏移
  const { offsets, totalHeight } = useMemo(() => {
    const off: number[] = [0]
    let total = 0
    for (let i = 0; i < items.length; i++) {
      const key = getItemKey(items[i], i)
      const h = heightCacheRef.current.get(key) ?? estimatedItemHeight
      total += h
      off.push(total)
    }
    return { offsets: off, totalHeight: total }
  }, [items, estimatedItemHeight, getItemKey])

  // 二分查找：找到 scrollTop 对应的起始 index
  const findStartIndex = useCallback((scroll: number): number => {
    let lo = 0, hi = offsets.length - 2
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1
      if (offsets[mid + 1] <= scroll) lo = mid + 1
      else if (offsets[mid] > scroll) hi = mid - 1
      else return mid
    }
    return Math.max(0, lo)
  }, [offsets])

  // 监听滚动
  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    setScrollTop(el.scrollTop)

    // 判断是否在底部附近（100px 容差）
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    isNearBottomRef.current = distanceToBottom < 100
  }, [])

  // 监听容器尺寸
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setContainerHeight(entry.contentRect.height)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 测量已渲染 item 的真实高度
  const measureRef = useCallback((key: string, node: HTMLElement | null) => {
    if (!node) return
    const h = node.getBoundingClientRect().height
    const cached = heightCacheRef.current.get(key)
    if (cached !== h) {
      heightCacheRef.current.set(key, h)
    }
  }, [])

  // 新消息到达时自动滚动
  useEffect(() => {
    if (autoScrollToBottom && isNearBottomRef.current && items.length > prevItemCountRef.current) {
      requestAnimationFrame(() => {
        const el = containerRef.current
        if (el) el.scrollTop = el.scrollHeight
      })
    }
    prevItemCountRef.current = items.length
  }, [items.length, autoScrollToBottom])

  // 计算可视范围
  const startIndex = findStartIndex(scrollTop)
  const endIndex = findStartIndex(scrollTop + containerHeight)
  const visibleStart = Math.max(0, startIndex - overscan)
  const visibleEnd = Math.min(items.length - 1, endIndex + overscan)

  const topSpacerHeight = offsets[visibleStart] ?? 0
  const bottomSpacerHeight = totalHeight - (offsets[visibleEnd + 1] ?? totalHeight)

  const visibleItems: React.ReactNode[] = []
  for (let i = visibleStart; i <= visibleEnd && i < items.length; i++) {
    const item = items[i]
    const key = getItemKey(item, i)
    visibleItems.push(
      <div
        key={key}
        ref={(node) => measureRef(key, node)}
        style={{ contain: 'layout style' }}
      >
        {renderItem(item, i)}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={className}
      onScroll={handleScroll}
      style={{ overflow: 'auto', position: 'relative' }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ height: topSpacerHeight }} />
        {visibleItems}
        <div style={{ height: Math.max(0, bottomSpacerHeight) }} />
      </div>
    </div>
  )
}
