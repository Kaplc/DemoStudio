/**
 * @demostudio/ds-memory — DSH 记忆系统插件入口。
 *
 * 注册即副作用，全部贡献挂在插件 fiber 上（卸载自动回滚）：
 * - `ctx.systemPrompt.section()` — 常驻"记忆指导"段（含 MEMORY.md 索引，仅在有内容时注入）
 * - `ctx.tools.register()` × 5 — memory_write / memory_search / memory_forget / memory_review / memory_list
 * - `ctx.on('tools/pre-execute'/'tools/result'/'agent/pre-step')` — prefix 文件自动联想：
 *   读到记忆 `prefix:` 触发文件列表中的文件时把该记忆全文自动注入（每会话一次）；
 *   只按具体文件精确匹配（2026-09-12 起目录前缀、`&&`/`||` 表达式、`/` 全局废弃）
 * - 回合末记忆提醒：2026-09-13 起移交给 @demostudio/ds-reminder 通用提醒插件
 *   （提醒文本在 .dsh/reminder/memory-end-of-turn.md；steer 通道注入，跳过判定只认
 *   memory_write——与经验提醒"各自只看自己"，双写场景互不抑制）
 *
 * 记忆保存与检索的默认分工：
 * - 保存：主 agent 在回合内主动调用 memory_write（指导段 SAVE_FLOW_TEXT 给出具体触发点）
 *   + 回合末提醒兜底（由 @demostudio/ds-reminder 注入）
 * - 检索：声明 prefix 的记忆由联想器按触发文件列表自动注入；未声明的按需 memory_search
 * 子 agent（delegationDepth > 0）变更类记忆工具（write/forget/review）在工具层拒绝调用，
 * 联想注入也只服务主 agent（上下文归属父 agent）。
 *
 * @module @demostudio/ds-memory
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { deriveProjectRoot, registerAssociator } from './associate.js'
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
  /**
   * 是否启用 prefix 自动联想（默认 true）：读到记忆 prefix 声明的触发文件列表
   * 中的文件时自动注入其全文（按具体文件精确匹配）。联想基准的项目根从
   * memoryDir 推导（<root>/.dsh/memory 形态）；推导不出时联想自动停用并记 warn 日志。
   */
  enableAutoAssociate?: boolean
}

/** Loader 配置 schema：默认值在此声明，代码内另有 DEFAULT_* 兜底。 */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  memoryDir: z.string(),
  enableAutoAssociate: z.boolean().default(true),
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
    enableAutoAssociate: config?.enableAutoAssociate ?? true,
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

  // ── 5 个显式记忆工具 ──
  for (const tool of createMemoryTools({
    memoryDirectory,
    ctx,
  })) {
    ctx.tools.register(tool)
  }

  // ── prefix 文件自动联想（默认开；项目根推导不出时停用并 warn） ──
  if (resolved.enableAutoAssociate) {
    const associationRoot = deriveProjectRoot(memoryDirectory)
    if (associationRoot === undefined) {
      logger.warn(
        'enableAutoAssociate 已开启但无法从 memoryDir (%s) 推导项目根（期望 <root>/.dsh/memory 形态）；自动联想停用',
        memoryDirectory,
      )
    } else {
      registerAssociator(ctx, {
        memoryDirectory,
        projectRoot: associationRoot,
      })
      logger.info('prefix 文件联想已启用（按具体文件精确匹配；项目根 %s）', associationRoot)
    }
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
