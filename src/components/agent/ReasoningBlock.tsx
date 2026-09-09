/**
 * 推理过程折叠块
 *
 * 折叠逻辑：
 *  - forceCollapsed=true → 强制折叠（收到 message.delta 时）
 *  - streaming=true → 展开（推理进行中）
 *  - streaming=false → 折叠（stepEnd 触发，模型调用结束）
 *
 * 滚动逻辑（流式贴底）：
 *  直接设置 <pre>.scrollTop，而不是 scrollIntoView —— 哨兵元素是 <pre> 的兄弟节点，
 *  不在 pre 的滚动祖先链上，scrollIntoView 对它无效。
 *  用户手动上翻时停止跟随，回到底部后恢复跟随（避免打断阅读）。
 *
 * bare 模式：
 *  被 StepProcess 收纳时启用。此时不再渲染自己的折叠头（由外层统一控制），
 *  但保留自身限高滚动——否则单个超长推理块会把过程区撑得极长，
 *  外层滚动条要拖很久才能看到后面的工具卡片。
 *  块内跟随：流式时贴到底部，用户上翻后停止跟随（与外层策略一致）。
 *  块内滚动用 overscroll-behavior: contain 阻断滚动链，避免滚到块底后带着外层一起滚。
 *
 * 显示平滑（仅 bare 流式）：
 *  delta 是 60ms 节流的全量快照，模型一次吐一大段时整段文本会生硬跳变。
 *  内部维护 shown 指针按 rAF 时间步进追赶 content，输出速率向「积压 × CATCHUP」
 *  缓动：上游匀速流时以平均速率连续吐字（稳态落后 ≈ 上游速率 / CATCHUP），
 *  突发大块时速率自动爬升把积压平滑消化再缓落，积压见底仍有 MIN 下限保持
 *  吐字活性。streaming 一翻 false 立即瞬时补齐——思考结束时必须马上呈现
 *  完整内容，动画绝不拖尾巴；数据层不受影响（只影响渲染的尾巴）。
 *
 * 使用 React.memo 避免父组件重渲染时不必要的更新。
 */
import React, { useState, useRef, useEffect, useCallback } from 'react'

interface ReasoningBlockProps {
  content: string
  streaming?: boolean
  /** 强制折叠（收到 message.delta 时置 true） */
  forceCollapsed?: boolean
  /**
   * 裸模式：只渲染文本，不渲染折叠头、不限制高度
   * 用于被 StepProcess 包裹时，滚动与折叠由外层统一接管
   */
  bare?: boolean
}

/** 贴底判定容差（px）：距底部小于此值视为"贴底"，继续自动跟随 */
const STICK_THRESHOLD = 24

/** 平滑吐字速率参数（字符/秒）：目标速率 = 积压 × CATCHUP，夹在 [MIN, MAX]。
 *  CATCHUP 决定稳态落后（≈上游速率/CATCHUP，3 → 上游 300 字/s 时落后约 0.3s）
 *  与突发消化速度（τ ≈ 1/CATCHUP）；MIN 保持积压见底时的吐字活性；MAX 为可读性上限。 */
const SMOOTH_CATCHUP_PER_SEC = 3
const SMOOTH_MIN_RATE = 24
const SMOOTH_MAX_RATE = 480
/** 速率向目标靠拢的每秒缓动系数（τ ≈ 100ms，速率变化本身也要平滑） */
const SMOOTH_RATE_EASE = 10

const ReasoningBlockInner: React.FC<ReasoningBlockProps> = ({ content, streaming, forceCollapsed, bare }) => {
  const [expanded, setExpanded] = useState(false)
  const preRef = useRef<HTMLPreElement>(null)
  const wasStreamingRef = useRef(false)
  const expandedRef = useRef(false)
  /** 是否跟随到底部（用户上翻时置 false，回到底部时恢复 true） */
  const stickToBottomRef = useRef(true)
  /** 程序写入 scrollTop 的标记：自己的写入触发的 scroll 事件只用于消费标记，
   *  不参与贴底判定——否则动画帧间「上次写入的事件 × 刚增长的内容」会算出
   *  假距离把贴底标记误杀成 false，跟随静默停摆（低帧率下必现）。 */
  const programmaticScrollRef = useRef(false)

  /** 程序化贴底：已在底部时跳过（不产生事件、不留悬空标记吞用户滚动） */
  const scrollPreToBottom = useCallback(() => {
    const el = preRef.current
    if (!el) return
    if (el.scrollTop >= el.scrollHeight - el.clientHeight - 0.5) return
    programmaticScrollRef.current = true
    el.scrollTop = el.scrollHeight
  }, [])

  // ─── 显示平滑（仅 bare 流式）：shown 指针按时间步进追赶 content ───
  // 挂载即对齐当前 content（只平滑挂载后的增量，不做整段回放）
  const [shownLen, setShownLen] = useState(content.length)
  const shownLenRef = useRef(content.length)
  /** 当前输出速率（字符/秒），跨 delta 保持——突发结束后从既有速率缓落，不回零重启 */
  const smoothRateRef = useRef(SMOOTH_MIN_RATE)
  const smoothRafRef = useRef(0)

  // 同步 expanded state 到 ref
  const setExpandedSync = (v: boolean) => {
    expandedRef.current = v
    setExpanded(v)
  }

  // 用户手动滚动：更新贴底标记
  const handleScroll = useCallback(() => {
    const el = preRef.current
    if (!el) return
    if (programmaticScrollRef.current) {
      programmaticScrollRef.current = false
      return
    }
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = distanceToBottom < STICK_THRESHOLD
  }, [])

  // 流式时贴底：内容增长后把滚动容器推到最新位置
  // bare 模式下也启用 —— 块自身限高滚动，跟随最新推理内容
  useEffect(() => {
    if (!streaming || !stickToBottomRef.current) return
    // 非 bare 才要求已展开；bare 恒为展开（且挂载序上 expandedRef 可能尚未同步）
    if (!bare && !expandedRef.current) return
    scrollPreToBottom()
  }, [content, streaming, bare, scrollPreToBottom])

  // 平滑吐字动画（自适应速率）：流式期间持续 rAF，每帧先按积压算目标速率并缓动
  // 当前速率，再按 dt 步进 shown 指针（小数进位累计，逐字吐出）。积压见底时速率
  // 继续向 MIN 缓落而非停摆，下个突发从既有速率起步，观感连续。
  // streaming=false（flush 采纳/停止/历史回放）立即瞬时补齐并停帧——思考一结束
  // 就必须呈现完整内容，动画不拖尾巴。
  useEffect(() => {
    if (!bare) return
    if (!streaming) {
      cancelAnimationFrame(smoothRafRef.current)
      if (shownLenRef.current !== content.length) {
        shownLenRef.current = content.length
        setShownLen(content.length)
      }
      return
    }
    let carry = 0
    let last = 0
    const tick = (now: number) => {
      if (!last) last = now
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const backlog = content.length - shownLenRef.current
      const targetRate = Math.min(SMOOTH_MAX_RATE, Math.max(SMOOTH_MIN_RATE, Math.max(0, backlog) * SMOOTH_CATCHUP_PER_SEC))
      smoothRateRef.current += (targetRate - smoothRateRef.current) * Math.min(1, dt * SMOOTH_RATE_EASE)
      if (backlog > 0) {
        carry += smoothRateRef.current * dt
        const take = Math.min(backlog, Math.floor(carry))
        if (take > 0) {
          carry -= take
          shownLenRef.current += take
          setShownLen(shownLenRef.current)
          if (stickToBottomRef.current) scrollPreToBottom()
        }
      }
      smoothRafRef.current = requestAnimationFrame(tick)
    }
    cancelAnimationFrame(smoothRafRef.current)
    smoothRafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(smoothRafRef.current)
  }, [bare, content, streaming, scrollPreToBottom])

  // 折叠/展开逻辑（bare 模式下由外层接管折叠，跳过内部状态机）
  useEffect(() => {
    if (bare) {
      // 外层已展开本块，同步为"展开"以启用块内贴底跟随
      expandedRef.current = true
      return
    }
    if (forceCollapsed) {
      // 收到 message.delta → 强制折叠推理卡片
      setExpandedSync(false)
      return
    }
    if (streaming) {
      if (!wasStreamingRef.current) {
        // 新一轮推理开始：重置为跟随底部
        stickToBottomRef.current = true
      }
      setExpandedSync(true)
      wasStreamingRef.current = true
    } else if (wasStreamingRef.current) {
      // assistant/chunk finish → stepEnd → streaming 变为 false → 折叠
      setExpandedSync(false)
      wasStreamingRef.current = false
    }
  }, [streaming, forceCollapsed, bare])

  if (!content) return null

  // ─── 裸模式：只输出文本（shown 指针截断做平滑），折叠与滚动交给 StepProcess ───
  if (bare) {
    return (
      <pre
        ref={preRef}
        className="reasoning-block__text reasoning-block__text--bare"
        onScroll={handleScroll}
      >{content.slice(0, shownLen)}</pre>
    )
  }

  // 流式时显示最后一行预览，折叠时显示行数
  const lines = content.split('\n')
  const preview = streaming ? lines[lines.length - 1] || '' : `${lines.length} 行推理`

  // 使用类似 ToolCard 的样式结构
  const statusClass = streaming ? 'tool-card--running' : 'tool-card--success'

  return (
    <div className={`tool-card ${statusClass}`}>
      <div
        className="tool-card__head"
        onClick={() => setExpandedSync(!expandedRef.current)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpandedSync(!expandedRef.current) }}
      >
        <span className="tool-card__name">推理</span>
        <span className="tool-card__summary">{streaming ? '思考中...' : preview}</span>
        <span className="tool-card__status-dot"></span>
        <span className="tool-card__arrow">{expandedRef.current ? '▼' : '▶'}</span>
      </div>

      <div className={`reasoning-block__details ${expandedRef.current ? 'reasoning-block__details--expanded' : ''}`}>
        <pre
          ref={preRef}
          className="reasoning-block__text"
          onScroll={handleScroll}
        >{content}</pre>
      </div>
    </div>
  )
}

export const ReasoningBlock = React.memo(ReasoningBlockInner, (prev, next) => {
  return prev.content === next.content
    && prev.streaming === next.streaming
    && prev.forceCollapsed === next.forceCollapsed
    && prev.bare === next.bare
})
