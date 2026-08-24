/**
 * DSH 内核适配器接口（上层唯一依赖入口）。
 *
 * 设计要点：
 * - 所有 DSH 交互必须经过本接口；UI / 命令 / EngineBridge 不得直接 import dsh-headless
 * - 第一版仅实现 `embedded` 模式（进程内 import）；未来可扩展 `cli-stdio` 模式不改上层
 * - 事件流格式沿用 DSH 原生协议，薄协议层只做透传
 */
export type KernelMode = 'embedded'

export interface KernelOptions {
  /** DSH profile 名（默认 demostudio） */
  profile?: string
  /** 工作区根目录绝对路径 */
  workspaceRoot: string
  /** 附加调试选项 */
  debug?: boolean
}

/** 发送给 DSH agent 的用户消息 */
export interface UserMessage {
  role: 'user'
  content: string
  /** @提及的文件 / 工具引用 */
  attachments?: Array<{ kind: 'file' | 'tool'; ref: string }>
}

/** 内核事件（透传 DSH 原生事件流） */
export type KernelEvent =
  | { type: 'message'; payload: unknown }
  | { type: 'message.delta'; payload: { content: string } }
  | { type: 'toolCall'; payload: { id: string; name: string; args: unknown; status: 'pending' | 'running' } }
  | { type: 'toolResult'; payload: { id: string; name: string; result: unknown; status: 'success' | 'failure' } }
  | { type: 'error'; payload: { message: string; stack?: string } }
  | { type: 'cancelled' }
  | { type: 'ready' }
  | { type: 'closed' }

export type Listener = (event: KernelEvent) => void
export type Disposable = () => void

/**
 * 内核适配器抽象接口。
 * `EmbeddedKernelAdapter`（M2 实装）实现进程内 import 模式。
 */
export interface KernelAdapter {
  readonly mode: KernelMode
  start(options: KernelOptions): Promise<void>
  stop(): Promise<void>
  send(message: UserMessage): Promise<void>
  /** 取消当前正在进行的 AI 生成（中止活跃 turn，保留待处理队列） */
  cancel(): Promise<void>
  on(event: KernelEvent['type'], cb: Listener): Disposable
  version(): Promise<string>
  health(): boolean
}
