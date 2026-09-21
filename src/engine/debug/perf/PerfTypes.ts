/**
 * 性能采集模块接口 —— PerfStatsCollector 的扩展点定义。
 *
 * 新增分析维度（GPU 计时 / 物理 / 音频 / 项目自定义…）= 实现 IPerfModule +
 * PerfStatsCollector.instance().register(mod)，快照 / AI 读数 / 面板零改动自动纳管：
 *  - 快照 modules 键 = module.name（新模块即新键）
 *  - ai.getPerfStats 自动带出新键
 *  - 面板对未知键走通用表格渲染
 */
import type { World } from '../../gameflow/World'

/** 采样上下文：采集器每 tick 构造，模块只读 */
export interface PerfSampleContext {
  /** 当前运行的 World（游戏未运行时 null） */
  world: World | null
  /** 本次采集时间戳（performance.now()，毫秒） */
  nowMs: number
  /** 距上次采集毫秒（首帧为 0） */
  dtMs: number
}

/** 单个性能采集模块 */
export interface IPerfModule {
  /** 快照 modules 键（如 'fps' / 'render'，全局唯一，重复注册覆盖并告警） */
  readonly name: string
  /** 面板显示名 */
  readonly label: string
  /** 采样间隔毫秒；0 = 每帧采样（仅限 O(1) 读字的廉价模块） */
  readonly intervalMs: number
  /** 采集开始时调用（幂等要求：stop→start 会再次触发） */
  setup?(ctx: PerfSampleContext): void
  /**
   * 采样一次。返回 null 表示本帧无数据（快照沿用上次输出）。
   * 抛异常被采集器捕获记 warn，不影响其他模块。
   */
  sample(ctx: PerfSampleContext): Record<string, unknown> | null
  /** 采集停止时调用（PerformanceObserver 等资源释放） */
  dispose?(): void
}
