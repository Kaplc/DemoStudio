/**
 * 性能采集器子模块 barrel（引擎内部用；编辑器页可安全引用——
 * perf 独立窗口不要引这里，快照类型走 src/types/perf.ts）
 */
export { PerfStatsCollector } from './PerfStatsCollector'
export { createBuiltinPerfModules } from './builtinModules'
export type { IPerfModule, PerfSampleContext } from './PerfTypes'
