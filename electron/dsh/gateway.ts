/**
 * DSH 编辑器方言契约（Editor Dialect）—— 适配层与编辑器之间的唯一接口
 *
 * 分层铁律：
 *   编辑器（src/editor/AgentService.ts + src/types/agent.ts）只认识本文件定义的方言；
 *   内核（@deepseek-ai/dsh）的线上协议只出现在 electron/dsh/adapters/<ver>.ts。
 *   内核破坏性升级 = 新增一个适配器文件 + 注册表加一行；编辑器代码零改动。
 *
 * 方言演进规则：只增不改（additive-only）。方言方法名/帧词汇/事件字段一旦发布即冻结，
 * 改名/改形一律在适配器的 translateRpc / 流翻译层完成。破坏性演进时递增 DIALECT_VERSION。
 */

/** 编辑器方言版本（dsh-status 上报，契约测试按此组织） */
export const DIALECT_VERSION = 1

/** 方言 RPC 的一次翻译结果：线上方法 + 完整线上载荷 + 可选响应重排 */
export interface DshRpcTranslation {
  /** 线上方法名（如 0.1.7 的 'session/list'） */
  wireMethod: string
  /** 方言载荷 → 完整线上载荷（含信封：typert 的 {args:…} 由适配器在此包好） */
  toArgs: (payload: Record<string, unknown>) => Record<string, unknown>
  /** 线上响应 → 方言响应（渲染层零感知内核形状变化） */
  reshape?: (value: unknown) => unknown
}

/** 方言 RPC 翻译入口（适配器实现；未登记的方言方法必须 throw——fail loud 优于静默 404） */
export interface DialectRpcResult {
  method: string
  payload: Record<string, unknown>
  reshape?: (value: unknown) => unknown
}

/** 能力标志：渲染层逻辑分支只读能力名，永不读内核版本号 */
export interface DshCapabilities {
  /** web 鉴权（0.1.7+ 强制 cookie） */
  authRequired: boolean
  /** assistant-stream 瞬态流式帧（0.1.7+，chunk 不再落会话事件） */
  assistantStream: boolean
  /**
   * /api/events.host 主机状态机流。
   * 0.1.7+ 内核已移除该端点（主机级事件由 mux $events 流翻译承载）→ false；
   * connectHostWs 以本标志 + hostEndpoint 非空为连接前置条件。
   */
  hostStream: boolean
  /** session/projection 投影帧（标题/统计实时推送） */
  projection: boolean
  /** contextPressure 会话投影（上下文占用权威源） */
  contextPressure: boolean
}

/** 流桥模式：0.1.7 单连接多路复用 vs 旧版 events.mux 裸下行 */
export type DshStreamMode = 'remote-mux' | 'legacy-events'

/**
 * 内核适配器：一个内核大版本协议世界的全部知识，一个文件一个实例，可插拔可替换。
 * 注册表见 ../registry.ts（新版本在前）；内核回退后旧适配器自动重新选中。
 */
export interface DshKernelAdapter {
  /** 适配器 id（如 'dsh017'），日志与 dsh-status 上报用 */
  readonly id: string
  /** 该适配器覆盖的内核版本谓词（入参为归一化后的 semver 串；空串永不合） */
  matches(version: string): boolean
  readonly capabilities: DshCapabilities
  readonly streamMode: DshStreamMode
  /** mux WS 端点路径（按内核代际不同：/api/remote.mux vs /api/events.mux） */
  readonly muxEndpoint: string
  /** host 流端点路径（空串 = 内核无此端点，host 桥不连接） */
  readonly hostEndpoint: string
  /**
   * 方言 RPC → 线上方法。纯函数：禁止副作用（会话激活等由 rpcProxy 统一处理）；
   * 未登记的方言方法必须 throw Error（fail loud）。
   */
  translateRpc(method: string, payload: Record<string, unknown>): DialectRpcResult
  /**
   * 会话事件加法归一化（wire 形状 → 方言字段；可选，缺省用 eventMap.normalizeSessionEvent）。
   * 加法式：只增字段不改字段，渲染层的防御式收窄继续成立。
   */
  normalizeSessionEvent?(event: Record<string, unknown>): Record<string, unknown>
}
