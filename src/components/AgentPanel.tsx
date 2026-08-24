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
import { useEditorStore } from '../stores/editorStore'
import { agentService } from '../editor/AgentService'
import { pluginService } from '../editor/PluginService'
import { MessageBubble } from './agent/MessageBubble'
import { ReasoningBlock } from './agent/ReasoningBlock'
import { InputBox } from './agent/InputBox'
import { ConnectionIndicator } from './agent/ConnectionIndicator'
import { ToolCard } from './agent/ToolCard'
import { SessionSidebar } from './agent/SessionSidebar'
import { PluginControlCenter } from './PluginControlCenter'
import { useTypewriter } from './agent/useTypewriter'
import { VirtualList } from './agent/VirtualList'
import type { Message, ConnectionState, ToolState, SessionInfo, PendingQuestionRequest, QuestionAnswer } from '../types/agent'
import { QuestionCard } from './agent/QuestionCard'

// ─── 渲染节点类型（虚拟列表的 item） ───
interface RenderNode {
  key: string
  kind: 'user' | 'system' | 'step'
  /** step 容器包含的子项 */
  stepItems?: Array<{ type: 'reasoning' | 'tool' | 'message'; msg: Message }>
  /** 单条消息（user/system） */
  msg?: Message
}

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
  const activeMsgRef = useRef<string | null>(null)  // 当前活跃的 AI 消息 ID
  const [contentVersion, setContentVersion] = useState(0)  // 流式内容变化计数器，用于触发自动滚动

  // 打字机效果（回复）
  const typewriter = useTypewriter({
    baseSpeed: 40,    // 基础40字符/秒
    maxSpeed: 300,    // 最大300字符/秒
    acceleration: 0.8 // 每100字符加速80%
  })

  // 打字机效果（推理，开始回复时一次性输出）
  const reasoningTypewriter = useTypewriter({
    baseSpeed: 40,
    maxSpeed: 300,
    acceleration: 0.8
  })

  const {
    addConsoleOutput,
    setAgentConnected,
    setAgentConnecting
  } = useEditorStore()

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
        case 'message.delta':
          handleStreamingDelta(event.payload as string)
          break

        case 'reasoning.delta':
          handleReasoningDelta(event.payload as string)
          break

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
            pushSystem(reasonMap[turnPayload?.reason?.kind] || '回合异常结束')
          }
          break
        }

        case 'stepStart':
          // 步骤开始（可用于进度指示）
          break

        case 'stepEnd':
          handleStepEnd()
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
          const retry = event.payload as any
          pushSystem(`LLM 重试 #${retry?.retry}: ${retry?.reason || '正在重试...'}`)
          break
        }

        case 'retryStarted': {
          // 重试开始（可用于 UI 指示）
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
          if (payload?.recovered) {
            pushSystem('已自动重连到 DSH Agent，正在恢复对话...')
            restoreHistory()
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

  // 找到或创建当前活跃的 AI 消息（推理和文本共用同一个气泡）
  const getOrCreateActiveId = useCallback((cur: Message[]): { messages: Message[], id: string } => {
    // 优先复用已有引用
    const aid = activeMsgRef.current
    if (aid) {
      const found = cur.find(m => m.id === aid)
      if (found && found.streaming) {
        console.log('[AgentPanel] 复用活跃消息:', aid)
        return { messages: cur, id: aid }
      }
    }
    // 创建新的（不复用已提交的消息）
    const id = `a-${Date.now()}`
    activeMsgRef.current = id
    console.log('[AgentPanel] 创建新消息:', id, 'reason: activeRef=' + aid)
    
    // 设置打字机回调来更新这个消息
    typewriter.onUpdate((displayText) => {
      setMessages((cur) => cur.map(m => m.id === id ? { ...m, content: displayText } : m))
      setContentVersion(v => v + 1)
    })
    typewriter.reset()

    // 设置推理打字机回调
    reasoningTypewriter.onUpdate((displayReasoning) => {
      setMessages((cur) => cur.map(m => m.id === id ? { ...m, reasoning: displayReasoning } : m))
      setContentVersion(v => v + 1)
    })
    reasoningTypewriter.reset()
    
    return {
      messages: [...cur, { id, role: 'assistant' as const, content: '', streaming: true, ts: Date.now() }],
      id
    }
  }, [typewriter, reasoningTypewriter])

  // 处理推理流式增量（打字机效果，开始回复时一次性输出）
  const handleReasoningDelta = useCallback((delta: string) => {
    console.log('[AgentPanel] reasoning.delta, activeRef:', activeMsgRef.current)
    // 确保活跃消息存在
    setMessages((cur) => {
      const { messages } = getOrCreateActiveId(cur)
      return messages
    })
    // 追加到推理打字机缓冲区
    reasoningTypewriter.append(delta)
  }, [getOrCreateActiveId, reasoningTypewriter])

  // 处理流式消息增量（使用打字机效果，首次回复时先刷出推理内容）
  const handleStreamingDelta = useCallback((delta: string) => {
    console.log('[AgentPanel] message.delta, activeRef:', activeMsgRef.current)
    // 开始回复时，一次性输出所有推理内容
    reasoningTypewriter.flush()
    // 追加到打字机缓冲区
    typewriter.append(delta)
  }, [typewriter, reasoningTypewriter])

  // 单步模型调用结束（assistant/chunk finish）→ 折叠推理卡片
  const handleStepEnd = useCallback(() => {
    // 刷新推理打字机，确保内容完整显示后折叠
    reasoningTypewriter.flush()
    setMessages((cur) => {
      const aid = activeMsgRef.current
      if (!aid) return cur
      return cur.map(m => m.id === aid ? { ...m, reasoning: m.reasoning } : m)
    })
  }, [reasoningTypewriter])

  // 提交流式消息（turn/end 或 session.idle 时调用）
  const commitStreamingMessage = useCallback((text: string, reasoning?: string, stats?: any, turnCompleted?: boolean, turnEndReason?: any) => {
    console.log('[AgentPanel] commitStreamingMessage, activeRef:', activeMsgRef.current, 'text:', text?.slice(0, 50), 'turnCompleted:', turnCompleted)
    // 先捕获 ref 值（setMessages updater 异步执行时 ref 可能已变）
    const aid = activeMsgRef.current
    // 刷新两个打字机缓冲区
    reasoningTypewriter.flush()
    typewriter.flush()

    setMessages((cur) => {
      if (aid) {
        const i = cur.findIndex(m => m.id === aid)
        if (i !== -1) {
          const next = cur.slice()
          next[i] = {
            ...next[i],
            content: text || next[i].content,
            reasoning: reasoning || next[i].reasoning,
            streaming: false,
            turnCompleted: turnCompleted || false,
            turnEndReason: turnEndReason || next[i].turnEndReason,
            stats: stats || next[i].stats,
          }
          return next
        }
      }
      // 没有活跃消息时创建新的
      const id = `a-${Date.now()}`
      return [...cur, { id, role: 'assistant' as const, content: text, reasoning, turnCompleted: turnCompleted || false, turnEndReason, stats, ts: Date.now() }]
    })
    // 清除活跃消息引用，允许再次输入
    activeMsgRef.current = null
  }, [typewriter, reasoningTypewriter])

  // 处理工具调用
  const handleToolCall = useCallback((payload: {
    id: string
    name: string
    args: unknown
    status: 'pending' | 'running'
  }) => {
    console.log('[AgentPanel] toolCall, 清除activeRef, tool:', payload.name, 'id:', payload.id)
    // 将所有 streaming 消息设为非流式状态（防止光标残留）
    setMessages((cur) => cur.map(m => m.streaming ? { ...m, streaming: false } : m))
    // 重置两个打字机
    reasoningTypewriter.flush()
    reasoningTypewriter.reset()
    typewriter.flush()
    typewriter.reset()
    // 清除活跃消息引用，让后续 AI 回复创建新气泡
    activeMsgRef.current = null
    setMessages((cur) => {
      const idx = cur.findIndex((m) => m.role === 'tool' && m.tool?.id === payload.id)
      const next = cur.slice()
      const tool: ToolState = {
        id: payload.id,
        name: payload.name,
        args: payload.args,
        status: payload.status
      }

      if (idx === -1) {
        next.push({
          id: `t-${payload.id}`,
          role: 'tool',
          content: '',
          tool,
          ts: Date.now()
        })
      } else {
        next[idx] = { ...next[idx], tool }
      }
      return next
    })
    // 触发自动滚动（工具卡片被聚合进 step 节点，items.length 不变，需要手动触发）
    setContentVersion(v => v + 1)
  }, [typewriter, reasoningTypewriter])

  // 处理工具结果
  const handleToolResult = useCallback((payload: {
    id: string
    name: string
    result: unknown
    status: 'success' | 'failure'
  }) => {
    console.log('[AgentPanel] toolResult, tool:', payload.name, 'status:', payload.status)
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

  // 发送消息
  const handleSend = useCallback(async (text: string) => {
    try {
      setMessages(prev => [...prev, {
        id: `u-${Date.now()}`,
        role: 'user',
        content: text,
        ts: Date.now()
      }])
      activeMsgRef.current = null
      await agentService.send(text)
      addConsoleOutput(`[Agent] 发送消息: ${text}`)
      refreshSessions()
    } catch (error) {
      pushSystem(`发送失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [addConsoleOutput, pushSystem, refreshSessions])

  // 切换会话
  const handleSwitchSession = useCallback(async (sessionId: string) => {
    console.log('[AgentPanel] 切换会话:', sessionId)
    await agentService.switchSession(sessionId)
    activeMsgRef.current = null
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
  }, [])

  // 新建会话
  const handleNewSession = useCallback(async () => {
    const sid = await agentService.createSession()
    if (sid) {
      setMessages([{
        id: `sys-${Date.now()}`,
        role: 'system',
        content: '新会话已创建',
        ts: Date.now()
      }])
      activeMsgRef.current = null
      refreshSessions()
      setShowSidebar(false)
    }
  }, [refreshSessions])

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
            if (cur.content && !cur.streaming) stepItems!.push({ type: 'message', msg: cur })
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
            <span className="agent-system-msg__icon">⚡</span>
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
            <span className="agent-system-msg__icon">🗜️</span>
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
            <span className="agent-system-msg__icon">🔄</span>
            <span className="agent-system-msg__text">{msg.content}</span>
          </div>
        )
      }

      if (msg.role === 'turn-error') {
        return (
          <div key={msg.id} className="agent-system-msg agent-error">
            <span className="agent-system-msg__icon">❌</span>
            <span className="agent-system-msg__text">{msg.content}</span>
          </div>
        )
      }

      if (msg.role === 'turn-max-tokens') {
        return (
          <div key={msg.id} className="agent-system-msg agent-max-tokens">
            <span className="agent-system-msg__icon">✂️</span>
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
            <span className="agent-system-msg__icon">📋</span>
            <div className="agent-system-msg__text">
              <div>任务列表 ({msg.todos.length} 项)</div>
              {inProgress.length > 0 && inProgress.map((t, i) => (
                <div key={i} className="agent-todo__item agent-todo__in-progress">🔄 {t.content}</div>
              ))}
              {pending.length > 0 && pending.slice(0, 3).map((t, i) => (
                <div key={i} className="agent-todo__item agent-todo__pending">⏳ {t.content}</div>
              ))}
              {pending.length > 3 && <div className="agent-todo__more">...还有 {pending.length - 3} 项</div>}
              {completed.length > 0 && <div className="agent-todo__item agent-todo__completed">✅ {completed.length} 项已完成</div>}
            </div>
          </div>
        )
      }

      if (msg.role === 'request-header' && msg.requestHeader) {
        return (
          <div key={msg.id} className="agent-system-msg agent-request-header">
            <span className="agent-system-msg__icon">🤖</span>
            <span className="agent-system-msg__text">{msg.content}</span>
          </div>
        )
      }

      // 默认系统消息
      return <MessageBubble message={msg} isFinal={false} />
    }

    // step 容器
    const items = node.stepItems!

    return (
      <div className="agent-step">
        {items.map((item) => {
          if (item.type === 'reasoning') {
            return (
              <ReasoningBlock
                key={`reasoning-${item.msg.id}`}
                content={item.msg.reasoning || ''}
                streaming={item.msg.streaming}
              />
            )
          }
          if (item.type === 'tool' && item.msg.tool) {
            return <ToolCard key={`tool-${item.msg.id}`} tool={item.msg.tool} />
          }
          if (item.type === 'message') {
            return (
              <MessageBubble
                key={`msg-${item.msg.id}`}
                message={item.msg}
                isFinal={!!item.msg.turnCompleted}
              />
            )
          }
          return null
        })}
      </div>
    )
  }, [])

  return (
    <div className="agent-panel">
      <div className="agent-panel__header">
        <button
          className="agent-panel__sidebar-btn"
          onClick={() => setShowSidebar(!showSidebar)}
          title="会话列表"
        >
          ☰
        </button>
        <span className="agent-panel__title">Agent</span>
        <button
          className="agent-panel__plugins-btn"
          onClick={() => setShowPluginCenter(true)}
          title="插件控制中心"
        >
          🔌 <span>插件</span>
          {pluginStats.active > 0 && (
            <span className="agent-panel__plugins-badge">{pluginStats.active}</span>
          )}
        </button>
        <ConnectionIndicator
          state={connectionState}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
        />
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

      <VirtualList
        className="agent-panel__messages"
        items={renderNodes}
        estimatedItemHeight={100}
        overscan={8}
        autoScrollToBottom={true}
        scrollTriggerDeps={contentVersion}
        getItemKey={(node) => node.key}
        renderItem={renderNode}
      />

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
        disabled={connectionState !== 'connected'}
        running={!!activeMsgRef.current}
        placeholder={
          connectionState === 'connected'
            ? '向 Agent 提问...'
            : '请先连接到 Harness...'
        }
      />
    </div>
  )
}
