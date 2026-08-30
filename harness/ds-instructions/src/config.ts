/**
 * 配置解析：路径映射、项目根、指令目录与字节预算。
 *
 * @module @demostudio/ds-instructions/config
 */

import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import z from '@deepseek-ai/schemastery'

/** 默认映射：DemoStudio 引擎/项目代码区 → 指令文件名（位于指令目录下）。 */
export const DEFAULT_MAPPINGS: readonly MappingRule[] = [
  { prefix: 'src/engine', file: 'engine.instructions.md' },
  { prefix: 'src/projects', file: 'project.instructions.md' },
]

/** 默认跟踪的结构化文件工具（触发条件是“读取文件”，write/edit 默认关闭）。 */
export const DEFAULT_TRACKED_TOOLS: readonly string[] = ['read', 'read_image']

export const DEFAULT_INSTRUCTIONS_DIR = join('.dsh', 'instructions')
export const DEFAULT_MAX_SOURCE_BYTES = 262_144
export const DEFAULT_MAX_MESSAGE_BYTES = 65_536

/** 一条路径前缀 → 指令文件名映射（prefix 为项目根相对路径）。 */
export interface MappingRule {
  prefix: string
  file: string
}

/** 插件配置（cordis.patch.yml 可配置项）。 */
export interface Config {
  /** 总开关：false 时所有 section/监听全部不注册（默认 true）。 */
  enabled?: boolean
  /**
   * 项目根（绝对路径）。编辑器以 harness/dsh-source 为 cwd 拉起内核时必须
   * 显式配置；缺省时用 session cwd 的项目根探测（.git 标记向上回溯）兜底。
   */
  projectRoot?: string
  /** 指令目录（绝对路径，或缺省 `<projectRoot>/.dsh/instructions`）；必须位于项目根内。 */
  instructionsDir?: string
  /** 显式路径映射；缺省用 DEFAULT_MAPPINGS。 */
  mappings?: MappingRule[]
  /**
   * 自动扫描指令目录：从 *.instructions.md 文件的 YAML frontmatter 中提取 prefix，
   * 与显式 mappings 合并（显式优先）。默认 true。
   */
  autoScan?: boolean
  /** 跟踪的文件工具名（默认 read/read_image；write/edit 需显式开启）。 */
  trackedTools?: string[]
  /** 单个指令文件最大字节数，超限跳过。 */
  maxSourceBytes?: number
  /** 单次合并注入消息最大字节数，超限截断/省略。 */
  maxMessageBytes?: number
}

export const DEFAULT_AUTO_SCAN = true

/** Loader 配置 schema：默认值在此声明，代码内另有 DEFAULT_* 兜底。 */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  projectRoot: z.string(),
  instructionsDir: z.string(),
  mappings: z.array(z.object({
    prefix: z.string().required(),
    file: z.string().required(),
  })).default(DEFAULT_MAPPINGS.map(rule => ({ ...rule }))),
  autoScan: z.boolean().default(DEFAULT_AUTO_SCAN),
  trackedTools: z.array(z.string()).default([...DEFAULT_TRACKED_TOOLS]),
  maxSourceBytes: z.number().default(DEFAULT_MAX_SOURCE_BYTES),
  maxMessageBytes: z.number().default(DEFAULT_MAX_MESSAGE_BYTES),
})

/** 归一化后的单条映射：segments 便于段级前缀比较，order 保留声明顺序。 */
export interface ResolvedMapping {
  /** 项目根相对的路径段（平台分隔符；win32 比较时忽略大小写）。 */
  segments: string[]
  /** 指令文件名（纯文件名，不含路径分隔符）。 */
  file: string
  /** 声明顺序（稳定排序用）。 */
  order: number
}

/** 与具体项目根绑定后的运行时配置。 */
export interface ResolvedRootConfig {
  /** 项目根（绝对路径）。 */
  projectRoot: string
  /** 指令目录（绝对路径，位于项目根内）。 */
  instructionsDir: string
  /** 指令目录的项目根相对展示路径（如 `.dsh/instructions`）。 */
  instructionsDisplayDir: string
  /** 最长前缀优先的映射表。 */
  mappings: ResolvedMapping[]
  /** 跟踪的文件工具名集合。 */
  trackedTools: ReadonlySet<string>
  /** 单文件字节上限。 */
  maxSourceBytes: number
  /** 合并消息字节上限。 */
  maxMessageBytes: number
}

/** 应用级解析结果（不含 per-root 部分）。 */
export interface ResolvedConfig {
  /** 显式配置的项目根；undefined 时按 session cwd 探测。 */
  projectRoot: string | undefined
  /** 显式配置的指令目录；undefined 时用 `<root>/.dsh/instructions`。 */
  instructionsDir: string | undefined
  mappings: ResolvedMapping[]
  /** 自动扫描 frontmatter 推导映射。 */
  autoScan: boolean
  trackedTools: ReadonlySet<string>
  maxSourceBytes: number
  maxMessageBytes: number
}

const isWindows = process.platform === 'win32'

/** 平台一致的比较键：win32 忽略大小写。 */
export function pathCompareKey(value: string): string {
  return isWindows ? value.toLowerCase() : value
}

/** 把项目根相对路径拆成路径段（兼容 `\` 与 `/`）。 */
function splitSegments(value: string): string[] {
  return value.split(/[\\/]+/).filter(segment => segment.length > 0)
}

function resolveMappings(rules: MappingRule[] | undefined): ResolvedMapping[] {
  const resolved: ResolvedMapping[] = []
  // 空数组视为未配置：schemastery/cordis 会把缺省字段填成 []（而非 undefined）
  const effective = rules === undefined || rules.length === 0 ? DEFAULT_MAPPINGS : rules
  for (const [order, rule] of effective.entries()) {
    const prefix = typeof rule?.prefix === 'string' ? rule.prefix.trim() : ''
    const file = typeof rule?.file === 'string' ? rule.file.trim() : ''
    // 只接受同目录纯文件名；含路径分隔符或保留段的条目丢弃（防拼接逃逸）
    if (prefix.length === 0 || file.length === 0) continue
    if (file !== file.replace(/[\\/]/g, '')) continue
    if (file === '.' || file === '..') continue
    // 根路径 `/`（或 `\\`）表示全局映射：匹配项目根下所有路径（空段数组）
    const segments = splitSegments(prefix)
    if (segments.some(segment => segment === '.' || segment === '..')) continue
    resolved.push({ segments, file, order })
  }
  // 最长前缀优先（段数多者优先），全局（0 段）自然垫底；同长按声明顺序
  return resolved.sort((a, b) =>
    b.segments.length - a.segments.length || a.order - b.order,
  )
}

/**
 * 解析应用级配置（不绑定具体项目根）。
 * @param config - patch 配置；字段缺省用内置默认。
 */
export function resolveConfig(config: Partial<Config> = {}): ResolvedConfig {
  return {
    projectRoot: config.projectRoot !== undefined && config.projectRoot.trim() !== ''
      ? resolve(config.projectRoot.trim())
      : undefined,
    instructionsDir: config.instructionsDir !== undefined && config.instructionsDir.trim() !== ''
      ? resolve(config.instructionsDir.trim())
      : undefined,
    mappings: resolveMappings(config.mappings),
    autoScan: config.autoScan ?? DEFAULT_AUTO_SCAN,
    trackedTools: new Set(
      (config.trackedTools ?? DEFAULT_TRACKED_TOOLS)
        .filter((name): name is string => typeof name === 'string' && name.trim() !== ''),
    ),
    maxSourceBytes: config.maxSourceBytes ?? DEFAULT_MAX_SOURCE_BYTES,
    maxMessageBytes: config.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES,
  }
}

/**
 * 检查 `child` 是否等于或位于 `parent` 内（纯路径计算，不涉及 IO）。
 * @returns 项目根相对路径；越界返回 undefined。
 */
export function containedRelative(parent: string, child: string): string | undefined {
  const rel = relative(parent, child)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return rel === '' ? '' : undefined
  return rel
}

/**
 * 把应用级配置与具体项目根绑定为运行时配置。
 * @param resolved - 应用级配置。
 * @param projectRoot - 本 session 解析出的项目根（绝对路径）。
 * @param autoScanMappings - 自动扫描 frontmatter 推导的映射（可选）。
 * @returns 绑定后的配置；指令目录越界/映射为空时返回 undefined（跳过注入并 debug）。
 */
export function bindRootConfig(
  resolved: ResolvedConfig,
  projectRoot: string,
  autoScanMappings?: MappingRule[],
): ResolvedRootConfig | undefined {
  const root = resolve(projectRoot)
  const dir = resolved.instructionsDir ?? join(root, DEFAULT_INSTRUCTIONS_DIR)
  const displayDir = containedRelative(root, dir)
  if (displayDir === undefined) return undefined
  // 合并显式映射与自动扫描映射（显式优先：同 prefix 保留显式）
  const merged = mergeMappingRules(resolved.mappings, autoScanMappings)
  if (merged.length === 0) return undefined
  return {
    projectRoot: root,
    instructionsDir: dir,
    instructionsDisplayDir: displayDir.split(sep).join('/'),
    mappings: merged,
    trackedTools: resolved.trackedTools,
    maxSourceBytes: resolved.maxSourceBytes,
    maxMessageBytes: resolved.maxMessageBytes,
  }
}

/**
 * 合并显式映射与自动扫描映射：显式优先（同 prefix 保留显式声明），
 * 结果按最长前缀优先排序。
 */
function mergeMappingRules(
  explicit: readonly ResolvedMapping[],
  autoScan?: readonly MappingRule[],
): ResolvedMapping[] {
  if (autoScan === undefined || autoScan.length === 0) return [...explicit]
  const explicitPrefixes = new Set(explicit.map(m => pathCompareKey(m.segments.join('/'))))
  const merged = [...explicit]
  for (const rule of autoScan) {
    const segments = splitSegments(rule.prefix)
    // 根路径 `/` 或 `\\` → 空段数组 → 全局映射（匹配所有路径）
    if (segments.some(s => s === '.' || s === '..')) continue
    const key = pathCompareKey(segments.join('/'))
    if (explicitPrefixes.has(key)) continue // 显式优先（含显式全局 `''` 键）
    explicitPrefixes.add(key)
    merged.push({ segments, file: rule.file, order: 1000 + merged.length }) // 自动扫描序号靠后
  }
  return merged.sort((a, b) =>
    b.segments.length - a.segments.length || a.order - b.order,
  )
}
