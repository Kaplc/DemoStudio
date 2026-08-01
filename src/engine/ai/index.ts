/**
 * engine/ai — AI 事件模块（AI 经 MCP 控制游戏场景的事件总线）
 */
export { AIModule } from './AIModule'
export type { AIEventContext, AIEventHandler, AIEmitResult } from './AIModule'
export { registerBuiltinAIHandlers } from './registerBuiltinAIHandlers'
export * from './AIEvents'
