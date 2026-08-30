/**
 * @demostudio/ds-sync — DSH 启动同步插件。
 *
 * DSH 启动（插件 apply）时，把 home(~/.dsh) 下的项目相关配置/数据
 * 同步到项目根 .dsh，保证：
 * - 项目 .dsh 始终是最新的"可迁移快照"（记忆/skills/presets/profiles 结构完全一致）
 * - 内容变化才写（sha1 比对，避免无谓 IO 与 git 噪音）
 * - 换机器时项目 .dsh 随 git 走，home 侧内容可用同步下来的快照恢复
 *
 * 同步映射（home → 项目根/.dsh，结构完全一致）：
 * - ~/.dsh/.agent-presets   → <项目>/.dsh/presets          （agent presets，如 game-editor）
 * - ~/.dsh/skills           → <项目>/.dsh/skills            （用户级技能）
 * - ~/.dsh/profiles         → <项目>/.dsh/profiles          （profile patch/配置，跳过 node_modules）
 * - ~/.dsh/memory           → <项目>/.dsh/memory            （ds-memory 插件的记忆文件；若 memoryDir 钉在项目根则源为空，跳过）
 *
 * @module @demostudio/ds-sync
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { syncDir, type SyncResult } from './sync.js'

export const name = '@demostudio/ds-sync'

/** 本插件不访问任何可注入服务；logger 是 Context 内建属性，不走 inject。 */
export const inject: string[] = []

/** 同步映射：home 相对路径 → 项目 .dsh 下相对路径（结构完全一致）。 */
const SYNC_ITEMS: ReadonlyArray<readonly [source: string, target: string]> = [
  ['.agent-presets', 'presets'],
  ['skills', 'skills'],
  ['profiles', 'profiles'],
  ['memory', 'memory'],
]

/** 插件配置（cordis.yml 可配置项）。 */
export interface Config {
  /** 总开关：false 时不做任何同步（默认 true）。 */
  enabled?: boolean
  /** DSH home 目录（默认 ~/.dsh）。 */
  homeDir?: string
  /** 项目根（默认取 cwd；编辑器以 dsh-source 为 cwd 拉起内核时需显式钉到项目根）。 */
  projectRoot?: string
  /** 目标目录里源没有的多余文件是否删除（默认 false：只增不删，安全优先）。 */
  deleteExtraneous?: boolean
  /** 额外的排除目录名（合并进默认排除集，如 node_modules 自动跳过）。 */
  extraExcludes?: string[]
}

/** Loader 配置 schema。 */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  homeDir: z.string(),
  projectRoot: z.string(),
  deleteExtraneous: z.boolean().default(false),
  extraExcludes: z.array(z.string()),
})

/**
 * 注册启动同步：apply 时立即执行一次全量同步。
 * @param ctx - Cordis 上下文（仅用内建 logger）。
 * @param config - cordis.yml 配置；未提供时使用内置默认值。
 */
export function apply(ctx: Context, config?: Config): void {
  const resolved = {
    enabled: config?.enabled ?? true,
    homeDir: config?.homeDir ? resolve(config.homeDir) : join(homedir(), '.dsh'),
    projectRoot: config?.projectRoot ? resolve(config.projectRoot) : process.cwd(),
    deleteExtraneous: config?.deleteExtraneous ?? false,
    extraExcludes: config?.extraExcludes ?? [],
  }
  if (!resolved.enabled) {
    ctx.logger.info('[ds-sync] enabled=false，跳过同步')
    return
  }

  const targetRoot = join(resolved.projectRoot, '.dsh')
  const total: SyncResult = { copied: 0, deleted: 0, unchanged: 0, touched: [] }

  for (const [source, target] of SYNC_ITEMS) {
    const srcPath = join(resolved.homeDir, source)
    const destPath = join(targetRoot, target)
    const result = syncDir(srcPath, destPath, {
      deleteExtraneous: resolved.deleteExtraneous,
      extraExcludes: resolved.extraExcludes,
    })
    total.copied += result.copied
    total.deleted += result.deleted
    total.unchanged += result.unchanged
    total.touched.push(...result.touched.map(t => join(source, t)))
  }

  ctx.logger.info(
    `[ds-sync] 完成: home=${resolved.homeDir} → ${targetRoot} | ` +
    `复制 ${total.copied} 个文件, 未变化 ${total.unchanged} 个, 删除 ${total.deleted} 个`,
  )
  if (total.copied > 0) {
    ctx.logger.info(`[ds-sync] 变更文件: ${total.touched.join(', ')}`)
  }
}
