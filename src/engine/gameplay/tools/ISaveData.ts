/**
 * ISaveData — 存档数据契约
 *
 * SaveSystem 只搬运 SaveData，不解释 payload；序列化语义完全由各游戏的
 * GameInstance.restoreSnapshot 负责。meta 冗余存 score/phase，供槽位列表展示
 * 而无需解析 payload。formatVersion 用于未来集中迁移（在 SaveSystem.load 内处理）。
 */

/** 当前存档格式版本；格式变更时递增并在 SaveSystem 增加迁移逻辑 */
export const SAVE_FORMAT_VERSION = 1

/**
 * 存档元信息。
 * 结构与 electron.d.ts 中 listGameSaves 返回的 meta 对齐（renderer 侧具名类型）。
 */
export interface SaveMeta {
  formatVersion: number
  /** 游戏名（currentProject.name），用于游戏隔离校验 */
  game: string
  gameVersion?: string
  /** 槽位名：'auto' | 'quick' | 'slot-1' | ... */
  slot: string
  /** ISO 时间戳 */
  savedAt: string
  /** 冗余分数，供列表展示 */
  score: number
  phase?: string
  /** 用户可见名（可选，默认用 savedAt） */
  label?: string
}

/** 一份完整存档：meta + 游戏自定义 payload */
export interface SaveData {
  meta: SaveMeta
  /** GameInstance.captureSnapshot() 的原始输出，游戏自定义结构 */
  payload: unknown
}

/** 槽位列表项（listGameSaves 返回，仅 meta，不含 payload） */
export interface SaveSlotInfo {
  slot: string
  meta: SaveMeta
}
