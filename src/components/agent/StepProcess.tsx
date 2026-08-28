/**
 * StepProcess — 步骤过程区（推理 + 工具调用的折叠滚动容器）
 *
 * 定位：一个 step 内，连续的「推理块 / 工具卡片」被归为一段"过程"，
 * 统一包进这个可折叠、可滚动的容器里；当结论（assistant content）出现时，
 * 该过程被"打断"，由 AgentPanel 标记 concluded=true → 自动折叠，
 * 让视觉焦点回到结论本身。
 *
 * 折叠策略（优先级从高到低）：
 *  1. 用户手动点过 → 永远尊重用户选择（userExpanded）
 *  2. concluded（本段过程已被结论打断）→ 折叠
 *  3. 其余（过程仍在进行 / 尚未被打断）→ 展开
 *
 * 判断依据是"这段过程有没有被结论打断"这个标记本身，
 * 而不是去推断"是不是还在流式"——后者依赖 assistant.streaming，
 * 而工具消息从不带该标记，会导致工具执行期间被误判为已结束而折叠。
 *
 * 活动态（标签文案 / 是否跟随滚动）从 items 自身推导：
 * 任一推理消息处于 streaming，或存在 running/pending 的工具。
 *
 * 滚动策略：内容增长时贴底（跟随最新），用户手动上翻后停止跟随，
 * 回到底部自动恢复——避免打断阅读。
 *
 * 注意：过程区内的推理块走 bare 模式（自身不限高），
 * 滚动统一由本容器的 body 承担，避免嵌套滚动条。
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { ReasoningBlock } from './ReasoningBlock'
import { ToolCard } from './ToolCard'
import type { Message } from '../../types/agent'

export interface ProcessItem {
  type: 'reasoning' | 'tool'
  msg: Message
}

interface StepProcessProps {
  /** 本段过程包含的推理 / 工具项（按时间顺序） */
  items: ProcessItem[]
  /** 本段过程已被结论打断（后续出现了 assistant content）→ 自动折叠 */
  concluded?: boolean
}

/** 贴底判定容差（px） */
const STICK_THRESHOLD = 24

/** 内容签名：用于 memo 比较与触发重新贴底 */
function signatureOf(items: ProcessItem[]): string {
  return items.map(it =>
    it.type === 'reasoning'
      ? `r${it.msg.id}:${it.msg.reasoning?.length ?? 0}:${it.msg.streaming ? 1 : 0}`
      : `t${it.msg.id}:${it.msg.tool?.status ?? ''}:${it.msg.tool?.name ?? ''}:${it.msg.tool?.result !== undefined ? 1 : 0}`
  ).join('|')
}

function StepProcessInner({ items, concluded }: StepProcessProps) {
  /** null = 用户未手动干预 */
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)

  const expanded = userExpanded ?? !concluded

  const toggle = useCallback(() => {
    // 展开时恢复到"跟随最新"，否则折叠过程中的 scroll 事件会把贴底标记打掉
    if (!expanded) stickToBottomRef.current = true
    setUserExpanded(!expanded)
  }, [expanded])

  // 统计：推理段数 / 工具次数 / 正在执行的工具 / 本段是否仍在活动
  const { reasoningCount, toolCount, runningTool, active } = useMemo(() => {
    let r = 0
    let t = 0
    let running = ''
    let act = false
    for (const it of items) {
      if (it.type === 'reasoning') {
        if (it.msg.reasoning) r++
        if (it.msg.streaming) act = true
      } else {
        t++
        const st = it.msg.tool?.status
        if (st === 'running' || st === 'pending') {
          running = it.msg.tool?.name || ''
          act = true
        }
      }
    }
    return { reasoningCount: r, toolCount: t, runningTool: running, active: act }
  }, [items])

  const signature = useMemo(() => signatureOf(items), [items])

  // 用户手动滚动：更新贴底标记
  const handleScroll = useCallback(() => {
    const el = bodyRef.current
    if (!el) return
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = distanceToBottom < STICK_THRESHOLD
  }, [])

  // 展开时贴底：跟随最新内容，或让用户展开后直接看到最新进度
  // max-height 有过渡动画，clientHeight 逐帧变化，需延到下一帧再计算
  // （过程中 clientHeight 偏小，scrollTop 会被浏览器钳制，动画结束后自动落到正确位置）
  useEffect(() => {
    const el = bodyRef.current
    if (!el || !expanded || !stickToBottomRef.current) return
    const raf = requestAnimationFrame(() => {
      const e = bodyRef.current
      if (!e || !stickToBottomRef.current) return
      e.scrollTop = e.scrollHeight
    })
    return () => cancelAnimationFrame(raf)
  }, [signature, expanded])

  // 标签文案：优先反映"正在做什么"
  const label = active
    ? (runningTool ? `调用 ${runningTool}` : '思考中')
    : '已完成'

  // 统计摘要
  const stats: string[] = []
  if (reasoningCount > 0) stats.push(`推理 ${reasoningCount} 段`)
  if (toolCount > 0) stats.push(`工具 ${toolCount} 次`)

  if (items.length === 0) return null

  return (
    <div className={`agent-step-process ${expanded ? 'agent-step-process--expanded' : ''}`}>
      <div
        className="agent-step-process__head"
        onClick={toggle}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } }}
      >
        <span className="agent-step-process__arrow">{expanded ? '▼' : '▶'}</span>
        <span className="agent-step-process__label">{label}</span>
        <span className="agent-step-process__summary">{stats.join(' · ')}</span>
      </div>

      <div
        className="agent-step-process__body"
        ref={bodyRef}
        onScroll={handleScroll}
      >
        {items.map((item, i) => {
          const key = `${item.type}-${item.msg.id}-${i}`
          if (item.type === 'reasoning') {
            return (
              <ReasoningBlock
                key={key}
                content={item.msg.reasoning || ''}
                streaming={item.msg.streaming}
                bare
              />
            )
          }
          return item.msg.tool
            ? <ToolCard key={key} tool={item.msg.tool} />
            : null
        })}
      </div>
    </div>
  )
}

export const StepProcess = React.memo(StepProcessInner, (prev, next) => {
  return prev.concluded === next.concluded
    && signatureOf(prev.items) === signatureOf(next.items)
})
