/**
 * 斜杠命令系统
 * 
 * 使用方法：
 * 
 * ```tsx
 * import { commandRegistry, SlashMenu, detectTrigger } from '@/systems/slash-command'
 * 
 * // 注册命令
 * commandRegistry.register({
 *   name: 'compact',
 *   description: '压缩对话历史',
 *   icon: '📦',
 *   handler: () => { ... }
 * })
 * 
 * // 在组件中使用
 * const { isMenuOpen, menuProps } = useSlashCommand({
 *   inputRef,
 *   onCommand: (cmd) => handleCommand(cmd)
 * })
 * ```
 */

// 核心模块
export { CommandRegistry, commandRegistry } from './CommandRegistry'
export { detectTrigger, filterCandidates } from './SlashDetector'
export { SlashMenu } from './SlashMenu'
export { useSlashCommand } from './useSlashCommand'

// 类型导出
export type {
  SlashCommand,
  CommandSource,
  TriggerHit,
  MenuState,
  MenuEvent,
} from './types'

// DSH 命令来源
export {
  registerDshCommandSource,
  registerDshSkillSource,
  createDshCommandSource,
  createDshSkillSource,
} from './builtin-commands'
