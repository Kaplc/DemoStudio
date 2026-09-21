/**
 * 性能分析器共享类型（纯类型 + 常量，零依赖）
 *
 * 三方共享：引擎采集器（src/engine/debug/perf/）、性能面板（PerfProfilerPanel）、
 * AI 读数（ai.getPerfStats 返回值）。独立成文件是刻意设计：perf 独立窗口的
 * 依赖闭包不得拉进引擎 barrel（同 agent 独立入口红线，见 agent-window-independent-entry）。
 */

/** 快照 game 段 */
export interface PerfSnapshotGame {
  /** 游戏是否运行中（停止后快照冻结为 false） */
  running: boolean
  /** 工程名（可选，面板标题展示） */
  project?: string
}

/**
 * 性能快照：采集器输出 / AI 读数 / 面板渲染的统一数据形状。
 * modules 键 = 采集模块名（内置：fps / render / scene / js）——
 * 未来新增分析模块即新增键，AI 自动可读；面板对未知键走通用表格渲染（零改动自动展示）。
 */
export interface PerfSnapshot {
  /** 快照时间戳（performance.now()，毫秒） */
  ts: number
  game: PerfSnapshotGame
  modules: Record<string, Record<string, unknown>>
}

/** ai.getPerfStats / perf-collect 往返返回结构 */
export interface PerfSnapshotResult {
  /** 采集器是否运行中 */
  running: boolean
  /** 最新快照（从未运行过为 null） */
  current: PerfSnapshot | null
  /** 历史快照（时间升序，可选；AI 默认不带，面板取全量画趋势） */
  history?: PerfSnapshot[]
}

// ─── 内置模块数据形状（面板精排渲染用；未知模块走通用渲染） ───

export interface FpsModuleData {
  /** 帧率 EMA（指数平滑） */
  fps: number
  /** 最近一帧耗时毫秒 */
  frameMs: number
}

export interface RenderModuleData {
  /** draw call 数（世界 + UI 两趟之和，autoReset 已由采集器接管） */
  calls: number
  triangles: number
  geometries: number
  textures: number
}

export interface SceneModuleData {
  worldVisible: number
  worldTotal: number
  uiVisible: number
  uiTotal: number
}

export interface JsModuleData {
  /** MB；非 Chromium 环境为 null */
  heapUsedMB: number | null
  heapTotalMB: number | null
  /** 长任务累计次数（>50ms 主线程任务） */
  longTasks: number
}

/** 内置模块键（防散落魔法串） */
export const PERF_MODULE = {
  Fps: 'fps',
  Render: 'render',
  Scene: 'scene',
  Js: 'js',
} as const
