/**
 * @demostudio/ds-memory — DSH 记忆系统插件入口。
 *
 * 注册即副作用，全部贡献挂在插件 fiber 上（卸载自动回滚）：
 * - `ctx.systemPrompt.section()` — 常驻"记忆指导"段（含 MEMORY.md 索引，仅在有内容时注入）
 * - `ctx.tools.register()` × 4 — memory_write / memory_search / memory_forget / memory_review
 * - `ctx.on('session/event')` — 回合末（turn/end）主动注入记忆提醒，提示 agent 检查是否需要保存记忆
 *
 * 记忆保存与检索完全由主 agent 自觉调用工具完成：
 * - 保存：主 agent 在回合内主动调用 memory_write（指导段 SAVE_FLOW_TEXT 给出具体触发点）
 *   + 回合末自动提醒（END_OF_TURN_REMINDER_TEXT）
 * - 检索：主 agent 看到 MEMORY.md 索引后，相关时主动调用 memory_search 按需检索
 * 子 agent（delegationDepth > 0）变更类记忆工具（write/forget/review）在工具层拒绝调用。
 *
 * @module @demostudio/ds-memory
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { truncateEntrypoint } from './memoryScan.js'
import {
  MEMORY_ENTRYPOINT,
  memoryGuideSectionText,
} from './memoryTypes.js'
import { memoryDir } from './paths.js'
import { createMemoryTools } from './tools.js'

export const name = '@demostudio/ds-memory'

/** 本插件访问的 Cordis 服务（未声明 inject 的服务键会被 ctx Proxy 拒绝）。 */
export const inject = ['tools', 'systemPrompt']

/** 记忆指导段在 system prompt 中的排序（工具段之后、结构化输出之前的空档）。 */
const SECTION_NAME = 'memory:guide'
const SECTION_ORDER = 3200

/** 回合末记忆提醒间隔（毫秒）：防止过于频繁地注入提醒。 */
const REMINDER_COOLDOWN_MS = 60_000

/** 插件配置（cordis.yml 可配置项）。 */
export interface Config {
  /** 总开关：false 时所有 section/工具/事件监听全部不注册（默认 true）。 */
  enabled?: boolean
  /**
   * 记忆目录（绝对路径，或相对 cwd 的路径）。
   * 缺省 = <cwd>/.dsh/memory。编辑器以 dsh-source 为 cwd 拉起内核时，
   * 用此配置把记忆钉到项目根（如 E:/DemoStudio/.dsh/memory）。
   */
  memoryDir?: string
  /** 是否启用回合末自动提醒（默认 true）。 */
  enableEndOfTurnReminder?: boolean
}

/** Loader 配置 schema：默认值在此声明，代码内另有 DEFAULT_* 兜底。 */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  memoryDir: z.string(),
  enableEndOfTurnReminder: z.boolean().default(true),
})

/**
 * 注册记忆系统全部贡献。
 * @param ctx - Cordis 上下文（tools/systemPrompt 需在 inject 中声明）。
 * @param config - cordis.yml 配置；未提供时使用内置默认值。
 */
export function apply(ctx: Context, config?: Config): void {
  const resolved = {
    enabled: config?.enabled ?? true,
    memoryDir: config?.memoryDir,
    enableEndOfTurnReminder: config?.enableEndOfTurnReminder ?? true,
  }
  // enabled: false — 一切静默，什么都不注册
  if (!resolved.enabled) return

  const projectRoot = process.cwd()
  // 记忆目录：配置显式指定优先（编辑器以 dsh-source 为 cwd 拉起内核时钉到项目根），否则 <cwd>/.dsh/memory
  const memoryDirectory = resolved.memoryDir !== undefined && resolved.memoryDir.trim() !== ''
    ? resolve(resolved.memoryDir.trim())
    : memoryDir(projectRoot)

  const logger = ctx.logger('ds-memory')

  // ── 常驻记忆指导段（含 MEMORY.md 索引；索引仅在有内容时注入，300 行/40KB 截断） ──
  ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    text: () => memoryGuideSectionText(readEntrypointSync(memoryDirectory)),
  })

  // ── 4 个显式记忆工具 ──
  for (const tool of createMemoryTools({
    memoryDirectory,
    ctx,
  })) {
    ctx.tools.register(tool)
  }

  // ── 回合末记忆提醒（可配置关闭） ──
  if (resolved.enableEndOfTurnReminder) {
    // 记录上次提醒时间，防止过于频繁
    let lastReminderTime = 0

    ctx.on('session/event', (session: Session, event: SessionEvent) => {
      // 只在 turn/end 时触发
      if (event.type !== 'turn/end') return

      // 检查冷却时间
      const now = Date.now()
      if (now - lastReminderTime < REMINDER_COOLDOWN_MS) {
        return
      }

      // 注入提醒消息
      const reminderMessage = `## 回合末记忆提醒

本回合即将结束。快速回顾是否有值得跨会话记住的信息：
- 用户纠正或确认了某个方向？
- 做出了架构/设计/工作流决策？
- 定位到可复用的根因教训？
- 了解到用户的角色/偏好/工作习惯？
- 拿到外部系统指针（看板/文档站 URL）？

如果有，立即调用 memory_write 保存。如果没有触发点，不要保存。`

      try {
        // 通过 agent.inject() 注入提醒
        // 注意：需要获取当前 agent 的引用
        // session 对象中有 agent 引用
        const agent = (session as any).agent
        if (agent && typeof agent.inject === 'function') {
          agent.inject({
            content: reminderMessage,
            source: 'ds-memory:end-of-turn-reminder',
          })
          lastReminderTime = now
          logger.info('已注入回合末记忆提醒')
        }
      } catch (error) {
        // 注入失败不应阻塞对话
        logger.warn('回合末记忆提醒注入失败:', error)
      }
    })
  }
}

/**
 * 同步读取并截断 MEMORY.md（section text provider 是同步接口；
 * 小索引文件的同步 IO 可接受）。目录/文件不存在或为空返回 undefined。
 */
function readEntrypointSync(memoryDirectory: string): string | undefined {
  try {
    const text = readFileSync(join(memoryDirectory, MEMORY_ENTRYPOINT), 'utf8').trim()
    if (text.length === 0) return undefined
    return truncateEntrypoint(text).text
  } catch {
    return undefined
  }
}
