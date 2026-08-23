/**
 * 内置 KernelAdapter：通过 `@deepseek-ai/dsh-sdk-client` 启动 DSH 运行时作为子进程。
 *
 * 运行时架构（与原文档对齐）：
 * - DSH 设计为 Cordis 插件体系；"内核" = 一个完整的 DSH runtime process（Node 应用）
 * - SDK client 提供高层 API `DeepSeekHarness`：spawn 子进程 + stdio JSON-RPC + 通知订阅
 * - 扩展进程内 import SDK → spawn 同一扩展包内的 DSH runtime 进程 → 仍属"内置"（用户无需单独安装 DSH）
 * - `KernelAdapter` 抽象接口保持稳定：实现可替换为未来 in-process 方案（DSH 真正提供）
 *
 * 关键能力：
 * - 流式消息通过 `subscribe` notification 拿到，转为本接口的 `message.delta` 事件
 * - 工具调用/结果通过同通道的 `toolCall` / `toolResult` 事件映射
 * - 进程崩溃由 SDK `TransportClosedError` 抛出，向上抛给 KernelManager 自动重启
 */
import {
  KernelAdapter,
  KernelMode,
  KernelOptions,
  UserMessage,
  KernelEvent,
  Listener,
  Disposable,
} from './adapter'
import type { DeepSeekHarness, NotificationSubscription } from '@deepseek-ai/dsh-sdk-client'
import type { JsonRpcResponseError, RequestTimeoutError, SdkProtocolError, TransportClosedError } from '@deepseek-ai/dsh-sdk-client'

/** 事件订阅回调（去掉 notification 包装） */
type WireEvent = { kind: string; payload?: unknown; [k: string]: unknown }

export interface EmbeddedAdapterOptions extends KernelOptions {
  /** DSH model provider (默认 'deepseek-official') */
  provider?: string
  /** DSH model id (默认 'deepseek-v4-flash') */
  model?: string
  /** 最大 token (默认 49_152) */
  maxTokens?: number
  /** DSH 运行时入口（默认指向 vsce 内置 bundled dsh-source） */
  runtimeLaunch?: { command: string; args?: string[]; cwd?: string }
}

export class EmbeddedKernelAdapter implements KernelAdapter {
  readonly mode: KernelMode = 'embedded'

  private harness: DeepSeekHarness | null = null
  private subscription: NotificationSubscription | null = null
  private listeners = new Map<KernelEvent['type'], Set<Listener>>()
  private running = false
  private options: EmbeddedAdapterOptions | null = null

  constructor(private readonly outputChannel: { appendLine: (s: string) => void }) {}

  async start(options: EmbeddedAdapterOptions): Promise<void> {
    if (this.running) return
    this.options = options
    const { runtimeLaunch, provider, model, maxTokens, workspaceRoot } = options
    if (!runtimeLaunch) {
      throw new Error('[EmbeddedKernelAdapter] runtimeLaunch 未配置；请指定 dsh-source/lib/bin.js 路径')
    }
    this.outputChannel.appendLine(`[kernel/embedded] 启动 DSH runtime: ${runtimeLaunch.command} ${(runtimeLaunch.args ?? []).join(' ')}`)

    // 动态 import 避免构建时硬依赖（ESM/CJS 兼容点）
    const { DeepSeekHarness } = await import('@deepseek-ai/dsh-sdk-client')
    this.harness = new DeepSeekHarness({
      launch: {
        command: runtimeLaunch.command,
        args: runtimeLaunch.args ?? [],
        cwd: runtimeLaunch.cwd ?? workspaceRoot,
      },
      provider: provider ?? 'deepseek-official',
      model: model ?? 'deepseek-v4-flash',
      maxTokens: maxTokens ?? 49_152,
    })

    // 启动 DSH 子进程并完成握手
    this.outputChannel.appendLine('[kernel/embedded] 正在启动 DSH runtime...')
    await this.harness.start()
    this.outputChannel.appendLine('[kernel/embedded] DSH runtime 已启动')

    // 订阅事件流（透传 DSH notification → 适配器事件）
    this.subscription = this.harness.client.subscribe()
    this.consumeSubscription(this.subscription)

    this.running = true
    this.emit({ type: 'ready' })
  }

  async stop(): Promise<void> {
    if (!this.running) return
    this.running = false
    if (this.subscription) {
      try { await this.subscription.return?.() } catch { /* ignore */ }
      this.subscription = null
    }
    if (this.harness) {
      try { await this.harness.close() } catch { /* ignore */ }
      this.harness = null
    }
    this.emit({ type: 'closed' })
  }

  async send(message: UserMessage): Promise<void> {
    if (!this.harness || !this.subscription) {
      throw new Error('内核未启动')
    }
    // 高层 API：run() 一次完整对话（消息 → 流式 notification → finalResponse）
    // 我们这里用低层 prompt + 订阅：把消息发给 agent，让流继续推送
    // （SDK 文档：高层 run() 收从收到 receipt 到下一次 idle；这里我们用 promise 兼顾同步推送）
    const session = this.harness.session() // fresh session
    const onNotification = (n: WireEvent) => this.routeEvent(n)
    await session.run(message.content, { onNotification }).catch((err: unknown) => {
      this.routeEvent({ kind: 'error', payload: this.toErrorPayload(err) })
    })
  }

  on(event: KernelEvent['type'], cb: Listener): Disposable {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(cb)
    return () => this.listeners.get(event)?.delete(cb)
  }

  async version(): Promise<string> {
    // SDK 未直接暴露 version；embed 一个常量
    return '0.1.1-rc.2'
  }

  health(): boolean {
    return this.running
  }

  // ─── 内部：异步消费订阅 → 路由到适配器事件 ──────────────

  private async consumeSubscription(sub: NotificationSubscription): Promise<void> {
    void this.consumeSubscriptionImpl(sub)
  }

  private async consumeSubscriptionImpl(sub: NotificationSubscription): Promise<void> {
    try {
      while (true) {
        const next = await sub.tryNext()
        if (next === undefined || next === null) {
          // 没有更多事件，主动 yield 让出线程
          await new Promise((r) => setImmediate(r))
          continue
        }
        this.routeEvent(next as unknown as WireEvent)
      }
    } catch (err) {
      const payload = this.toErrorPayload(err)
      if (this.isTransportClosed(err)) {
        this.outputChannel.appendLine(`[kernel/embedded] DSH runtime 已退出: ${payload.message}`)
      } else {
        this.outputChannel.appendLine(`[kernel/embedded] 订阅异常: ${payload.message}`)
      }
      this.emit({ type: 'error', payload })
      this.running = false
    }
  }

  private routeEvent(n: WireEvent): void {
    if (!n || typeof n !== 'object') return
    const kind = String(n.kind ?? n.event ?? n.type ?? '')

    // 流式 token / 助手消息增量
    if (kind === 'message.delta' || kind === 'message_part' || kind === 'text_chunk') {
      const text = String((n.payload as { content?: string })?.content ?? (n.payload as { text?: string })?.text ?? '')
      if (text) this.emit({ type: 'message.delta', payload: { content: text } })
      return
    }

    // 整段消息（final 或 stop）
    if (kind === 'message' || kind === 'agent.message' || kind === 'assistant_message') {
      const content = (n.payload as { content?: string })?.content ?? ''
      if (content) this.emit({ type: 'message', payload: { content } })
      return
    }

    // 工具调用（请求 / 完成）
    if (kind === 'tool_use' || kind === 'tool_call' || kind === 'toolCall') {
      const p = (n.payload ?? {}) as { id?: string; name?: string; arguments?: unknown }
      this.emit({ type: 'toolCall', payload: { id: p.id ?? '', name: p.name ?? '', args: p.arguments ?? {}, status: 'running' } })
      return
    }

    if (kind === 'tool_result' || kind === 'toolResult') {
      const p = (n.payload ?? {}) as { id?: string; name?: string; result?: unknown; isError?: boolean }
      this.emit({ type: 'toolResult', payload: { id: p.id ?? '', name: p.name ?? '', result: p.result, status: p.isError ? 'failure' : 'success' } })
      return
    }

    // Idle / 错误
    if (kind === 'idle' || kind === 'turn_end' || kind === 'session.idle') {
      return
    }
    if (kind === 'error' || kind === 'agent.error') {
      this.emit({ type: 'error', payload: this.toErrorPayload(n.payload) })
      return
    }

    // 其余事件：透传为 message（UI 可显示原始事件做调试）
    this.emit({ type: 'message', payload: { kind, content: JSON.stringify(n.payload ?? n) } })
  }

  private emit(ev: KernelEvent): void {
    this.listeners.get(ev.type)?.forEach((cb) => {
      try { cb(ev) } catch (e) { console.error('[EmbeddedKernelAdapter] listener error', e) }
    })
  }

  private toErrorPayload(err: unknown): { message: string; stack?: string } {
    if (err instanceof Error) {
      const e = err as Error & { code?: number; data?: unknown }
      return { message: `${err.name}: ${err.message}${e.code ? ` (code=${e.code})` : ''}`, stack: err.stack }
    }
    return { message: String(err) }
  }

  private isTransportClosed(err: unknown): boolean {
    return Boolean(err && typeof err === 'object' && (err as { name?: string }).name === 'TransportClosedError')
  }
}

// 引入 SDK 中导出的异常类型，避免 TS 把 `instanceof` 拍平
export type {
  JsonRpcResponseError,
  RequestTimeoutError,
  SdkProtocolError,
  TransportClosedError,
}
