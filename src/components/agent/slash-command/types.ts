/**
 * 斜杠命令系统类型定义
 * 对标 DSH WebUI 的 slash command 机制
 */

/** 斜杠命令定义 */
export interface SlashCommand {
  /** 命令名称（不含前导 /） */
  name: string
  /** 命令描述 */
  description: string
  /** 图标（emoji 或 SVG） */
  icon?: string
  /** 参数提示 */
  argumentHint?: string
  /** 命令分组 */
  group?: string
  /** 执行处理函数 */
  handler: (args?: string) => void | Promise<void>
}

/** 命令来源（可扩展） */
export interface CommandSource {
  /** 来源名称 */
  name: string
  /** 触发字符（默认 '/'） */
  trigger: string
  /** 优先级（数字越小越靠前） */
  order?: number
  /** 获取候选命令 */
  candidates: (query: string) => SlashCommand[] | Promise<SlashCommand[]>
  /** 选择回调 */
  onPick?: (command: SlashCommand) => void
}

/** 触发检测结果 */
export interface TriggerHit {
  /** 触发字符 */
  trigger: string
  /** 查询文本（触发字符后到光标前） */
  query: string
  /** 触发位置 */
  position: 'leading' | 'inline'
  /** 文本范围 */
  span: {
    start: number
    end: number
  }
}

/** 菜单状态 */
export interface MenuState {
  /** 是否打开 */
  open: boolean
  /** 当前触发检测结果 */
  hit: TriggerHit | null
  /** 候选命令列表 */
  candidates: SlashCommand[]
  /** 当前高亮索引 */
  highlightIndex: number
}

/** 菜单事件 */
export type MenuEvent =
  | { type: 'open'; hit: TriggerHit; candidates: SlashCommand[] }
  | { type: 'close' }
  | { type: 'move'; dir: 1 | -1 }
  | { type: 'select'; index: number }
  | { type: 'update-candidates'; candidates: SlashCommand[] }
