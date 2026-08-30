/**
 * @demostudio/ds-feedback — DSH 反馈飞轮插件入口。
 *
 * 注册即副作用，全部贡献挂在插件 fiber 上（卸载自动回滚）：
 * - `ctx.systemPrompt.section()` — 常驻"用户反馈规则库"段（order 3100，text 每步重算：
 *   active 规则全量列出 + RULES.md 索引，apply 后当前会话立即生效）
 * - `ctx.tools.register()` × 2 — rule_propose（提案，写入 pending/ 待确认）/
 *   rule_apply（用户确认后落地 active）
 *
 * 与 ds-instructions（用户手工目录指令 `.dsh/instructions/`）完全解耦：
 * 分工固定——手工规范进指令目录，用户纠正沉淀进规则库（`.dsh/rules/`），互不读写。
 *
 * @module @demostudio/ds-feedback
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  PLUGIN_NAME,
  RULES_DIR_SEGMENT,
  RULES_INDEX_FILE,
  SECTION_NAME,
  SECTION_ORDER,
  rulesSectionText,
} from './ruleTypes.js'
import { renderIndexSync, stripFrontmatter, truncateIndex } from './ruleStore.js'
import { createRuleTools } from './tools.js'

export const name = PLUGIN_NAME

/** 本插件访问的 Cordis 服务（未声明 inject 的服务键会被 ctx Proxy 拒绝）。 */
export const inject = ['tools', 'systemPrompt']

/** 插件配置（cordis.yml 可配置项）。 */
export interface Config {
  /** 总开关：false 时 section/工具全部不注册（默认 true）。 */
  enabled?: boolean
  /**
   * 规则目录（绝对路径，或相对 cwd 的路径）。
   * 缺省 = <cwd>/.dsh/rules。编辑器以 dsh-source 为 cwd 拉起内核时，
   * 用此配置把规则库钉到项目根（如 E:/DemoStudio/.dsh/rules）。
   */
  ruleDir?: string
}

/** Loader 配置 schema：默认值在此声明，代码内另有兜底。 */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  ruleDir: z.string(),
})

/**
 * 注册反馈规则系统全部贡献。
 * @param ctx - Cordis 上下文（tools/systemPrompt 需在 inject 中声明）。
 * @param config - cordis.yml 配置；未提供时使用内置默认值。
 */
export function apply(ctx: Context, config?: Config): void {
  const resolved = {
    enabled: config?.enabled ?? true,
    ruleDir: config?.ruleDir,
  }
  // enabled: false — 一切静默，什么都不注册
  if (!resolved.enabled) return

  const projectRoot = process.cwd()
  // 规则目录：配置显式指定优先（编辑器以 dsh-source 为 cwd 时钉到项目根），否则 <cwd>/.dsh/rules
  const rulesDirectory = resolved.ruleDir !== undefined && resolved.ruleDir.trim() !== ''
    ? resolve(resolved.ruleDir.trim())
    : resolve(join(projectRoot, RULES_DIR_SEGMENT))

  // ── 常驻规则段（text 同步函数每步重算：active 全量 + 索引，apply 后当前会话立即生效） ──
  ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    text: () => {
      const rules = readActiveRulesSync(rulesDirectory)
      // 索引以磁盘扫描派生为主（保证与 active 规则一致）；RULES.md 文件由 applyRule 维护
      const derived = renderIndexSync(rules)
      if (derived.text !== undefined) return rulesSectionText(rules, derived.text)
      const fileIndex = readIndexFileSync(rulesDirectory)
      return rulesSectionText(rules, fileIndex)
    },
  })

  // ── 2 个规则工具（提案-确认制） ──
  for (const tool of createRuleTools({ rulesDirectory, ctx })) {
    ctx.tools.register(tool)
  }
}

/** 同步读取 active 规则（section text provider 是同步接口；规则库小，同步 IO 可接受）。 */
function readActiveRulesSync(rulesDirectory: string): import('./ruleTypes.js').ActiveRule[] {
  try {
    const dirents = readdirSync(rulesDirectory, { withFileTypes: true })
    const rules: import('./ruleTypes.js').ActiveRule[] = []
    for (const entry of dirents) {
      if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === RULES_INDEX_FILE) continue
      try {
        const text = readFileSync(join(rulesDirectory, entry.name), 'utf8')
        rules.push({ name: entry.name.slice(0, -3), content: stripFrontmatter(text) })
      } catch {
        // 单个坏文件不拖垮规则段
      }
    }
    return rules.sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

/** 同步读取 RULES.md（不存在/为空返回 undefined）。 */
function readIndexFileSync(rulesDirectory: string): string | undefined {
  try {
    const text = readFileSync(join(rulesDirectory, RULES_INDEX_FILE), 'utf8').trim()
    if (text.length === 0) return undefined
    return truncateIndex(text).text
  } catch {
    return undefined
  }
}
