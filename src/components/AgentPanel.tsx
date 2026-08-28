/**
 * AgentPanel - Agent 聊天面板
 *
 * 纯 UI 层，所有核心处理由 DSH 内核完成
 * 通过 DSH RPC 通信：session.create / session.prompt / session.history
 *
 * 性能优化：
 *  - 虚拟滚动：只渲染可视区域附近的消息节点
 *  - React.memo：所有子组件按需更新
 *  - useMemo：step 分组逻辑缓存
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Icon } from './icons/Icon'
import { useEditorStore } from '../stores/editorStore'
import { agentService } from '../editor/AgentService'
import { pluginService } from '../editor/PluginService'
import { MessageBubble } from './agent/MessageBubble'
import { StepProcess, type ProcessItem } from './agent/StepProcess'
import { ThinkingCard } from './agent/ThinkingCard'
import { InputBox } from './agent/InputBox'
import { ConnectionIndicator } from './agent/ConnectionIndicator'
import { ToolCard } from './agent/ToolCard'
import { SessionSidebar } from './agent/SessionSidebar'
import { PluginControlCenter } from './PluginControlCenter'
import { useTypewriter } from './agent/useTypewriter'
import { VirtualList } from './agent/VirtualList'
import type { Message, ConnectionState, ToolState, SessionInfo, PendingQuestionRequest, QuestionAnswer, RetryAttempt } from '../types/agent'
import { QuestionCard } from './agent/QuestionCard'
import { ModelSelector } from './agent/ModelSelector'
import { SettingsPanel } from './agent/SettingsPanel'

/** step 子项：可辨识联合，便于按 type 收窄 */
type StepItem =
  | { type: 'reasoning'; msg: Message }
  | { type: 'tool'; msg: Message }
  | { type: 'message'; msg: Message }

// ─── 渲染节点类型（虚拟列表的 item） ───
interface RenderNode {
  key: string
  kind: 'user' | 'system' | 'step'
  /** step 容器包含的子项 */
  stepItems?: StepItem[]
  /** 单条消息（user/system） */
  msg?: Message
}

interface QueuedAssistant {
  kind: 'assistant'
  id: string
  content: string
  reasoning?: string
  stats?: any
  turnCompleted?: boolean
  turnEndReason?: any
}

interface QueuedTool {
  kind: 'tool'
  id: string
}

interface QueuedRetry {
  kind: 'retry'
  id: string
}

type DisplayQueueItem = QueuedAssistant | QueuedTool | QueuedRetry

export const AgentPanel: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'sys-0',
      role: 'system',
      content: 'DSH Agent 已就绪。正在自动连接...',
      ts: Date.now()
    }
  ])
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle')
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [showSidebar, setShowSidebar] = useState(false)
  const [showPluginCenter, setShowPluginCenter] = useState(false)
  const [pluginStats, setPluginStats] = useState({ total: 0, active: 0 })
  const [pendingQuestions, setPendingQuestions] = useState<PendingQuestionRequest[]>([])
  const [showSettings, setShowSettings] = useState(false)
  // 头部右侧「更多」下拉菜单（插件控制中心 / 设置）
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false)
  const headerMenuRef = useRef<HTMLDivElement>(null)

  // 点击菜单外部时关闭
  useEffect(() => {
    if (!headerMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target as Node)) {
        setHeaderMenuOpen(false)
      }
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [headerMenuOpen])
  const [currentModel, setCurrentModel] = useState<{ provider: string; model: string } | undefined>(undefined)
  const [isAgentRunning, setIsAgentRunning] = useState(false) // AI 是否正在运行
  // 完整消息提交后递增，用于触发列表自动滚动
  const [contentVersion, setContentVersion] = useState(0)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const scrollToBottomRef = useRef<(behavior?: ScrollBehavior) => void>(() => {})

  // 按 assistant 段 / tool 段排队显示；打字机只消费当前段，永远不会跨段复用内容。
  const typewriter = useTypewriter({ baseSpeed: 40, maxSpeed: 300, acceleration: 0.8 })
  const reasoningTypewriter = useTypewriter({ baseSpeed: 40, maxSpeed: 300, acceleration: 0.8 })
  const displayQueueRef = useRef<DisplayQueueItem[]>([])
  const activeDisplayRef = useRef<DisplayQueueItem | null>(null)
  const displayPhaseRef = useRef<'reasoning' | 'content' | null>(null)
  const messageSequenceRef = useRef(0)
  const pendingToolStatesRef = useRef(new Map<string, ToolState>())
  const displayedToolIdsRef = useRef(new Set<string>())
  const pendingRetryChainsRef = useRef(new Map<string, RetryAttempt[]>())
  const displayedRetryIdsRef = useRef(new Set<string>())
  const pendingTurnSystemRef = useRef<string | null>(null)
  const drainQueueRef = useRef<() => void>(() => {})

  const {
    addConsoleOutput,
    setAgentConnected,
    setAgentConnecting
  } = useEditorStore()

  // Keep the model selector callback stable. ModelSelector refreshes its model
  // directory through an effect that depends on this callback; an inline
  // callback here would therefore cause a refresh loop after every response.
  const handleModelChange = useCallback((provider: string, model: string) => {
    setCurrentModel(previous => (
      previous?.provider === provider && previous.model === model
        ? previous
        : { provider, model }
    ))
  }, [])

  // 刷新会话列表
  const refreshSessions = useCallback(async () => {
    if (agentService.isConnected()) {
      const list = await agentService.listSessions()
      setSessions(list)
    }
  }, [])

  // 初始化插件状态
  useEffect(() => {
    const stats = pluginService.getStats()
    setPluginStats(stats)
    
    const unsubPlugins = pluginService.onPluginsChange(() => {
      setPluginStats(pluginService.getStats())
    })
    
    return unsubPlugins
  }, [])

  // 初始化服务
  useEffect(() => {
    const unsubState = agentService.onStateChange((state) => {
      setConnectionState(state)
      setAgentConnected(state === 'connected')
      setAgentConnecting(state === 'connecting')
    })

    const unsubEvent = agentService.onEvent((event) => {
      switch (event.type) {
        case 'message': {
          const p = event.payload as any
          if (p?.role === 'assistant') {
            commitStreamingMessage(p.content || '', p.reasoning, p.stats, p.turnCompleted, p.turnEndReason)
          }
          break
        }

        case 'turnStart':
          // 回合开始（可用于 UI 状态指示）
          break

        case 'turnEnd': {
          setIsAgentRunning(false) // turn 结束，AI 不再运行
          const turnPayload = event.payload as any
          if (turnPayload?.reason?.kind !== 'completed') {
            // 非正常结束的回合显示系统消息
            const reasonMap: Record<string, string> = {
              error: `回合错误: ${turnPayload?.reason?.error?.message || '未知错误'}`,
              aborted: '回合被中止',
              blocked: '回合被阻塞',
              'max-tokens': '输出达到 token 上限',
              interrupted: '回合被中断',
            }
            // 等当前 assistant 段打字完成后再显示结束提示，避免系统消息插队。
            pendingTurnSystemRef.current = reasonMap[turnPayload?.reason?.kind] || '回合异常结束'
            drainQueueRef.current()
          }
          break
        }

        case 'stepStart':
          // 步骤开始（可用于进度指示）
          break

        case 'toolCall':
          handleToolCall(event.payload as any)
          break

        case 'toolResult':
          handleToolResult(event.payload as any)
          break

        case 'toolDispatchStart': {
          const dispatch = event.payload as any
          pushSystem(`子工具调用: ${dispatch?.name || 'unknown'}`)
          break
        }

        case 'toolDispatch': {
          const dispatch = event.payload as any
          if (dispatch?.isError) {
            pushSystem(`子工具失败: ${dispatch?.name || 'unknown'}`)
          }
          break
        }

        case 'retryScheduled': {
          handleRetryScheduled(event.payload as any)
          break
        }

        case 'retryStarted': {
          handleRetryStarted(event.payload as any)
          break
        }

        case 'commandRun': {
          const cmd = event.payload as any
          pushSystem(`执行命令: /${cmd?.name || 'unknown'}${cmd?.args || ''}`)
          break
        }

        case 'commandDone': {
          const cmd = event.payload as any
          if (cmd?.kind === 'error') {
            pushSystem(`命令失败: /${cmd?.name || 'unknown'}`)
          }
          break
        }

        case 'compactionStart':
          pushSystem('上下文压缩开始...')
          break

        case 'compactionSummary': {
          const compact = event.payload as any
          const items = compact?.shadowedItemCount
          const tokens = compact?.shadowedTokenCount
          let msg = '上下文压缩完成'
          if (items) msg += ` (${items} 条消息`
          if (tokens) msg += `, ${tokens} tokens`
          if (items) msg += ')'
          pushSystem(msg)
          break
        }

        case 'compactionEnd':
          // 压缩结束（已在 summary 中处理）
          break

        case 'todoWrite': {
          const todoPayload = event.payload as any
          const todos = todoPayload?.todos ?? []
          const pending = todos.filter((t: any) => t.status === 'pending').length
          const inProgress = todos.filter((t: any) => t.status === 'in_progress').length
          const completed = todos.filter((t: any) => t.status === 'completed').length
          pushSystem(`任务列表更新: ${inProgress} 进行中, ${pending} 待办, ${completed} 已完成`)
          break
        }

        case 'requestHeader': {
          const header = event.payload as any
          if (header?.reason === 'change') {
            pushSystem(`模型切换: ${header?.model || '未知'}`)
          }
          break
        }

        case 'sandboxMode': {
          const sandbox = event.payload as any
          pushSystem(`沙箱模式: ${sandbox?.mode || '未知'}`)
          break
        }

        case 'planMode': {
          const plan = event.payload as any
          pushSystem(plan?.active ? '已进入计划模式' : '已退出计划模式')
          break
        }

        case 'questionRequest': {
          const req = event.payload as PendingQuestionRequest
          setPendingQuestions(prev => {
            if (prev.some(q => q.rpcId === req.rpcId)) return prev
            return [...prev, req]
          })
          break
        }

        case 'questionResolved': {
          const { rpcId } = event.payload as { rpcId: string }
          setPendingQuestions(prev => prev.filter(q => q.rpcId !== rpcId))
          break
        }

        case 'error':
          pushSystem(`错误: ${(event.payload as any)?.message || '未知错误'}`)
          break

        case 'ready': {
          const payload = event.payload as any
          if (payload?.restored) {
            // 刷新/重启后的无感接续：提示在 history 整体替换完成后再入列，
            // 避免被 restoreHistory 内部 setMessages 覆盖丢失
            void restoreHistory().then(() => pushSystem('会话已恢复'))
          } else if (payload?.recovered) {
            void restoreHistory().then(() => pushSystem('已自动重连到 DSH Agent，正在恢复对话...'))
          } else {
            pushSystem('已连接到 DSH Agent')
          }
          refreshSessions()
          break
        }

        case 'closed':
          pushSystem('与 DSH Agent 的连接已断开')
          break
      }
    })

    const autoConnect = async () => {
      try {
        await agentService.connect()
        addConsoleOutput('[Agent] 已自动连接到 DSH Agent')
      } catch {
        // 连接失败不提示，用户可手动重试
      }
    }

    const currentState = agentService.getState()
    setConnectionState(currentState)
    if (currentState === 'idle') {
      autoConnect()
    } else if (currentState === 'connected') {
      // HMR 后 AgentService 存活且已连接 → 从 DSH 恢复历史消息
      restoreHistory()
    }

    return () => {
      unsubState()
      unsubEvent()
    }
  }, [])

  // 当前 assistant 段的正文更新：只写入当前队列项，避免旧消息收到新回调。
  const handleContentUpdate = useCallback((content: string) => {
    const active = activeDisplayRef.current
    if (!active || active.kind !== 'assistant' || displayPhaseRef.current !== 'content') return
    setMessages(cur => cur.map(message => message.id === active.id ? { ...message, content } : message))
    setContentVersion(v => v + 1)
  }, [])

  const handleNearBottomChange = useCallback((nearBottom: boolean) => {
    setShowScrollToBottom(!nearBottom)
  }, [])

  const handleScrollToBottomReady = useCallback((scrollToBottom: (behavior?: ScrollBehavior) => void) => {
    scrollToBottomRef.current = scrollToBottom
  }, [])

  const handleScrollToBottom = useCallback(() => {
    scrollToBottomRef.current('smooth')
  }, [])

  // 当前 assistant 段的推理更新。
  const handleReasoningUpdate = useCallback((reasoning: string) => {
    const active = activeDisplayRef.current
    if (!active || active.kind !== 'assistant' || displayPhaseRef.current !== 'reasoning') return
    setMessages(cur => cur.map(message => message.id === active.id ? { ...message, reasoning } : message))
    setContentVersion(v => v + 1)
  }, [])

  // 当前 assistant 段完成后，释放队首，允许工具卡片或下一段 assistant 继续显示。
  const finishAssistantDisplay = useCallback(() => {
    const active = activeDisplayRef.current
    if (!active || active.kind !== 'assistant') return
    const completed = active
    activeDisplayRef.current = null
    displayPhaseRef.current = null
    setMessages(cur => cur.map(message => message.id === completed.id ? {
      ...message,
      content: completed.content,
      reasoning: completed.reasoning,
      streaming: false,
      turnCompleted: completed.turnCompleted || false,
      turnEndReason: completed.turnEndReason,
      stats: completed.stats,
    } : message))
    setContentVersion(v => v + 1)
    drainQueueRef.current()
  }, [])

  // 推理打完后继续打正文；没有正文时直接完成当前 assistant 段。
  const handleReasoningComplete = useCallback(() => {
    const active = activeDisplayRef.current
    if (!active || active.kind !== 'assistant' || displayPhaseRef.current !== 'reasoning') return
    if (!active.content) {
      finishAssistantDisplay()
      return
    }
    displayPhaseRef.current = 'content'
    typewriter.reset()
    typewriter.setFull(active.content)
  }, [finishAssistantDisplay, typewriter.reset, typewriter.setFull])

  const handleContentComplete = useCallback(() => {
    if (displayPhaseRef.current !== 'content') return
    finishAssistantDisplay()
  }, [finishAssistantDisplay])

  // 只在挂载时把两个打字机绑定到当前队列项。
  useEffect(() => {
    typewriter.onUpdate(handleContentUpdate)
    typewriter.onComplete(handleContentComplete)
    reasoningTypewriter.onUpdate(handleReasoningUpdate)
    reasoningTypewriter.onComplete(handleReasoningComplete)
  }, [
    handleContentComplete,
    handleContentUpdate,
    handleReasoningComplete,
    handleReasoningUpdate,
    reasoningTypewriter.onComplete,
    reasoningTypewriter.onUpdate,
    typewriter.onComplete,
    typewriter.onUpdate,
  ])

  // 消费一个按事件顺序排列的显示项。assistant 需要等待打字机完成，
  // tool 则在队列轮到它时立即落地；因此工具不会打断前一段正文。
  const drainDisplayQueue = useCallback(() => {
    if (activeDisplayRef.current || displayQueueRef.current.length === 0) {
      if (!activeDisplayRef.current && displayQueueRef.current.length === 0 && pendingTurnSystemRef.current) {
        const content = pendingTurnSystemRef.current
        pendingTurnSystemRef.current = null
        setMessages(cur => [...cur, {
          id: `s-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          role: 'system' as const,
          content,
          ts: Date.now(),
        }])
        setContentVersion(v => v + 1)
      }
      return
    }

    const next = displayQueueRef.current.shift()!
    activeDisplayRef.current = next

    if (next.kind === 'retry') {
      const retries = pendingRetryChainsRef.current.get(next.id)
      if (retries && retries.length > 0) {
        displayedRetryIdsRef.current.add(next.id)
        const last = retries[retries.length - 1]
        setMessages(cur => [...cur, {
          id: `r-${next.id}`,
          role: 'retry' as const,
          content: `${retries.length} 次重试`,
          retries: [...retries],
          ts: last?.time ?? Date.now(),
        }])
        setContentVersion(v => v + 1)
      }
      activeDisplayRef.current = null
      drainQueueRef.current()
      return
    }

    if (next.kind === 'tool') {
      const tool = pendingToolStatesRef.current.get(next.id)
      if (tool) {
        displayedToolIdsRef.current.add(next.id)
        setMessages(cur => {
          const index = cur.findIndex(message => message.role === 'tool' && message.tool?.id === next.id)
          if (index !== -1) {
            const updated = cur.slice()
            updated[index] = { ...updated[index], tool }
            return updated
          }
          return [...cur, { id: `t-${next.id}`, role: 'tool' as const, content: '', tool, ts: Date.now() }]
        })
        setContentVersion(v => v + 1)
      }
      activeDisplayRef.current = null
      drainQueueRef.current()
      return
    }

    setMessages(cur => [...cur, {
      id: next.id,
      role: 'assistant' as const,
      content: '',
      reasoning: '',
      streaming: true,
      ts: Date.now(),
    }])
    setContentVersion(v => v + 1)

    if (next.reasoning) {
      displayPhaseRef.current = 'reasoning'
      reasoningTypewriter.reset()
      reasoningTypewriter.setFull(next.reasoning)
    } else if (next.content) {
      displayPhaseRef.current = 'content'
      typewriter.reset()
      typewriter.setFull(next.content)
    } else {
      finishAssistantDisplay()
    }
  }, [
    finishAssistantDisplay,
    reasoningTypewriter.reset,
    reasoningTypewriter.setFull,
    typewriter.reset,
    typewriter.setFull,
  ])

  useEffect(() => {
    drainQueueRef.current = drainDisplayQueue
  }, [drainDisplayQueue])

  // 提交一个已收集完成的 assistant 段，显示顺序由队列统一控制。
  const commitStreamingMessage = useCallback((text: string, reasoning?: string, stats?: any, turnCompleted?: boolean, turnEndReason?: any) => {
    messageSequenceRef.current += 1
    displayQueueRef.current.push({
      kind: 'assistant',
      id: `a-${Date.now()}-${messageSequenceRef.current}`,
      content: text,
      reasoning,
      stats,
      turnCompleted,
      turnEndReason,
    })
    drainQueueRef.current()
  }, [])

  // 收到工具事件时只入队，不直接插入 DOM，确保前面的 assistant 打完后再出现。
  const handleToolCall = useCallback((payload: {
    id: string
    name: string
    args: unknown
    status: 'pending' | 'running'
  }) => {
    pendingToolStatesRef.current.set(payload.id, {
      id: payload.id,
      name: payload.name,
      args: payload.args,
      status: payload.status,
    })
    if (displayedToolIdsRef.current.has(payload.id)) return
    if (!displayQueueRef.current.some(item => item.kind === 'tool' && item.id === payload.id)) {
      displayQueueRef.current.push({ kind: 'tool', id: payload.id })
    }
    drainQueueRef.current()
  }, [])

  const handleRetryScheduled = useCallback((payload: Partial<RetryAttempt> & { retryId?: string }) => {
    const retryId = payload.retryId || `retry-${Date.now()}`
    const current = pendingRetryChainsRef.current.get(retryId) ?? []
    const attempt: RetryAttempt = {
      retry: payload.retry ?? current.length + 1,
      retryState: 'scheduled',
      turn: payload.turn ?? 0,
      step: payload.step ?? 0,
      reason: payload.reason,
      delayMs: payload.delayMs,
      seq: payload.seq ?? 0,
      time: payload.time ?? Date.now(),
    }
    const chain = [...current, attempt]
    pendingRetryChainsRef.current.set(retryId, chain)

    if (displayedRetryIdsRef.current.has(retryId)) {
      setMessages(cur => cur.map(message => message.id === `r-${retryId}`
        ? { ...message, content: `${chain.length} 次重试`, retries: [...chain] }
        : message))
      setContentVersion(v => v + 1)
      return
    }

    if (!displayQueueRef.current.some(item => item.kind === 'retry' && item.id === retryId)) {
      displayQueueRef.current.push({ kind: 'retry', id: retryId })
    }
    drainQueueRef.current()
  }, [])

  const handleRetryStarted = useCallback((payload: { retryId?: string; retry?: number }) => {
    const retryId = payload.retryId
    if (!retryId) return
    const chain = pendingRetryChainsRef.current.get(retryId)
    if (!chain || chain.length === 0) return
    const updated = chain.slice()
    for (let i = updated.length - 1; i >= 0; i--) {
      if (payload.retry === undefined || updated[i].retry === payload.retry) {
        updated[i] = { ...updated[i], retryState: 'started' }
        break
      }
    }
    pendingRetryChainsRef.current.set(retryId, updated)
    if (displayedRetryIdsRef.current.has(retryId)) {
      setMessages(cur => cur.map(message => message.id === `r-${retryId}`
        ? { ...message, retries: [...updated] }
        : message))
      setContentVersion(v => v + 1)
    }
  }, [])

  // 处理工具结果
  const handleToolResult = useCallback((payload: {
    id: string
    name: string
    result: unknown
    status: 'success' | 'failure'
  }) => {
    console.log('[AgentPanel] toolResult, tool:', payload.name, 'status:', payload.status)
    const previous = pendingToolStatesRef.current.get(payload.id)
    pendingToolStatesRef.current.set(payload.id, {
      id: payload.id,
      name: payload.name,
      args: previous?.args,
      result: payload.result,
      status: payload.status,
      error: previous?.error,
    })
    setMessages((cur) => {
      const idx = cur.findIndex((m) => m.role === 'tool' && m.tool?.id === payload.id)
      if (idx === -1) return cur
      const next = cur.slice()
      next[idx] = {
        ...next[idx],
        tool: {
          ...next[idx].tool!,
          id: payload.id,
          name: payload.name,
          result: payload.result,
          status: payload.status
        }
      }
      return next
    })
    // 触发自动滚动（工具结果更新聚合在 step 节点内，items.length 不变）
    setContentVersion(v => v + 1)
  }, [])

  // 添加系统消息
  const pushSystem = useCallback((content: string) => {
    setMessages((m) => [...m, {
      id: `s-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: 'system',
      content,
      ts: Date.now()
    }])
  }, [])

  const clearDisplayQueue = useCallback(() => {
    displayQueueRef.current = []
    activeDisplayRef.current = null
    displayPhaseRef.current = null
    pendingToolStatesRef.current.clear()
    displayedToolIdsRef.current.clear()
    pendingRetryChainsRef.current.clear()
    displayedRetryIdsRef.current.clear()
    pendingTurnSystemRef.current = null
    typewriter.reset()
    reasoningTypewriter.reset()
  }, [reasoningTypewriter.reset, typewriter.reset])

  // 连接到 DSH
  const handleConnect = useCallback(async () => {
    try {
      addConsoleOutput('[Agent] 正在连接...')
      await agentService.connect()
      addConsoleOutput('[Agent] 已连接')
      refreshSessions()
    } catch (error) {
      const message = error instanceof Error ? error.message : '连接失败'
      addConsoleOutput(`[Agent] 连接失败: ${message}`)
    }
  }, [addConsoleOutput, refreshSessions])

  // 从 DSH 恢复历史消息（HMR / 重连后调用）
  const restoreHistory = useCallback(async () => {
    try {
      const history = await agentService.loadHistory()
      if (!history.length) return
      const restored: Message[] = history.map((h, i) => {
        // 将特殊 role 映射为 system 消息，保留原始数据
        const role = (h.role === 'tool' || h.role === 'command' || h.role === 'compaction' ||
          h.role === 'retry' || h.role === 'turn-error' || h.role === 'turn-max-tokens' ||
          h.role === 'todo' || h.role === 'request-header')
          ? h.role as any
          : h.role
        return {
          id: `hist-${i}-${h.ts || Date.now()}`,
          role,
          content: h.content,
          reasoning: h.reasoning,
          turnCompleted: h.turnCompleted,
          turnEndReason: h.turnEndReason,
          tool: h.tool,
          command: h.command,
          compaction: h.compaction,
          retries: h.retries,
          todos: h.todos,
          requestHeader: h.requestHeader,
          ts: h.ts || Date.now(),
        }
      })
      setMessages([
        { id: 'sys-0', role: 'system', content: '对话已恢复', ts: Date.now() },
        ...restored,
      ])
      console.log(`[AgentPanel] 已恢复 ${restored.length} 条历史消息`)
    } catch (err) {
      console.warn('[AgentPanel] 恢复历史失败:', err)
    }
  }, [])

  // 断开连接
  const handleDisconnect = useCallback(() => {
    agentService.disconnect()
    addConsoleOutput('[Agent] 已断开连接')
  }, [addConsoleOutput])

  // 手动重启 agent（degraded 终态恢复入口：main 重置自愈计数后重新引导）
  const handleRestartAgent = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.dshRestart || !api.dshStatus) {
      addConsoleOutput('[Agent] 当前环境不支持 agent 重启（浏览器模式）')
      return
    }
    addConsoleOutput('[Agent] 正在手动重启 agent...')
    try {
      await api.dshRestart()
      addConsoleOutput('[Agent] 重启指令已下发，等待就绪后自动重连')
    } catch (err) {
      console.error('[AgentPanel] 手动重启 agent 失败:', err)
      addConsoleOutput(`[Agent] 重启失败: ${String(err)}`)
      return
    }

    // 轮询 lifecycle 直至就绪（spawn 冷启动上限约 30s，留足余量）后自动重连
    const deadline = Date.now() + 90000
    const poll = window.setInterval(async () => {
      try {
        const status = await api.dshStatus()
        if (status?.ready && (status.lifecycle === 'running' || status.lifecycle === 'claimed')) {
          window.clearInterval(poll)
          await agentService.connect()
          refreshSessions()
          addConsoleOutput('[Agent] Agent 已恢复运行')
        } else if (Date.now() > deadline) {
          window.clearInterval(poll)
          addConsoleOutput('[Agent] 等待 agent 恢复超时，可再次点击状态指示器重试')
        }
      } catch { /* 瞬时查询失败忽略 */ }
    }, 1000)
  }, [addConsoleOutput, refreshSessions])

  // 发送消息（AI 运行中自动使用 steer 引导）
  const handleSend = useCallback(async (text: string) => {
    const isRunning = agentService.isRunning()
    console.log(`[AgentPanel] handleSend: text="${text}", isRunning=${isRunning}`)
    
    try {
      setMessages(prev => [...prev, {
        id: `u-${Date.now()}`,
        role: 'user',
        content: text,
        ts: Date.now()
      }])
      
      if (isRunning) {
        // AI 正在运行，使用 steer 引导
        console.log(`[AgentPanel] 使用 steer 引导 AI`)
        addConsoleOutput(`[Agent] 引导 AI: ${text}`)
        await agentService.steer(text)
        // steer 同样会进入等待期：本轮尚未有输出时显示思考卡片
        setIsAgentRunning(true)
      } else {
        // AI 空闲，正常发送
        console.log(`[AgentPanel] 正常发送消息`)
        setIsAgentRunning(true) // AI 开始运行
        await agentService.send(text)
        addConsoleOutput(`[Agent] 发送消息: ${text}`)
      }
      refreshSessions()
    } catch (error) {
      setIsAgentRunning(false) // 出错时停止
      console.error(`[AgentPanel] 发送失败:`, error)
      pushSystem(`发送失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [addConsoleOutput, pushSystem, refreshSessions])

  // 停止 AI
  const handleStop = useCallback(async () => {
    console.log(`[AgentPanel] handleStop: 点击停止按钮`)
    try {
      setIsAgentRunning(false) // 立即更新 UI 状态
      await agentService.stop()
      addConsoleOutput('[Agent] 已停止 AI')
    } catch (error) {
      console.error(`[AgentPanel] 停止失败:`, error)
      pushSystem(`停止失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [addConsoleOutput, pushSystem])

  // 切换会话
  const handleSwitchSession = useCallback(async (sessionId: string) => {
    console.log('[AgentPanel] 切换会话:', sessionId)
    clearDisplayQueue()
    await agentService.switchSession(sessionId)
    setPendingQuestions([]) // 清除旧会话的 pending questions
    
    // 加载历史消息
    console.log('[AgentPanel] 开始加载历史消息')
    const history = await agentService.loadHistory()
    console.log('[AgentPanel] 历史消息数量:', history.length)
    if (history.length > 0) {
      const historyMessages: Message[] = history.map((msg, i) => ({
        id: `hist-${sessionId}-${i}`,
        role: msg.role as any,
        content: msg.content,
        reasoning: msg.reasoning,
        turnCompleted: msg.turnCompleted,
        turnEndReason: msg.turnEndReason,
        tool: msg.tool,
        command: msg.command,
        compaction: msg.compaction,
        retries: msg.retries,
        todos: msg.todos,
        requestHeader: msg.requestHeader,
        ts: msg.ts || Date.now(),
      }))
      setMessages(historyMessages)
    } else {
      setMessages([{
        id: `sys-${Date.now()}`,
        role: 'system',
        content: `已切换到会话 ${sessionId.slice(0, 12)}...`,
        ts: Date.now()
      }])
    }
    
    setShowSidebar(false)
  }, [clearDisplayQueue])

  // 新建会话
  const handleNewSession = useCallback(async () => {
    clearDisplayQueue()
    const sid = await agentService.createSession()
    if (sid) {
      setMessages([{
        id: `sys-${Date.now()}`,
        role: 'system',
        content: '新会话已创建',
        ts: Date.now()
      }])
      refreshSessions()
      setShowSidebar(false)
    }
  }, [clearDisplayQueue, refreshSessions])

  // 删除会话（远程归档 + 本地黑名单，确保不会被 refreshSessions 拉回）
  const handleDeleteSession = useCallback(async (sessionId: string) => {
    await agentService.deleteSession(sessionId)
    refreshSessions()
    if (agentService.getSessionId() === null) {
      setMessages([{
        id: `sys-${Date.now()}`,
        role: 'system',
        content: '会话已删除，请新建会话或切换到其他会话',
        ts: Date.now()
      }])
    }
  }, [refreshSessions])

  // ─── 问答交互 ───
  const handleQuestionAnswer = useCallback(async (rpcId: string, answer: QuestionAnswer) => {
    const ok = await agentService.answerQuestion(rpcId, answer)
    if (ok) {
      setPendingQuestions(prev => prev.filter(q => q.rpcId !== rpcId))
      pushSystem('已提交回答')
    } else {
      pushSystem('回答提交失败')
    }
  }, [pushSystem])

  const handleQuestionCancel = useCallback(async (rpcId: string) => {
    const ok = await agentService.cancelQuestion(rpcId)
    if (ok) {
      setPendingQuestions(prev => prev.filter(q => q.rpcId !== rpcId))
      pushSystem('已取消问题')
    }
  }, [pushSystem])

  // ─── 等待态：AI 已开始运行，但本轮尚未产出任何实质内容 ───
  // 用户发出消息后到首个 token（reasoning / tool / content）到达之间有一段空窗，
  // 此时没有任何可渲染节点，界面看起来"没反应" → 显示思考中卡片。
  // 一旦有任何 assistant/tool 输出，该条件立即为 false，卡片自动隐藏。
  const awaitingFirstOutput = useMemo(() => {
    if (!isAgentRunning) return false
    // 只看「本轮」：最后一条用户消息之后是否已有任何输出。
    // 不能用全局 some()——历史轮次的输出会让后续每一轮都判定为"已产出"，卡片永远不再出现。
    let start = 0
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { start = i + 1; break }
    }
    for (let i = start; i < messages.length; i++) {
      const m = messages[i]
      if ((m.role === 'assistant' && (m.reasoning || m.content)) || m.role === 'tool') return false
    }
    return true
  }, [isAgentRunning, messages])

  // ─── 将原始 messages 聚合成渲染节点（memoize，仅 messages 变化时重算） ───
  const renderNodes = useMemo((): RenderNode[] => {
    const nodes: RenderNode[] = []
    let i = 0

    while (i < messages.length) {
      const msg = messages[i]

      // 用户 / 系统消息 → 独立节点
      if (msg.role === 'user' || msg.role === 'system') {
        nodes.push({ key: msg.id, kind: msg.role, msg })
        i++
        continue
      }

      // 特殊消息类型（命令、压缩、重试、错误等）→ 独立系统节点
      if (msg.role === 'command' || msg.role === 'compaction' || msg.role === 'retry' ||
          msg.role === 'turn-error' || msg.role === 'turn-max-tokens' ||
          msg.role === 'todo' || msg.role === 'request-header') {
        nodes.push({ key: msg.id, kind: 'system', msg })
        i++
        continue
      }

      // assistant 消息 → 收集连续的 assistant/tool 组成一个 step
      if (msg.role === 'assistant') {
        const stepItems: RenderNode['stepItems'] = []
        let currentIdx = i

        while (currentIdx < messages.length) {
          const cur = messages[currentIdx]
          if (cur.role === 'tool' && cur.tool) {
            stepItems!.push({ type: 'tool', msg: cur })
            currentIdx++
            continue
          }
          if (cur.role === 'assistant') {
            if (cur.reasoning) stepItems!.push({ type: 'reasoning', msg: cur })
            if (cur.content) stepItems!.push({ type: 'message', msg: cur })
            currentIdx++
            continue
          }
          break
        }

        nodes.push({ key: `step-${msg.id}`, kind: 'step', stepItems })
        i = currentIdx
        continue
      }

      // 兜底
      nodes.push({ key: msg.id, kind: 'system', msg })
      i++
    }
    return nodes
  }, [messages])

  // ─── 单个渲染节点的渲染函数（稳定引用，不随 messages 变化） ───
  const renderNode = useCallback((node: RenderNode) => {
    if (node.kind === 'user' || node.kind === 'system') {
      const msg = node.msg!

      // 特殊消息类型渲染
      if (msg.role === 'command' && msg.command) {
        return (
          <div key={msg.id} className="agent-system-msg agent-command">
            <span className="agent-system-msg__icon"><Icon name="zap" /></span>
            <span className="agent-system-msg__text">
              /{msg.command.name}{msg.command.args ? ` ${msg.command.args}` : ''}
              {msg.command.outcome?.kind === 'error' && <span className="agent-system-msg__error"> (失败)</span>}
            </span>
          </div>
        )
      }

      if (msg.role === 'compaction' && msg.compaction) {
        return (
          <div key={msg.id} className="agent-system-msg agent-compaction">
            <span className="agent-system-msg__icon"><Icon name="scissors" /></span>
            <span className="agent-system-msg__text">
              {msg.content}
              {msg.compaction.shadowedItemCount && <span> ({msg.compaction.shadowedItemCount} 条消息)</span>}
            </span>
          </div>
        )
      }

      if (msg.role === 'retry' && msg.retries) {
        return (
          <div key={msg.id} className="agent-system-msg agent-retry">
            <span className="agent-system-msg__icon"><Icon name="rotate-cw" /></span>
            <span className="agent-system-msg__text">{msg.content}</span>
          </div>
        )
      }

      if (msg.role === 'turn-error') {
        return (
          <div key={msg.id} className="agent-system-msg agent-error">
            <span className="agent-system-msg__icon"><Icon name="circle-x" /></span>
            <span className="agent-system-msg__text">{msg.content}</span>
          </div>
        )
      }

      if (msg.role === 'turn-max-tokens') {
        return (
          <div key={msg.id} className="agent-system-msg agent-max-tokens">
            <span className="agent-system-msg__icon"><Icon name="scissors" /></span>
            <span className="agent-system-msg__text">{msg.content}</span>
          </div>
        )
      }

      if (msg.role === 'todo' && msg.todos) {
        const pending = msg.todos.filter(t => t.status === 'pending')
        const inProgress = msg.todos.filter(t => t.status === 'in_progress')
        const completed = msg.todos.filter(t => t.status === 'completed')
        return (
          <div key={msg.id} className="agent-system-msg agent-todo">
            <span className="agent-system-msg__icon"><Icon name="list-checks" /></span>
            <div className="agent-system-msg__text">
              <div>任务列表 ({msg.todos.length} 项)</div>
              {inProgress.length > 0 && inProgress.map((t, i) => (
                <div key={i} className="agent-todo__item agent-todo__in-progress"><Icon name="loader" size="sm" /> {t.content}</div>
              ))}
              {pending.length > 0 && pending.slice(0, 3).map((t, i) => (
                <div key={i} className="agent-todo__item agent-todo__pending"><Icon name="circle" size="sm" /> {t.content}</div>
              ))}
              {pending.length > 3 && <div className="agent-todo__more">...还有 {pending.length - 3} 项</div>}
              {completed.length > 0 && <div className="agent-todo__item agent-todo__completed"><Icon name="check" size="sm" /> {completed.length} 项已完成</div>}
            </div>
          </div>
        )
      }

      if (msg.role === 'request-header' && msg.requestHeader) {
        return (
          <div key={msg.id} className="agent-event-card">
            <div className="agent-event-card__head">
              <span className="agent-event-card__icon"><Icon name="bot" /></span>
              <span className="agent-event-card__label">模型切换</span>
              <span className="agent-event-card__value">{msg.requestHeader?.model || '未知'}</span>
            </div>
          </div>
        )
      }

      // 默认系统消息
      return <MessageBubble message={msg} isFinal={false} />
    }

    // step 容器：把「推理 + 工具」归组为过程区，结论（assistant content）出现时打断该过程
    const items = node.stepItems!

    // 1) 切段：连续的过程项（reasoning/tool）合成一段，遇到 message 则打断
    const segments: Array<
      | { kind: 'process'; items: ProcessItem[] }
      | { kind: 'message'; msg: Message }
    > = []
    let pending: ProcessItem[] = []
    for (const item of items) {
      if (item.type === 'message') {
        if (pending.length > 0) {
          segments.push({ kind: 'process', items: pending })
          pending = []
        }
        segments.push({ kind: 'message', msg: item.msg })
      } else if (item.type === 'reasoning' || item.type === 'tool') {
        pending.push(item)
      }
    }
    if (pending.length > 0) {
      segments.push({ kind: 'process', items: pending })
    }

    return (
      <div className="agent-step">
        {segments.map((seg, si) => {
          if (seg.kind === 'message') {
            return (
              <MessageBubble
                key={`msg-${seg.msg.id}`}
                message={seg.msg}
                isFinal={!!seg.msg.turnCompleted}
              />
            )
          }

          // 本段过程后面已出现结论 → 标记打断，由 StepProcess 自动折叠
          const concluded = segments
            .slice(si + 1)
            .some(s => s.kind === 'message')

          return (
            <StepProcess
              key={`process-${si}-${seg.items[0]?.msg.id ?? 'x'}`}
              items={seg.items}
              concluded={concluded}
            />
          )
        })}
      </div>
    )
  }, [])

  return (
    <div className="agent-panel">
      <div className="agent-panel__header">
        <div className="agent-panel__header-left">
          <button
            className="agent-panel__sidebar-btn"
            onClick={() => setShowSidebar(!showSidebar)}
            title="会话列表"
          >
            ☰
          </button>
          <ConnectionIndicator
            state={connectionState}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            onRestart={handleRestartAgent}
            dotOnly
          />
          <span className="agent-panel__title">Agent</span>
        </div>

        <div className="agent-panel__header-right">
          <div className="agent-panel__more-wrap" ref={headerMenuRef}>
            <button
              className="agent-panel__settings-btn"
              onClick={() => setHeaderMenuOpen(v => !v)}
              title="更多"
            >
              ⋮
            </button>
            {headerMenuOpen && (
              <div className="dropdown-menu dropdown-menu--right">
                <button
                  className="dropdown-item"
                  onClick={() => { setHeaderMenuOpen(false); setShowPluginCenter(true) }}
                >
                  <span>插件控制中心{pluginStats.active > 0 ? ` (${pluginStats.active})` : ''}</span>
                </button>
                <button
                  className="dropdown-item"
                  onClick={() => { setHeaderMenuOpen(false); setShowSettings(true) }}
                >
                  <span>设置</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 会话侧边栏 */}
      {showSidebar && (
        <SessionSidebar
          sessions={sessions}
          currentSessionId={agentService.getSessionId() || undefined}
          onSwitch={handleSwitchSession}
          onNew={handleNewSession}
          onDelete={handleDeleteSession}
          onClose={() => setShowSidebar(false)}
        />
      )}

      {/* 插件控制中心弹窗 */}
      {showPluginCenter && (
        <div className="plugin-control-overlay" onClick={() => setShowPluginCenter(false)}>
          <div className="plugin-control-modal" onClick={(e) => e.stopPropagation()}>
            <PluginControlCenter onClose={() => setShowPluginCenter(false)} />
          </div>
        </div>
      )}

      {/* 设置面板 */}
      <SettingsPanel
        visible={showSettings}
        onClose={() => setShowSettings(false)}
      />

      <div className="agent-panel__messages-wrap">
        <VirtualList
          className="agent-panel__messages"
          items={renderNodes}
          estimatedItemHeight={100}
          overscan={8}
          autoScrollToBottom={true}
          scrollTriggerDeps={contentVersion}
          getItemKey={(node) => node.key}
          renderItem={renderNode}
          onNearBottomChange={handleNearBottomChange}
          onScrollToBottomReady={handleScrollToBottomReady}
          renderFooter={
            awaitingFirstOutput
              ? () => <ThinkingCard />
              : undefined
          }
        />
        {showScrollToBottom && (
          <button
            type="button"
            className="agent-panel__scroll-bottom"
            onClick={handleScrollToBottom}
            aria-label="滚动到底部"
            title="滚动到底部"
          >
            ↓ <span>最新消息</span>
          </button>
        )}
      </div>

      {/* 问答卡片（question/requested 时显示在输入区上方） */}
      {pendingQuestions.map(req => (
        <QuestionCard
          key={req.rpcId}
          request={req}
          onAnswer={handleQuestionAnswer}
          onCancel={handleQuestionCancel}
        />
      ))}

      <InputBox
        onSend={handleSend}
        onStop={handleStop}
        disabled={connectionState !== 'connected'}
        running={isAgentRunning}
        placeholder={
          connectionState === 'connected'
            ? '向 Agent 提问...'
            : '请先连接到 Harness...'
        }
        currentModel={currentModel}
        onModelChange={handleModelChange}
      />
    </div>
  )
}
