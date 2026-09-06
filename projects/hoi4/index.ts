/**
 * Hoi4 — 工程入口（集中 re-export 便于 register.ts 引用）
 */
export { Hoi4GameInstance } from './Hoi4GameInstance'
export { Hoi4GameMode } from './gameplay/base/Hoi4GameMode'
export { Hoi4ConfigLoader } from './Hoi4ConfigLoader'
export { initHoi4Configs } from './configs'

/** core 纯逻辑（测试/工具可直接 import） */
export { GameTime, formatGameDate } from './gameplay/core/GameTime'
export { MapData } from './gameplay/core/MapData'
export { makeTables } from './gameplay/core/tables'
export type { Hoi4Tables } from './gameplay/core/tables'
export { createInitialState, serializeState, deserializeState } from './gameplay/core/Hoi4State'
