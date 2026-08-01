/**
 * AIEvents — AI 事件常量与 payload 类型定义
 *
 * AI（经 MCP）通过 AIModule.emit 触发这些事件来控制游戏场景。
 * 约定：
 *  - 事件名统一 `ai.` 前缀（小写点分）
 *  - 每个事件一个常量 + 一个 payload 接口，方便配置与添加
 *  - 添加新事件：① 在此定义常量/类型 ② 在 registerBuiltinAIHandlers 注册处理器
 */

// ═══════════════════════════════════════
//  事件名常量
// ═══════════════════════════════════════

/** 通用通知（日志/控制台），不需要游戏运行 */
export const AI_EVENT_NOTIFY = 'ai.notify'

/** 生成 Actor（按蓝图路径或 baseClass） */
export const AI_EVENT_SPAWN_ACTOR = 'ai.spawnActor'
/** 按名称销毁 Actor */
export const AI_EVENT_DESTROY_ACTOR = 'ai.destroyActor'
/** 移动/旋转/缩放指定 Actor */
export const AI_EVENT_TRANSFORM_ACTOR = 'ai.transformActor'
/** 设置分数 */
export const AI_EVENT_SET_SCORE = 'ai.setScore'
/** 累加分数 */
export const AI_EVENT_ADD_SCORE = 'ai.addScore'
/** 游戏结束 */
export const AI_EVENT_GAME_OVER = 'ai.gameOver'
/** 切换场景（mode 或场景文件） */
export const AI_EVENT_SWITCH_SCENE = 'ai.switchScene'
/** 查询运行状态（分数/阶段/Actor 列表等，处理器返回值回传 AI） */
export const AI_EVENT_GET_STATE = 'ai.getState'
/** 在 UI 上显示一条消息（无现成 toast 时回退为日志通知） */
export const AI_EVENT_SHOW_MESSAGE = 'ai.showMessage'

/** 点击指定 Actor 上的 UI 按钮（按名称，不依赖鼠标坐标） */
export const AI_EVENT_CLICK_ACTOR = 'ai.clickActor'

// ═══════════════════════════════════════
//  Payload 类型
// ═══════════════════════════════════════

export interface AINotifyPayload {
  message: string
  /** 日志级别，默认 info */
  level?: 'info' | 'warn' | 'error'
}

export interface AISpawnActorPayload {
  /** 蓝图路径（优先）；提供时经 World.SpawnActorFromBlueprint 生成 */
  blueprint?: string
  /** baseClass（ActorRegistry 注册名），blueprint 缺失时使用 */
  baseClass?: string
  name?: string
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: [number, number, number]
}

export interface AIDestroyActorPayload {
  /** Actor 名称（精确匹配，支持用 .name 或 root.name） */
  name: string
}

export interface AITransformActorPayload {
  /** Actor 名称 */
  name: string
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: [number, number, number]
}

export interface AISetScorePayload {
  score: number
}

export interface AIAddScorePayload {
  amount: number
}

export interface AISwitchScenePayload {
  /** GameMode 名（WorldRegistry/GameModeRegistry）或场景文件路径 */
  scene: string
  mode?: string
}

export interface AIShowMessagePayload {
  text: string
  /** 展示时长秒（预留，当前实现为日志通知） */
  duration?: number
  level?: 'info' | 'warn' | 'error'
}

/** ai.clickActor payload：按 Actor 名称触发其上 UI 按钮的点击 */
export interface AIClickActorPayload {
  /** Actor 名称（精确匹配 .name 或 root.name） */
  name: string
}

/** getState 返回的运行状态摘要 */
export interface AIGameStateSnapshot {
  running: boolean
  phase: string
  score: number
  gameOver: boolean
  actorCount: number
  actors: Array<{ name: string; type: string }>
}
