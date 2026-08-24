/**
 * M0 占位：未实装的 KernelAdapter。
 * 仅在 `dsh.kernelEnabled` 为 false 时使用，避免 M0 阶段启动报错。
 * M2 将替换为 import @deepseek-ai/dsh-headless 的真实实现。
 */
import {
  KernelAdapter,
  KernelMode,
  KernelOptions,
  UserMessage,
  KernelEvent,
  Listener,
  Disposable
} from './adapter'

export class StubKernelAdapter implements KernelAdapter {
  readonly mode: KernelMode = 'embedded'
  private listeners = new Map<KernelEvent['type'], Set<Listener>>()
  private running = false

  async start(_options: KernelOptions): Promise<void> {
    this.running = true
    this.emit({ type: 'ready' })
  }

  async stop(): Promise<void> {
    this.running = false
    this.emit({ type: 'closed' })
  }

  async send(_message: UserMessage): Promise<void> {
    // M0 占位：只回显
    this.emit({
      type: 'message.delta',
      payload: { content: '[M0 stub] DSH 内核尚未接入；M2 实装嵌入式适配器。\n' }
    })
    this.emit({
      type: 'message',
      payload: { content: '已收到你的消息。' }
    })
  }

  async cancel(): Promise<void> {
    // Stub 模式无真实 turn，静默返回
  }

  on(event: KernelEvent['type'], cb: Listener): Disposable {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(cb)
    return () => this.listeners.get(event)?.delete(cb)
  }

  async version(): Promise<string> {
    return '0.0.0-stub'
  }

  health(): boolean {
    return this.running
  }

  private emit(event: KernelEvent): void {
    this.listeners.get(event.type)?.forEach((cb) => {
      try { cb(event) } catch (e) { console.error('[StubKernelAdapter] listener error', e) }
    })
  }
}
