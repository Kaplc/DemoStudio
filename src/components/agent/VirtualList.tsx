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
  /** 会话代号：变化时强制回到贴底状态（旧会话的滚动位置不继承）。 */
  resetKey?: string | number
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
  resetKey,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(600)
  const heightCacheRef = useRef<Map<string, number>>(new Map())
  // item 内部高度变化（卡片手动折叠/展开、图片加载等）不经过本组件重渲染，
  // 用版本号驱动 offsets/totalHeight 重算，让外部滚动条跟随更新
  const [heightVersion, setHeightVersion] = useState(0)
  const itemRORef = useRef<ResizeObserver | null>(null)
  const isNearBottomRef = useRef(true)
  const lastScrollTopRef = useRef(0)
  const prevItemCountRef = useRef(0)
  const previousFirstKeyRef = useRef<string | undefined>(undefined)
  const previousTotalHeightRef = useRef(0)
  // ─── 上翻加载的视口锚定（防跳变）───
  // ─── 上翻加载的视口锚定（补偿状态 refs，区块在 offsets 定义之后）───
  const anchorStartedAtRef = useRef(0)

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
  }, [items, estimatedItemHeight, getItemKey, heightVersion])

  // ─── 上翻加载的视口锚定：总高增量补偿收敛 ───
  // prepend 后新增消息渲染测量会持续改写 totalHeight——若只做一次估算补偿，
  // 测量完成后旧内容整体位移，用户视口里的内容跳走（"不从我停止滚动的地方
  // 开始"）。方案：滚顶触发加载且用户不在贴底时置补偿标记；此后 totalHeight
  // 每增长一次就把增量补进 scrollTop（视口相对旧内容保持不动），400ms 无增长
  // /超时/用户滚动（wheel/touchmove）则结束。不依赖 item key——renderNodes
  // 会把连续 assistant/tool 消息聚合成 step 节点，prepend 改变聚合边界后
  // 旧 key 会消失，key 锚定不可靠。
  const compensateRef = useRef(false)
  const compensateLastTotalRef = useRef(0)
  const compensateCleanupRef = useRef<(() => void) | null>(null)
  const startCompensation = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    compensateRef.current = true
    compensateLastTotalRef.current = totalHeight
    anchorStartedAtRef.current = Date.now()
    compensateCleanupRef.current?.()
    const onUserScroll = () => { compensateRef.current = false }
    el.addEventListener('wheel', onUserScroll, { passive: true })
    el.addEventListener('touchmove', onUserScroll, { passive: true })
    compensateCleanupRef.current = () => {
      el.removeEventListener('wheel', onUserScroll)
      el.removeEventListener('touchmove', onUserScroll)
      compensateCleanupRef.current = null
    }
  }, [totalHeight])

  useLayoutEffect(() => {
    if (!compensateRef.current) return
    const el = containerRef.current
    if (!el) return
    const growth = totalHeight - compensateLastTotalRef.current
    if (growth > 0) {
      el.scrollTop += growth
      lastScrollTopRef.current = el.scrollTop
    }
    compensateLastTotalRef.current = totalHeight
    // 400ms 内 totalHeight 无增长（effect 不再重跑）则由超时清理；超时上限 2s
    if (Date.now() - anchorStartedAtRef.current > 2000) {
      compensateRef.current = false
      compensateCleanupRef.current?.()
    }
    const timer = window.setTimeout(() => {
      compensateRef.current = false
      compensateCleanupRef.current?.()
    }, 400)
    return () => window.clearTimeout(timer)
  }, [totalHeight])

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
    const current = el.scrollTop
    const delta = current - lastScrollTopRef.current
    lastScrollTopRef.current = current
    setScrollTop(current)

    // 判断是否在底部附近（100px 容差）。只在用户向上滚动时解除贴底：
    // 恢复会话后「滚动→渲染→测量」收敛期间距底距离会暂时超过阈值，
    // 若任何滚动都判定离开底部，收敛会被打断、停不到真正的底部。
    const distanceToBottom = el.scrollHeight - current - el.clientHeight
    if (distanceToBottom < 100) {
      updateNearBottom(true)
    } else if (delta < 0) {
      updateNearBottom(false)
    }

    if (canLoadMore && current < 80) {
      // 上翻加载：非贴底状态启动视口补偿（prepend 后总高增量会持续补进 scrollTop，
      // 用户视口相对旧内容保持不动）；贴底时 prepend 由贴底跟随 effect 接管
      if (!isNearBottomRef.current) startCompensation()
      onReachTop?.()
    }
  }, [canLoadMore, onReachTop, updateNearBottom, startCompensation])

  // 内容不足一屏且还有更早历史时自动补拉（链式拉到满屏或拉完）。
  // 虚拟会话快速路径（2026-09-20）的缓冲只覆盖面板存活期间收到的事件，切回去的
  // 消息经常不满一屏——容器滚不动就没有 scroll 事件，上方只在 scroll 里触发的
  // onReachTop 永远不会发生，表现为"往上滚动拉不到历史消息"。这里在布局收敛后
  // 检查可滚动性，不满屏就代用户触发一次加载；加载完成后 items/heightVersion
  // 变化会重跑本 effect，仍不满屏则继续，直到满屏或 canLoadMore 翻 false。
  // 父组件的加载防重入（historyLoadingRef）保证并发触发安全；RPC 失败时 items
  // 不变、effect 不重跑，自然停止不循环。
  useEffect(() => {
    if (!canLoadMore || !onReachTop) return
    const el = containerRef.current
    if (!el) return
    if (el.scrollHeight <= el.clientHeight + 1) {
      if (!isNearBottomRef.current) startCompensation()
      onReachTop?.()
    }
  }, [items, containerHeight, heightVersion, canLoadMore, onReachTop, startCompensation])

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

  // 监听已渲染 item 的尺寸：卡片折叠/展开是子组件内部状态，不触发本组件
  // 重渲染，ref 测量只在挂载时跑，高度变化必须由 RO 同步进缓存。
  // observe() 的首次通知与 ref 测量同帧且值相等，不会产生多余的重算。
  useEffect(() => {
    const ro = new ResizeObserver(entries => {
      let changed = false
      for (const entry of entries) {
        const node = entry.target as HTMLElement
        if (!node.isConnected) continue
        const key = node.getAttribute('data-vl-key')
        if (!key) continue
        const h = node.getBoundingClientRect().height
        if (heightCacheRef.current.get(key) !== h) {
          heightCacheRef.current.set(key, h)
          changed = true
        }
      }
      if (changed) setHeightVersion(v => v + 1)
    })
    itemRORef.current = ro
    // 首帧 item 的 ref 测量早于本 effect（当时 RO 尚未创建），这里补挂一次
    containerRef.current?.querySelectorAll<HTMLElement>('[data-vl-key]').forEach(node => ro.observe(node))
    return () => {
      ro.disconnect()
      itemRORef.current = null
    }
  }, [])

  // 测量已渲染 item 的真实高度。这里只登记观察，不写缓存：
  // 高度缓存的唯一写入者是 itemRO（observe 的首次通知 + 后续尺寸变化），
  // 挂载首测因此与"卡片折叠/展开"走同一条 heightVersion → offsets 重算 →
  // 贴底重吸附管道。若在此静默预写缓存，RO 首次通知会因值相等被吞（changed=false
  // 不 bump），贴底 rAF 读到的 scrollHeight 仍是估算 spacer——高节点（edit/write
  // 自动展开的 diff 过程区 600px+ vs 估算 100px）落地后停在与真实底差几百 px 处，
  // 工具执行期无后续事件触发追平，表现为"滚动条不跟到最新"（2026-09-21 用户报告）。
  const measureRef = useCallback((key: string, node: HTMLElement | null) => {
    if (!node) return
    node.setAttribute('data-vl-key', key)
    itemRORef.current?.observe(node)
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
    // 否则思考中卡片出现后不会自动滚入视野。
    // heightVersion：贴底时卡片折叠/展开改变了列表总高，需重新吸附底部。
  }, [items.length, autoScrollToBottom, scrollTriggerDeps, !!renderFooter, heightVersion, updateNearBottom])

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

  // resetKey 变化（切换/恢复会话）时强制回到贴底：旧会话里用户可能已向上
  // 滚动，贴底标志不能继承。先按当时的估算高度跳一次。历史消息一次性渲染
  // 无法保证高度全部测完（markdown/代码块等二次布局），「渲染→测量→吸附」
  // 链路存在竞态，可能停在距底几像素处——因此再开一个有界收敛窗口：
  // 周期性重新吸附，直到距底为 0 连续两次（最后一条消息显示稳定）或超时。
  // 窗口期内用户的滚轮/触摸（同步派发，不等渲染帧）立即终止吸附，不与用户对抗。
  const resetKeyRef = useRef(resetKey)
  const settleTimerRef = useRef<number | null>(null)
  const settleCleanupRef = useRef<(() => void) | null>(null)
  useLayoutEffect(() => {
    if (resetKeyRef.current === resetKey) return
    resetKeyRef.current = resetKey
    const el = containerRef.current
    if (!el) return
    isNearBottomRef.current = true
    updateNearBottom(true)
    el.scrollTop = el.scrollHeight
    lastScrollTopRef.current = el.scrollTop

    settleCleanupRef.current?.()
    const startedAt = Date.now()
    let stableTicks = 0
    let cleanup: () => void
    const abort = () => {
      // ref 此刻仍为 true，经 updateNearBottom 统一改值并通知外部（显示浮动按钮）
      updateNearBottom(false)
      cleanup()
    }
    cleanup = () => {
      if (settleTimerRef.current != null) {
        window.clearInterval(settleTimerRef.current)
        settleTimerRef.current = null
      }
      el.removeEventListener('wheel', abort)
      el.removeEventListener('touchmove', abort)
      settleCleanupRef.current = null
    }
    settleTimerRef.current = window.setInterval(() => {
      const current = containerRef.current
      if (!current || !isNearBottomRef.current) {
        cleanup()
        return
      }
      current.scrollTop = current.scrollHeight
      const dist = current.scrollHeight - current.scrollTop - current.clientHeight
      stableTicks = dist <= 0 ? stableTicks + 1 : 0
      if (stableTicks >= 2 || Date.now() - startedAt > 2000) cleanup()
    }, 100)
    el.addEventListener('wheel', abort, { passive: true })
    el.addEventListener('touchmove', abort, { passive: true })
    settleCleanupRef.current = cleanup
  }, [resetKey, updateNearBottom])

  // 卸载时清理吸附收敛窗口
  useEffect(() => () => settleCleanupRef.current?.(), [])

  // 容器可视高度变化（面板拖拽、窗口缩放等）会改变 scrollTop 的最大值，
  // 贴底状态下需重新吸附，否则停在原位置、底部露出一条缺口
  useEffect(() => {
    if (!autoScrollToBottom || !isNearBottomRef.current) return
    const el = containerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [containerHeight, autoScrollToBottom])

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
      data-vl-container=""
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
