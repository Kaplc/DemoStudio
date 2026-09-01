/**
 * @demostudio/ds-experience — DSH 行为飞轮插件入口。
 *
 * 注册即副作用，全部贡献挂在插件 fiber 上（卸载自动回滚）：
 * - `ctx.systemPrompt.section()` — 常驻"经验库指导"段（order 3000；含 INDEX.md 索引，
 *   仅在有内容时注入；分工声明：记忆=事实与规则热通道，经验=做事轨迹冷通道）
 * - `ctx.tools.register()` × 4 — history_search / history_read（包装 ctx.sessionQuery）/
 *   experience_save / experience_search（按文件名直接读取）
 *
 * 经验保存与检索完全由主 agent 自觉调用工具完成（system prompt 指导段驱动），
 * 不做回合末自动提炼，不走 LLM 检索。
 *
 * @module @demostudio/ds-experience
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  EXPERIENCE_DIR_SEGMENT,
  EXPERIENCE_INDEX_FILE,
  MAX_INDEX_BYTES,
  MAX_INDEX_LINES,
  PLUGIN_NAME,
  SECTION_NAME,
  SECTION_ORDER,
  experienceGuideSectionText,
} from './experienceTypes.js'
import { createExperienceTools } from './experienceTools.js'
import { createHistoryTools } from './historyTools.js'

export const name = PLUGIN_NAME

/** 本插件访问的 Cordis 服务（未声明 inject 的服务键会被 ctx Proxy 拒绝）。 */
export const inject = ['tools', 'systemPrompt', 'sessionQuery']

/** 插件配置（cordis.yml 可配置项）。 */
export interface Config {
  /** 总开关：false 时所有 section/工具/事件监听全部不注册（默认 true）。 */
  enabled?: boolean
  /**
   * 经验目录（绝对路径，或相对 cwd 的路径）。
   * 缺省 = <cwd>/.dsh/experience。编辑器以 dsh-source 为 cwd 拉起内核时，
   * 用此配置把经验库钉到项目根（如 E:/DemoStudio/.dsh/experience）。
   */
  experienceDir?: string
}

/** Loader 配置 schema：默认值在此声明，代码内另有 DEFAULT_* 兜底。 */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  experienceDir: z.string(),
})

/**
 * 注册经验系统全部贡献。
 * @param ctx - Cordis 上下文（tools/systemPrompt/sessionQuery 需在 inject 中声明）。
 * @param config - cordis.yml 配置；未提供时使用内置默认值。
 */
export function apply(ctx: Context, config?: Config): void {
  const resolved = {
    enabled: config?.enabled ?? true,
    experienceDir: config?.experienceDir,
  }
  // enabled: false — 一切静默，什么都不注册
  if (!resolved.enabled) return

  const projectRoot = process.cwd()
  // 经验目录：配置显式指定优先（编辑器以 dsh-source 为 cwd 拉起内核时钉到项目根）
  const experienceDirectory = resolved.experienceDir !== undefined && resolved.experienceDir.trim() !== ''
    ? resolve(resolved.experienceDir.trim())
    : resolve(join(projectRoot, EXPERIENCE_DIR_SEGMENT))

  // ── 常驻经验指导段（含 INDEX.md 索引；索引仅在有内容时注入，300 行/40KB 截断） ──
  ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    text: () => experienceGuideSectionText(readIndexSync(experienceDirectory)),
  })

  // ── 4 个显式工具 ──
  for (const tool of createHistoryTools({ ctx })) {
    ctx.tools.register(tool)
  }
  for (const tool of createExperienceTools({
    experienceDirectory,
    ctx,
  })) {
    ctx.tools.register(tool)
  }
}

/**
 * 同步读取并截断 INDEX.md（section text provider 是同步接口；
 * 小索引文件的同步 IO 可接受）。目录/文件不存在或为空返回 undefined。
 */
function readIndexSync(experienceDirectory: string): string | undefined {
  try {
    const text = readFileSync(join(experienceDirectory, EXPERIENCE_INDEX_FILE), 'utf8').trim()
    if (text.length === 0) return undefined
    return truncateIndexText(text)
  } catch {
    return undefined
  }
}

/** 索引截断（300 行/40KB，同 memory 索引水位语义）。 */
function truncateIndexText(text: string): string {
  let lines = text.split('\n')
  let truncated = false
  if (lines.length > MAX_INDEX_LINES) {
    lines = lines.slice(0, MAX_INDEX_LINES)
    truncated = true
  }
  let result = lines.join('\n')
  if (Buffer.byteLength(result, 'utf8') > MAX_INDEX_BYTES) {
    while (Buffer.byteLength(result, 'utf8') > MAX_INDEX_BYTES && result.length > 0) {
      result = result.slice(0, Math.floor(result.length * 0.9))
    }
    truncated = true
  }
  return truncated ? `${result}\n[...索引过长已截断]` : result
}
