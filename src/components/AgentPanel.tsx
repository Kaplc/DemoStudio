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
import { agentService, type HistoryMessage } from '../editor/AgentService'
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
import type { Message, ConnectionState, ToolState, SessionInfo, PendingQuestionRequest, QuestionAnswer, RetryAttempt, ContextEventPayload, PendingApprovalRequest, ApprovalOutcome, TodoWritePayload, ReasoningDeltaPayload } from '../types/agent'
import { QuestionCard } from './agent/QuestionCard'
import { ApprovalCard } from './agent/ApprovalCard'
import { ContextCard } from './agent/ContextCard'
import { ModelSelector } from './agent/ModelSelector'
import { SettingsPanel } from './agent/SettingsPanel'
import { KernelUpdateModal } from './agent/KernelUpdateModal'
import { SkillManager } from './agent/SkillManager'

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
  /** live 推理卡片的消息 id：轮到本段时原地采纳（推理已实时上屏，免打字机回放） */
  adoptId?: string
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

const HISTORY_TURNS_PER_PAGE = 2

function turnStartIndices(items: Message[]): number[] {
  const starts: number[] = []
  items.forEach((item, index) => {
    if (item.role === 'user') starts.push(index)
  })
  return starts
}

function latestHistoryStart(items: Message[], turnCount = HISTORY_TURNS_PER_PAGE): number {
  const starts = turnStartIndices(items)
  return starts[Math.max(0, starts.length - turnCount)] ?? 0
}

function previousHistoryStart(items: Message[], currentStart: number, turnCount = HISTORY_TURNS_PER_PAGE): number | null {
  const starts = turnStartIndices(items)
  // currentStart 通常是 user 消息下标；分页边界也可能落在 assistant/tool 中间，
  // 此时按边界之前最近的 user 消息计算，避免加载上一页后又跳回最新两轮。
  const previousStarts = starts.filter(index => index < currentStart)
  if (previousStarts.length === 0) return null
  return previousStarts[Math.max(0, previousStarts.length - turnCount)] ?? 0
}

function toPanelHistoryMessage(
  history: HistoryMessage,
  sessionKey: string,
  fallbackIndex: number,
): Message {
  return {
    id: history.seq !== undefined
      ? `hist-${sessionKey}-${history.seq}`
      : `hist-${sessionKey}-${history.ts ?? 0}-${history.role}-${fallbackIndex}`,
    role: history.role as Message['role'],
    content: history.content,
    reasoning: history.reasoning,
    turnCompleted: history.turnCompleted,
    turnEndReason: history.turnEndReason,
    tool: history.tool,
    command: history.command,
    compaction: history.compaction,
    retries: history.retries,
    todos: history.todos,
    requestHeader: history.requestHeader,
    context: history.context,
    ts: history.ts || Date.now(),
  }
}

export const AgentPanel: React.FC = () => {
  // 组件挂载日志
  useEffect(() => {
    console.log('[AgentPanel] 组件已挂载')
    return () => {
      console.log('[AgentPanel] 组件已卸载')
    }
  }, [])

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
  const [pendingApprovals, setPendingApprovals] = useState<PendingApprovalRequest[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [showKernelUpdate, setShowKernelUpdate] = useState(false)
  const [showSkillManager, setShowSkillManager] = useState(false)
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [currentPreset, setCurrentPreset] = useState<string | null>(null)
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
  // live 推理卡片：显示队列空闲时，reasoning.delta 直达上屏（对齐 WebUI 的实时 Think 卡）。
  // 记录当前 live 消息 id；flush 的完整段入队时携带该 id，轮到消费时原地采纳、不再重打推理。
  const liveAssistantIdRef = useRef<string | null>(null)
  const liveSequenceRef = useRef(0)
  // 历史窗口只显示当前已加载尾部的最近两轮，向上滚动时逐步展开/拉取更早内容。
  const loadedHistoryRef = useRef<Message[]>([])
  const historyCursorRef = useRef<number | undefined>(undefined)
  const historyHasMoreRef = useRef(false)
  const historyVisibleStartRef = useRef(0)
  const historyLoadingRef = useRef(false)
  const historySessionKeyRef = useRef('current')
  const [hasOlderHistory, setHasOlderHistory] = useState(false)

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

  // 获取当前工作区路径和 preset
  useEffect(() => {
    const fetchWorkspace = async () => {
      try {
        const info = await window.electronAPI?.getAppInfo()
        if (info?.appRoot) {
          // 提取 basename 作为显示名称
          const parts = info.appRoot.replace(/\\/g, '/').split('/')
          const basename = parts[parts.length - 1] || info.appRoot
          setWorkspacePath(basename)
        }
      } catch {
        setWorkspacePath('.')
      }
    }
    fetchWorkspace()
  }, [])

  // 获取当前 preset
  useEffect(() => {
    const fetchPreset = async () => {
      if (connectionState === 'connected') {
        const preset = await agentService.getCurrentPreset()
        setCurrentPreset(preset)
      }
    }
    fetchPreset()
  }, [connectionState, sessions])

  // 初始化服务
  useEffect(() => {
    console.log('[AgentPanel] 初始化 AgentService 监听')
    const unsubState = agentService.onStateChange((state) => {
      console.log(`[AgentPanel] 连接状态变化: ${state}`)
      setConnectionState(state)
      setAgentConnected(state === 'connected')
      setAgentConnecting(state === 'connecting')
    })

    const unsubEvent = agentService.onEvent((event) => {
      switch (event.type) {
        case 'message': {
          const p = event.payload as any
          if (p?.role === 'assistant') {
            // live 推理卡片在屏时：完整段携带 adoptId 入队，轮到消费时原地采纳。
            // ref 在采纳真正发生（drain）时才清除，期间新 delta 仍会继续喂同一张卡。
            commitStreamingMessage(p.content || '', p.reasoning, p.stats, p.turnCompleted, p.turnEndReason, liveAssistantIdRef.current ?? undefined)
          }
          break
        }

        case 'reasoning.delta': {
          handleLiveReasoning((event.payload as ReasoningDeltaPayload)?.text || '')
          break
        }

        case 'turnStart':
          // 回合开始（可用于 UI 状态指示）
          break

        case 'context': {
          // 注入的上下文（插件记忆召回 / 提取 notice 等）→ 折叠卡片
          const p = event.payload as ContextEventPayload
          setMessages(cur => [...cur, {
            id: `ctx-${p.seq}`,
            role: 'context',
            content: p.content,
            context: { role: p.role, label: p.label, form: p.form, summary: p.summary },
            ts: p.time || Date.now(),
          }])
          setContentVersion(v => v + 1)
          break
        }

        case 'turnEnd': {
          console.log(`[AgentPanel] AI 回合结束: reason=${(event.payload as any)?.reason?.kind || 'unknown'}`)
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
          // 与历史路径一致：每次 todo/write 折叠成一张任务卡片（webui 为每次写入一行 ToolRow）
          const todoPayload = event.payload as TodoWritePayload
          const todos = todoPayload?.todos ?? []
          setMessages(cur => [...cur, {
            id: `todo-${todoPayload?.seq ?? Date.now()}`,
            role: 'todo',
            content: `${todos.length} 个任务`,
            todos,
            ts: todoPayload?.time || Date.now(),
          }])
          setContentVersion(v => v + 1)
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

        case 'approvalRequest': {
          const req = event.payload as PendingApprovalRequest
          setPendingApprovals(prev => {
            if (prev.some(a => a.rpcId === req.rpcId)) return prev
            return [...prev, req]
          })
          break
        }

        case 'approvalResolved': {
          // 卡片移除由决议广播驱动（本端提交或他端/撤销决议都走这里）
          const { approvalId } = event.payload as { approvalId: string }
          setPendingApprovals(prev => prev.filter(a => a.approvalId !== approvalId))
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
          // 断连时折叠 live 推理卡片（重连恢复后由 history/续听路径重建显示）
          finalizeLiveReasoning()
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

  // 折叠 live 推理卡片（保留已上屏内容）。停止 / 断连时调用，防止卡片停在"思考中"。
  const finalizeLiveReasoning = useCallback(() => {
    const liveId = liveAssistantIdRef.current
    if (!liveId) return
    liveAssistantIdRef.current = null
    setMessages(cur => cur.map(message => message.id === liveId ? { ...message, streaming: false } : message))
    setContentVersion(v => v + 1)
  }, [])

  // reasoning.delta 直达上屏：显示队列完全空闲时即时创建/更新 live 推理卡片（对齐 WebUI Think 卡的实时性）。
  // 队列忙碌（上一段还在打字 / 有排队项）时不实时上屏——delta 留在服务端缓冲，flush 的完整段
  // 走原打字机回放路径，保证 tool/assistant 的显示顺序不被跨段打乱。
  const handleLiveReasoning = useCallback((text: string) => {
    if (!text) return
    if (activeDisplayRef.current || displayQueueRef.current.length > 0 || displayPhaseRef.current) return
    const liveId = liveAssistantIdRef.current
    if (!liveId) {
      const id = `a-live-${Date.now()}-${liveSequenceRef.current++}`
      liveAssistantIdRef.current = id
      console.log(`[AgentPanel] live 推理卡片创建: ${id} (${text.length} 字符)`)
      setMessages(cur => [...cur, {
        id,
        role: 'assistant' as const,
        content: '',
        reasoning: text,
        streaming: true,
        ts: Date.now(),
      }])
    } else {
      setMessages(cur => cur.map(message => message.id === liveId ? { ...message, reasoning: text } : message))
    }
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

    // 计算速度倍率：每多2个队列项，速度翻倍
    const queueLength = displayQueueRef.current.length
    const speedMultiplier = Math.pow(2, Math.floor(queueLength / 2))
    console.log(`[AgentPanel] 消费显示队列: kind=${next.kind}, 剩余=${queueLength}, 速度倍率=${speedMultiplier}x`)
    typewriter.setSpeedMultiplier(speedMultiplier)
    reasoningTypewriter.setSpeedMultiplier(speedMultiplier)

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

    // live 推理采纳：ref 仍指向该段的 live 卡片 → 原地补全（推理已实时上屏，免回放）；
    // ref 已变（停止/断连清理过）→ 退回新建消息 + 打字机回放的完整路径。
    const adopting = !!next.adoptId && liveAssistantIdRef.current === next.adoptId
    if (adopting) {
      liveAssistantIdRef.current = null
      console.log(`[AgentPanel] live 推理卡片原地采纳: ${next.adoptId}`)
    }

    setMessages(cur => {
      if (adopting) {
        const index = cur.findIndex(message => message.id === next.id)
        if (index !== -1) {
          const updated = cur.slice()
          updated[index] = { ...updated[index], reasoning: next.reasoning ?? updated[index].reasoning, streaming: true }
          return updated
        }
      }
      return [...cur, {
        id: next.id,
        role: 'assistant' as const,
        content: '',
        // 非采纳路径先给空串由打字机渐进回填；采纳但 live 卡片已丢失（会话被整体替换）
        // 时直接补全量推理，避免文本丢失——此时跳过回放是可接受的降级。
        reasoning: adopting ? (next.reasoning ?? '') : '',
        streaming: true,
        ts: Date.now(),
      }]
    })
    setContentVersion(v => v + 1)

    if (adopting && next.content) {
      // 推理已上屏：直接进入正文打字。正文首字符落地后本段过程被"结论打断"，
      // StepProcess 会自动折叠推理区，视觉顺序与 WebUI 一致（思考完 → 收起 → 出答案）。
      displayPhaseRef.current = 'content'
      typewriter.reset()
      typewriter.setFull(next.content)
    } else if (adopting) {
      // 纯推理段（无正文，后随工具调用）：推理已展示完，直接完成本段，工具卡片立即落地
      finishAssistantDisplay()
    } else if (next.reasoning) {
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
    reasoningTypewriter.setSpeedMultiplier,
    typewriter.reset,
    typewriter.setFull,
    typewriter.setSpeedMultiplier,
  ])

  useEffect(() => {
    drainQueueRef.current = drainDisplayQueue
  }, [drainDisplayQueue])

  // 提交一个已收集完成的 assistant 段，显示顺序由队列统一控制。
  // adoptId 非空时表示该段的推理已通过 live 卡片实时上屏：队列项直接沿用 live 消息 id，
  // 轮到消费时原地采纳（跳过推理回放），正文继续走打字机。
  const commitStreamingMessage = useCallback((text: string, reasoning?: string, stats?: any, turnCompleted?: boolean, turnEndReason?: any, adoptId?: string) => {
    messageSequenceRef.current += 1
    const queueLength = displayQueueRef.current.length
    console.log(`[AgentPanel] 消息入队: content=${text.length}字符, reasoning=${reasoning?.length || 0}字符, 队列长度=${queueLength}${adoptId ? ', 采纳 live 卡片' : ''}`)
    displayQueueRef.current.push({
      kind: 'assistant',
      id: adoptId ?? `a-${Date.now()}-${messageSequenceRef.current}`,
      adoptId,
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
    const active = activeDisplayRef.current
    if (active?.kind === 'assistant') {
      // 停止或切换会话时保留已经打出来的内容，但结束它的 streaming 状态，
      // 避免消息一直显示为“思考中”或保留打字光标。
      setMessages(cur => cur.map(message => message.id === active.id
        ? { ...message, streaming: false }
        : message))
      setContentVersion(v => v + 1)
    }
    // live 推理卡片同样就地折叠，保留已实时上屏的部分
    finalizeLiveReasoning()
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
  }, [finalizeLiveReasoning, reasoningTypewriter.reset, typewriter.reset])

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
      const page = await agentService.loadHistoryPage()
      const sessionKey = agentService.getSessionId() || 'current'
      const restored = page.messages.map((history, index) => toPanelHistoryMessage(history, sessionKey, index))
      loadedHistoryRef.current = restored
      historyCursorRef.current = page.beforeSeq
      historyHasMoreRef.current = page.hasMore
      historySessionKeyRef.current = sessionKey
      historyVisibleStartRef.current = latestHistoryStart(restored)
      setHasOlderHistory(historyVisibleStartRef.current > 0 || page.hasMore)
      if (!restored.length) return
      setMessages([
        { id: 'sys-0', role: 'system', content: '对话已恢复', ts: Date.now() },
        ...restored.slice(historyVisibleStartRef.current),
      ])
      console.log(`[AgentPanel] 已恢复最近 ${HISTORY_TURNS_PER_PAGE} 轮历史消息，窗口内 ${restored.length} 条`)
    } catch (err) {
      console.warn('[AgentPanel] 恢复历史失败:', err)
    }
  }, [])

  // 清空历史分页窗口（新建/切换会话时调用，实时消息不进入这个窗口）。
  const resetHistoryWindow = useCallback(() => {
    loadedHistoryRef.current = []
    historyCursorRef.current = undefined
    historyHasMoreRef.current = false
    historyVisibleStartRef.current = 0
    historySessionKeyRef.current = agentService.getSessionId() || 'current'
    setHasOlderHistory(false)
  }, [])

  // 将已加载的历史窗口重新放回当前消息列表，保留历史窗口之外的实时消息/系统提示。
  const replaceVisibleHistory = useCallback((visibleStart: number) => {
    const loaded = loadedHistoryRef.current
    const historyIds = new Set(loaded.map(message => message.id))
    setMessages(current => {
      const firstHistoryIndex = current.findIndex(message => historyIds.has(message.id))
      if (firstHistoryIndex === -1) return [...loaded.slice(visibleStart), ...current]
      const prefix = current.slice(0, firstHistoryIndex).filter(message => !historyIds.has(message.id))
      const suffix = current.slice(firstHistoryIndex).filter(message => !historyIds.has(message.id))
      return [...prefix, ...loaded.slice(visibleStart), ...suffix]
    })
    setContentVersion(version => version + 1)
  }, [])

  const handleLoadOlderHistory = useCallback(async () => {
    if (historyLoadingRef.current) return

    const loaded = loadedHistoryRef.current
    const currentStart = historyVisibleStartRef.current
    const previousStart = previousHistoryStart(loaded, currentStart)
    if (previousStart !== null) {
      historyVisibleStartRef.current = previousStart
      setHasOlderHistory(previousStart > 0 || historyHasMoreRef.current)
      replaceVisibleHistory(previousStart)
      return
    }

    if (!historyHasMoreRef.current || historyCursorRef.current === undefined) {
      setHasOlderHistory(false)
      return
    }

    historyLoadingRef.current = true
    const anchorId = loaded[currentStart]?.id
    try {
      const page = await agentService.loadHistoryPage(historyCursorRef.current)
      const older = page.messages.map((history, index) => toPanelHistoryMessage(
        history,
        historySessionKeyRef.current,
        index,
      ))
      const knownIds = new Set(loaded.map(message => message.id))
      const merged = [...older.filter(message => !knownIds.has(message.id)), ...loaded]
      loadedHistoryRef.current = merged
      historyCursorRef.current = page.beforeSeq
      historyHasMoreRef.current = page.hasMore

      const anchorIndex = anchorId ? merged.findIndex(message => message.id === anchorId) : -1
      const nextStart = anchorIndex >= 0
        ? (previousHistoryStart(merged, anchorIndex, HISTORY_TURNS_PER_PAGE) ?? 0)
        : latestHistoryStart(merged)
      historyVisibleStartRef.current = nextStart
      setHasOlderHistory(nextStart > 0 || page.hasMore)
      replaceVisibleHistory(nextStart)
    } catch (error) {
      console.warn('[AgentPanel] 加载更早历史失败:', error)
    } finally {
      historyLoadingRef.current = false
    }
  }, [replaceVisibleHistory])

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
      // 停止服务端回合的同时，立即取消当前 assistant/reasoning 打字机，
      // 清空尚未显示的队列，避免停止后仍继续消费 requestAnimationFrame。
      clearDisplayQueue()
      await agentService.stop()
      addConsoleOutput('[Agent] 已停止 AI')
    } catch (error) {
      console.error(`[AgentPanel] 停止失败:`, error)
      pushSystem(`停止失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [addConsoleOutput, clearDisplayQueue, pushSystem])

  // 切换会话
  const handleSwitchSession = useCallback(async (sessionId: string) => {
    console.log('[AgentPanel] 切换会话:', sessionId)
    clearDisplayQueue()
    resetHistoryWindow()
    await agentService.switchSession(sessionId)
    historySessionKeyRef.current = sessionId
    setPendingQuestions([]) // 清除旧会话的 pending questions
    setPendingApprovals([]) // 清除旧会话的 pending approvals
    
    // 加载历史消息
    console.log('[AgentPanel] 开始加载历史消息')
    const page = await agentService.loadHistoryPage()
    const historyMessages = page.messages.map((msg, index) => toPanelHistoryMessage(msg, sessionId, index))
    loadedHistoryRef.current = historyMessages
    historyCursorRef.current = page.beforeSeq
    historyHasMoreRef.current = page.hasMore
    historyVisibleStartRef.current = latestHistoryStart(historyMessages)
    setHasOlderHistory(historyVisibleStartRef.current > 0 || page.hasMore)
    console.log('[AgentPanel] 当前历史窗口消息数量:', historyMessages.length)
    if (historyMessages.length > 0) {
      setMessages(historyMessages.slice(historyVisibleStartRef.current))
    } else {
      setMessages([{
        id: `sys-${Date.now()}`,
        role: 'system',
        content: `已切换到会话 ${sessionId.slice(0, 12)}...`,
        ts: Date.now()
      }])
    }
    
    setShowSidebar(false)
  }, [clearDisplayQueue, resetHistoryWindow])

  // 新建会话
  const handleNewSession = useCallback(async () => {
    clearDisplayQueue()
    resetHistoryWindow()
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
    } else {
      setMessages([{
        id: `sys-${Date.now()}`,
        role: 'system',
        content: '新建会话失败，请检查 Agent 连接状态或预设配置',
        ts: Date.now()
      }])
    }
  }, [clearDisplayQueue, refreshSessions, resetHistoryWindow])

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

  // ─── 工具审批 ───
  const handleApprovalAnswer = useCallback(async (rpcId: string, outcome: ApprovalOutcome): Promise<boolean> => {
    const req = agentService.getPendingApprovals().find(a => a.rpcId === rpcId)
    const ok = await agentService.answerApproval(rpcId, outcome)
    pushSystem(ok
      ? `${outcome === 'allowed-once' ? '已允许一次' : '已拒绝'} ${req?.toolName || '工具'} 执行`
      : '审批提交失败')
    return ok
  }, [pushSystem])

  // 命令行解析：按 callId 回溯转录里最近的工具调用参数（对齐 webui 的 command 展示，查不到则省略）
  const approvalCommand = (req: PendingApprovalRequest): string | undefined => {
    if (!req.callId) return undefined
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === 'tool' && m.tool?.id === req.callId) {
        const args = m.tool.args as Record<string, unknown> | undefined
        const cmd = args?.command ?? args?.script
        return typeof cmd === 'string' && cmd !== '' ? cmd : undefined
      }
    }
    return undefined
  }

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

      // 特殊消息类型（命令、压缩、重试、错误、上下文注入等）→ 独立系统节点
      if (msg.role === 'command' || msg.role === 'compaction' || msg.role === 'retry' ||
          msg.role === 'turn-error' || msg.role === 'turn-max-tokens' ||
          msg.role === 'todo' || msg.role === 'request-header' || msg.role === 'context') {
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
              {/* 摘要语义对齐 webui todo-row：X/Y 已完成 · 当前活动项在前 */}
              <div>任务列表（{completed.length}/{msg.todos.length} 已完成）</div>
              {inProgress.length > 0 && inProgress.map((t, i) => (
                <div key={i} className="agent-todo__item agent-todo__in-progress"><Icon name="loader" size="sm" /> {t.content}</div>
              ))}
              {pending.length > 0 && pending.slice(0, 3).map((t, i) => (
                <div key={i} className="agent-todo__item agent-todo__pending"><Icon name="circle" size="sm" /> {t.content}</div>
              ))}
              {pending.length > 3 && <div className="agent-todo__more">...还有 {pending.length - 3} 项</div>}
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

      // 上下文注入卡片（插件召回 / 提取 notice 等）
      if (msg.role === 'context' && msg.context) {
        return <ContextCard key={msg.id} info={msg.context} content={msg.content} />
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
          {/* 工作区显示 */}
          {workspacePath && (
            <div className="agent-panel__workspace" title={`工作区: ${workspacePath}`}>
              <span className="agent-panel__workspace-label">{workspacePath}</span>
            </div>
          )}
          {/* Preset 显示 */}
          {currentPreset && (
            <div className="agent-panel__preset" title={`Preset: ${currentPreset}`}>
              <span className="agent-panel__preset-label">{currentPreset}</span>
            </div>
          )}
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
                  onClick={() => { setHeaderMenuOpen(false); handleRestartAgent() }}
                >
                  <span>重启内核</span>
                </button>
                <button
                  className="dropdown-item"
                  onClick={() => { setHeaderMenuOpen(false); setShowKernelUpdate(true) }}
                >
                  <span>更新内核</span>
                </button>
                <button
                  className="dropdown-item"
                  onClick={() => { setHeaderMenuOpen(false); setShowPluginCenter(true) }}
                >
                  <span>插件控制中心{pluginStats.active > 0 ? ` (${pluginStats.active})` : ''}</span>
                </button>
                <button
                  className="dropdown-item"
                  onClick={() => { setHeaderMenuOpen(false); setShowSkillManager(true) }}
                >
                  <span>Skill 管理</span>
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

      {/* Skill 管理面板 */}
      <SkillManager
        visible={showSkillManager}
        onClose={() => setShowSkillManager(false)}
      />

      {/* DSH 内核更新浮动窗口 */}
      {showKernelUpdate && (
        <KernelUpdateModal
          onClose={() => setShowKernelUpdate(false)}
          onVersionChanged={() => {
            console.log('[AgentPanel] DSH 内核版本已切换，重启后生效')
          }}
        />
      )}

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
          onReachTop={handleLoadOlderHistory}
          canLoadMore={hasOlderHistory}
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

      {/* 工具审批卡片（approval/requested 时显示在输入区上方） */}
      {pendingApprovals.map(req => (
        <ApprovalCard
          key={req.rpcId}
          request={req}
          command={approvalCommand(req)}
          onAnswer={handleApprovalAnswer}
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
        agentService={agentService}
      />
    </div>
  )
}
