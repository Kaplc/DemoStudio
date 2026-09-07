/**
 * WarmCurrent — 工程入口（集中 re-export 便于 register.ts 引用）
 */
export { WarmCurrentGameInstance } from './WarmCurrentGameInstance'
export { WarmCurrentGameMode } from './gameplay/base/WarmCurrentGameMode'
export { WarmCurrentConfigLoader, initWarmCurrentConfigs } from './WarmCurrentConfigLoader'

/** core 纯逻辑（测试/工具可直接 import） */
export { B, refreshBalanceFromConfigs } from './gameplay/core/balance'
export type { CardDef } from './gameplay/core/balance'
export * from './gameplay/core/helpers'
export * from './gameplay/core/types'
