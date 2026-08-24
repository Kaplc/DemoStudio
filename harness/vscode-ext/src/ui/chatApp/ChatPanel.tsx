/**
 * 聊天面板：顶部状态栏 + 消息流 + 输入框（对齐 DSH ChatView）
 *
 * 状态栏显示：内核连接状态 / 工具数量 / 游戏状态 / 快捷操作
 *
 * 数据流（与 extension host 双向）：
 * - 用户上行：acquireVsCodeApi().postMessage({ type:'userMessage', text })
 * - 事件下行：window.addEventListener('message', ev => dispatch(ev.data))
 *
 * 事件类型映射（KernelAdapter → UI）：
 * - message.delta → 累积到当前 assistant 流式消息
 * - message      → 提交流式消息，新开气泡
 * - toolCall     → 显示/更新 ToolCall
 * - toolResult   → 更新 ToolCall 状态
 * - status       → 更新顶部状态栏
 * - reasoning    → AI 思考过程
 * - error        → 系统消息
 */
import * as React from 'react'
import { MessageBubble } from './MessageBubble'
import { InputBox } from './InputBox'
import type { Message, ToolCall, ToolCallState, ToolVariant, StatusBarState, AssistantBlock } from './types'

declare const vscode: {
  postMessage(msg: unknown): void
  getState(): unknown
  setState(state: unknown): void
}

/** 从工具名推断变体 */
function inferVariant(name: string, args: Record<string, unknown>): ToolVariant {
  if (name.includes('read') || name.includes('get')) return 'read'
  if (name.includes('write') || name.includes('save')) return 'write'
  if (name.includes('edit') || name.includes('patch')) return 'edit'
  if (name.includes('search') || name.includes('find') || name.includes('grep')) return 'search'
  if (name.includes('bash') || name.includes('shell') || name.includes('exec') || name.includes('run')) return 'bash'
  if (name.includes('code') || name.includes('lint') || name.includes('compile')) return 'code'
  return 'others'
}

/** 从工具参数中提取文件路径 */
function extractFilePath(args: Record<string, unknown>): string | undefined {
  return (args.filePath ?? args.path ?? args.file ?? args.scenePath) as string | undefined
}

export const ChatPanel: React.FC = () => {
  const [messages, setMessages] = React.useState<Message[]>([
    { id: 'sys-0', role: 'system', content: 'DSH 聊天已就绪', ts: Date.now() },
  ])
  const [streamingId, setStreamingId] = React.useState<string | null>(null)
  const [toolMap, setToolMap] = React.useState<Map<string, ToolCall>>(new Map())
  const [status, setStatus] = React.useState<StatusBarState>({
    kernelStatus: 'disconnected',
    kernelDetail: '',
    toolCount: 0,
    gameRunning: false,
    gameScore: 0,
  })
  const scrollerRef = React.useRef<HTMLDivElement>(null)
  const [showScrollBtn, setShowScrollBtn] = React.useState(false)

  // ── 运行状态：有流式消息时为 true ──
  const running = streamingId !== null

  // ── 判断是否在底部（距底 < 80px）──
  const checkAtBottom = React.useCallback((): boolean => {
    const el = scrollerRef.current
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }, [])

  // ── 监听滚动事件，更新"回到底部"按钮可见性 ──
  React.useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const onScroll = () => {
      const atBottom = checkAtBottom()
      setShowScrollBtn(!atBottom)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [checkAtBottom])

  // ── 安全滚动到底：等浏览器 layout 完成后再滚 ──
  const scrollToBottom = React.useCallback((behavior: ScrollBehavior = 'instant') => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = scrollerRef.current
        if (!el) return
        el.scrollTo({ top: el.scrollHeight, behavior })
        setShowScrollBtn(false)
      })
    })
  }, [])

  // ── 实时消息：仅在用户处于底部时自动滚动 ──
  React.useEffect(() => {
    if (checkAtBottom()) {
      scrollToBottom()
    }
  }, [messages, checkAtBottom, scrollToBottom])

  // ── 停止生成：向 extension host 发送 cancel 请求 ──
  const onStop = React.useCallback(() => {
    vscode.postMessage({ type: 'cancel' })
  }, [])

  React.useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data
      if (!data || typeof data !== 'object') return
      switch (data.type) {
        case 'message.delta':
          appendStreamingText(String(data.payload?.content ?? ''))
          break
        case 'message':
          commitStreamingMessage(String(data.payload?.content ?? ''), data.payload?.blocks)
          break
        case 'toolCall':
          upsertTool(data.payload)
          break
        case 'toolResult':
          resolveTool(data.payload)
          break
        case 'reasoning':
          appendReasoning(String(data.payload?.content ?? ''))
          break
        case 'status':
          handleStatusUpdate(data.payload)
          break
        case 'error':
          pushSystem(`错误: ${JSON.stringify(data.payload)}`, 'system')
          break
        case 'ready':
          setStatus(s => ({ ...s, kernelStatus: 'connected', kernelDetail: '已就绪' }))
          pushSystem('内核就绪', 'system')
          break
        case 'closed':
          setStatus(s => ({ ...s, kernelStatus: 'disconnected', kernelDetail: '' }))
          pushSystem('内核已关闭', 'system')
          break
        case 'cancelled':
          handleCancelled()
          break
        case 'loadHistory':
          handleLoadHistory(data.payload?.messages ?? [])
          break
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  // ── 用户发送消息 ──
  const onSend = (text: string) => {
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: 'user', content: text, ts: Date.now() }])
    vscode.postMessage({ type: 'userMessage', text })
  }

  // ── 流式文本追加 ──
  function appendStreamingText(delta: string) {
    setMessages((cur) => {
      if (streamingId && cur.find((m) => m.id === streamingId)) {
        return cur.map((m) =>
          m.id === streamingId ? { ...m, content: m.content + delta, streaming: true } : m,
        )
      }
      const id = `a-${Date.now()}`
      setStreamingId(id)
      return [...cur, { id, role: 'assistant', content: delta, streaming: true, ts: Date.now() }]
    })
  }

  // ── 提交流式消息 ──
  function commitStreamingMessage(text: string, blocks?: AssistantBlock[]) {
    setMessages((cur) => {
      const next = cur.slice()
      if (streamingId) {
        const i = next.findIndex((m) => m.id === streamingId)
        if (i !== -1) {
          next[i] = { ...next[i], content: text, streaming: false, blocks }
          setStreamingId(null)
          return next
        }
      }
      next.push({ id: `a-${Date.now()}`, role: 'assistant', content: text, blocks, ts: Date.now() })
      return next
    })
  }

  // ── 追加思考过程 ──
  function appendReasoning(content: string) {
    setMessages((cur) => {
      const last = cur[cur.length - 1]
      if (last?.role === 'assistant' && last.streaming) {
        const blocks = [...(last.blocks ?? [])]
        const lastBlock = blocks[blocks.length - 1]
        if (lastBlock?.kind === 'reasoning') {
          blocks[blocks.length - 1] = { ...lastBlock, text: lastBlock.text + content }
        } else {
          blocks.push({ kind: 'reasoning', text: content })
        }
        return cur.map((m) => m.id === last.id ? { ...m, blocks } : m)
      }
      return cur
    })
  }

  // ── 工具调用创建/更新 ──
  function upsertTool(payload: { id: string; name: string; args: Record<string, unknown>; status: ToolCallState }) {
    const args = payload.args ?? {}
    setToolMap(prev => {
      const next = new Map(prev)
      const existing = next.get(payload.id)
      const tool: ToolCall = {
        id: payload.id,
        name: payload.name,
        variant: existing?.variant ?? inferVariant(payload.name, args),
        args,
        state: payload.status,
        result: existing?.result,
        error: existing?.error,
        filePath: existing?.filePath ?? extractFilePath(args),
        subCalls: existing?.subCalls ?? [],
      }
      next.set(payload.id, tool)
      return next
    })

    // 同时在消息流中更新助手消息的 blocks
    setMessages((cur) => {
      const last = cur[cur.length - 1]
      if (last?.role === 'assistant') {
        const blocks = [...(last.blocks ?? [])]
        const hasBlock = blocks.some(b => b.kind === 'tool-call' && b.callId === payload.id)
        if (!hasBlock) {
          blocks.push({ kind: 'tool-call', callId: payload.id })
          return cur.map((m) => m.id === last.id ? { ...m, blocks } : m)
        }
      }
      return cur
    })
  }

  // ── 工具调用完成 ──
  function resolveTool(payload: { id: string; name: string; result: unknown; status: 'success' | 'failure' }) {
    setToolMap(prev => {
      const next = new Map(prev)
      const existing = next.get(payload.id)
      if (existing) {
        next.set(payload.id, {
          ...existing,
          state: payload.status === 'success' ? 'success' : 'error',
          result: payload.result,
          error: payload.status === 'failure' ? String(payload.result) : undefined,
        })
      }
      return next
    })
  }

  // ── 系统消息 ──
  function pushSystem(content: string, role: 'system') {
    setMessages((m) => [...m, { id: `s-${Date.now()}`, role, content, ts: Date.now() }])
  }

  // ── 状态栏更新 ──
  function handleStatusUpdate(payload: Record<string, unknown>) {
    setStatus(s => ({
      ...s,
      kernelStatus: (payload.kernelStatus as StatusBarState['kernelStatus']) ?? s.kernelStatus,
      kernelDetail: (payload.kernelDetail as string) ?? s.kernelDetail,
      toolCount: (payload.toolCount as number) ?? s.toolCount,
      gameRunning: (payload.gameRunning as boolean) ?? s.gameRunning,
      gameScore: (payload.gameScore as number) ?? s.gameScore,
    }))
  }

  // ── 取消生成：将当前流式消息标记为已中断 ──
  function handleCancelled() {
    setMessages((cur) => {
      if (!streamingId) return cur
      return cur.map((m) =>
        m.id === streamingId ? { ...m, streaming: false, interrupted: true } : m,
      )
    })
    setStreamingId(null)
    pushSystem('已停止生成', 'system')
  }

  // ── 批量加载历史消息 + 强制滚动到底 ──
  function handleLoadHistory(history: Array<{ role: string; content: string; ts: number; blocks?: AssistantBlock[] }>) {
    const loaded: Message[] = history.map((h, i) => ({
      id: `hist-${i}-${h.ts}`,
      role: h.role as Message['role'],
      content: h.content,
      ts: h.ts,
      blocks: h.blocks,
    }))
    // 保留系统欢迎消息，追加历史
    setMessages((cur) => {
      const sys = cur.filter(m => m.role === 'system' && m.id === 'sys-0')
      return [...sys, ...loaded]
    })
    // 历史加载后无条件滚动到底（用户主动触发）
    scrollToBottom()
  }

  // ── 状态栏渲染 ──
  const kernelStatusMap = {
    disconnected: { icon: '⚪', text: '未连接', color: 'var(--vscode-descriptionForeground)' },
    connecting:   { icon: '🔄', text: '连接中', color: 'var(--vscode-progressBar-background)' },
    connected:    { icon: '🟢', text: '已连接', color: 'var(--vscode-terminal-ansiGreen)' },
    error:        { icon: '🔴', text: '错误',   color: 'var(--vscode-errorForeground)' },
  }
  const ks = kernelStatusMap[status.kernelStatus]

  return (
    <div className="chat-panel">
      {/* ── 顶部状态栏 ── */}
      <div className="chat-status-bar">
        <div className="chat-status-bar__left">
          <span className="chat-status-item" title={`DSH 内核: ${ks.text}${status.kernelDetail ? ` (${status.kernelDetail})` : ''}`}>
            <span className="chat-status-item__icon">{ks.icon}</span>
            <span className="chat-status-item__text" style={{ color: ks.color }}>{ks.text}</span>
          </span>
          <span className="chat-status-divider">│</span>
          <span className="chat-status-item" title="已加载工具数">
            <span className="chat-status-item__icon">🛠</span>
            <span className="chat-status-item__text">{status.toolCount} 工具</span>
          </span>
          {status.gameRunning && (
            <>
              <span className="chat-status-divider">│</span>
              <span className="chat-status-item" title="游戏运行中">
                <span className="chat-status-item__icon">🎮</span>
                <span className="chat-status-item__text">运行中</span>
                {status.gameScore > 0 && (
                  <span className="chat-status-item__score">⭐ {status.gameScore}</span>
                )}
              </span>
            </>
          )}
        </div>
        <div className="chat-status-bar__right">
          <button
            className="chat-status-action"
            title="重启 DSH 内核"
            onClick={() => vscode.postMessage({ type: 'command', command: 'dsh.restartKernel' })}
          >
            🔄
          </button>
          <button
            className="chat-status-action"
            title="检查更新"
            onClick={() => vscode.postMessage({ type: 'command', command: 'dsh.checkUpdate' })}
          >
            📦
          </button>
        </div>
      </div>

      {/* ── 消息流 ── */}
      <div className="chat-panel__messages" ref={scrollerRef}>
        {messages.map((m) => <MessageBubble key={m.id} message={m} toolMap={toolMap} />)}
        {/* ── 回到底部浮动按钮 ── */}
        {showScrollBtn && (
          <button
            className="scroll-to-bottom"
            onClick={() => scrollToBottom('smooth')}
            title="回到底部"
          >
            ↓
          </button>
        )}
      </div>

      {/* ── 输入框 ── */}
      <InputBox onSend={onSend} onStop={onStop} running={running} />
    </div>
  )
}
