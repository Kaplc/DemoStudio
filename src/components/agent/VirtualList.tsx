/**
 * VirtualList — 轻量虚拟滚动容器
 *
 * 针对聊天面板优化：不定高 items + 底部对齐 + 动态内容。
 * 核心思路：只渲染可视区域附近的 DOM 节点，上下用 spacer 撑起滚动高度。
 */
import React, { useRef, useState, useEffect, useLayoutEffect, useCallback, useMemo } from 'react'

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
  /** 内容变更的依赖值（如流式文本累计长度），变化时也会触发自动滚动 */
  scrollTriggerDeps?: number
  /**
   * 列表末尾的固定内容（不参与虚拟化的偏移计算）。
   * 渲染在下 spacer 之后，因此常驻列表底部末尾。
   */
  renderFooter?: () => React.ReactNode
  /** 通知外部当前是否接近列表底部。 */
  onNearBottomChange?: (nearBottom: boolean) => void
  /** 暴露滚动到底部的方法，供外部浮动按钮使用。 */
  onScrollToBottomReady?: (scrollToBottom: (behavior?: ScrollBehavior) => void) => void
  /** 滚动到顶部附近时通知外部加载更早的历史。 */
  onReachTop?: () => void
  /** 是否还有更早内容；为 false 时不触发顶部加载回调。 */
  canLoadMore?: boolean
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
  scrollTriggerDeps,
  renderFooter,
  onNearBottomChange,
  onScrollToBottomReady,
  onReachTop,
  canLoadMore = true,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(600)
  const heightCacheRef = useRef<Map<string, number>>(new Map())
  const isNearBottomRef = useRef(true)
  const prevItemCountRef = useRef(0)
  const previousFirstKeyRef = useRef<string | undefined>(undefined)
  const previousTotalHeightRef = useRef(0)

  const updateNearBottom = useCallback((nearBottom: boolean) => {
    if (isNearBottomRef.current === nearBottom) return
    isNearBottomRef.current = nearBottom
    onNearBottomChange?.(nearBottom)
  }, [onNearBottomChange])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = containerRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
    updateNearBottom(true)
  }, [updateNearBottom])

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
    updateNearBottom(distanceToBottom < 100)

    if (canLoadMore && el.scrollTop < 80) onReachTop?.()
  }, [canLoadMore, onReachTop, updateNearBottom])

  useEffect(() => {
    onNearBottomChange?.(true)
    onScrollToBottomReady?.(scrollToBottom)
  }, [onNearBottomChange, onScrollToBottomReady, scrollToBottom])

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

  // 新消息到达或内容流式更新时自动滚动
  useEffect(() => {
    if (autoScrollToBottom && isNearBottomRef.current) {
      requestAnimationFrame(() => {
        const el = containerRef.current
        if (el) {
          el.scrollTop = el.scrollHeight
          updateNearBottom(true)
        }
      })
    }
    prevItemCountRef.current = items.length
    // footer 出现/消失时 items.length 不变，需显式依赖其存在与否，
    // 否则思考中卡片出现后不会自动滚入视野
  }, [items.length, autoScrollToBottom, scrollTriggerDeps, !!renderFooter, updateNearBottom])

  // 向前 prepend 历史时补偿新增内容高度，保持用户当前阅读位置不跳动。
  useLayoutEffect(() => {
    const el = containerRef.current
    const firstKey = items.length > 0 ? getItemKey(items[0], 0) : undefined
    const wasPrepended = previousFirstKeyRef.current !== undefined
      && firstKey !== previousFirstKeyRef.current
      && items.length > prevItemCountRef.current

    if (el && wasPrepended && !isNearBottomRef.current) {
      const heightDelta = totalHeight - previousTotalHeightRef.current
      if (heightDelta > 0) el.scrollTop += heightDelta
    }

    previousFirstKeyRef.current = firstKey
    previousTotalHeightRef.current = totalHeight
  }, [getItemKey, items, totalHeight])

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
        {renderFooter?.()}
      </div>
    </div>
  )
}
