/**
 * AgentPanel - Agent 聊天面板
 * 
 * 纯 UI 层，所有核心处理由 DSH 内核完成
 * 通过 DSH RPC 通信：session.create / session.prompt / session.history
 */
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useEditorStore } from '../stores/editorStore'
import { agentService } from '../editor/AgentService'
import { MessageBubble } from './agent/MessageBubble'
import { InputBox } from './agent/InputBox'
import { ConnectionIndicator } from './agent/ConnectionIndicator'
import { ToolCard } from './agent/ToolCard'
import { SessionSidebar } from './agent/SessionSidebar'
import { useTypewriter } from './agent/useTypewriter'
import type { Message, ConnectionState, ToolState, SessionInfo } from '../types/agent'

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
  const activeMsgRef = useRef<string | null>(null)  // 当前活跃的 AI 消息 ID
  const scrollerRef = useRef<HTMLDivElement>(null)

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

        case 'message':
          if ((event.payload as any)?.role === 'assistant') {
            const p = event.payload as any
            commitStreamingMessage(p.content || '', p.reasoning, p.stats)
          }
          break

        case 'toolCall':
          handleToolCall(event.payload as any)
          break

        case 'toolResult':
          handleToolResult(event.payload as any)
          break

        case 'error':
          pushSystem(`错误: ${(event.payload as any)?.message || '未知错误'}`)
          break

        case 'ready':
          pushSystem('已连接到 DSH Agent')
          refreshSessions()
          break

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
    }

    return () => {
      unsubState()
      unsubEvent()
    }
  }, [])

  // 自动滚动到底部
  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight })
  }, [messages])

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
    })
    typewriter.reset()

    // 设置推理打字机回调
    reasoningTypewriter.onUpdate((displayReasoning) => {
      setMessages((cur) => cur.map(m => m.id === id ? { ...m, reasoning: displayReasoning } : m))
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

  // 提交流式消息（工具调用时会清除 activeMsgRef，确保按顺序显示）
  const commitStreamingMessage = useCallback((text: string, reasoning?: string, stats?: any) => {
    console.log('[AgentPanel] commitStreamingMessage, activeRef:', activeMsgRef.current, 'text:', text?.slice(0, 50))
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
            stats: stats || next[i].stats,
          }
          return next
        }
      }
      // 没有活跃消息时创建新的
      const id = `a-${Date.now()}`
      return [...cur, { id, role: 'assistant' as const, content: text, reasoning, stats, ts: Date.now() }]
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
    
    // 加载历史消息
    console.log('[AgentPanel] 开始加载历史消息')
    const history = await agentService.loadHistory()
    console.log('[AgentPanel] 历史消息数量:', history.length)
    if (history.length > 0) {
      const historyMessages: Message[] = history.map((msg, i) => ({
        id: `hist-${sessionId}-${i}`,
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
        reasoning: msg.reasoning,
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

  // 删除会话（DSH 暂不支持远程删除，仅从本地列表移除）
  const handleDeleteSession = useCallback(async (sessionId: string) => {
    const ok = await agentService.deleteSession(sessionId)
    if (ok) {
      refreshSessions()
      if (agentService.getSessionId() === null) {
        setMessages([{
          id: `sys-${Date.now()}`,
          role: 'system',
          content: '会话已删除，请新建会话或切换到其他会话',
          ts: Date.now()
        }])
      }
    } else {
      // DSH 不支持删除，从本地列表隐藏
      setSessions(prev => prev.filter(s => s.sessionId !== sessionId))
    }
  }, [refreshSessions])

  // 渲染消息
  const renderMessage = useCallback((message: Message) => {
    if (message.role === 'tool' && message.tool) {
      return <ToolCard key={message.id} tool={message.tool} />
    }
    return <MessageBubble key={message.id} message={message} />
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

      <div className="agent-panel__messages" ref={scrollerRef}>
        {messages.map(renderMessage)}
      </div>

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
