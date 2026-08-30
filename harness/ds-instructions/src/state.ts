/**
 * session 可见状态与 reconcile：从 durable 事件推导“当前模型可见的指令版本”，
 * 与文件系统现状对账产生 set/replace/remove 迁移。
 *
 * 核心约定：注入与否的判定以 session 可见 durable 状态为准；WeakMap/缓存只是
 * 读取优化。durable message 未写入时可见状态不更新，下一次 reconcile 会重试。
 *
 * @module @demostudio/ds-instructions/state
 */

import { basename, join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { bindRootConfig, pathCompareKey, type ResolvedConfig, type ResolvedRootConfig } from './config.js'
import { instructionPaths, resolveTouch } from './mapping.js'
import { loadInstruction, type FileAccess, type InstructionCache, type Probe } from './files.js'
import { isInstructionSource, parseInstructionChanges, type AgentInstructionChange } from './types.js'

/** 一次待注入迁移（change + 渲染所需内容 + 稳定排序键）。 */
export interface PendingChange {
  change: AgentInstructionChange
  /** set/replace 的指令正文；remove 无。 */
  content?: string
  /** 命中映射的声明序；来自可见状态对账（无新 touch）的条目为 Infinity。 */
  order: number
}

/** 待投递目标（projection 记录，pre-step 消费）。 */
export interface DeliveryTarget {
  instructionFile: string
  order: number
}

/**
 * 解析 session 的项目根并绑定配置。
 * 策略（§5.3）：显式配置的 projectRoot 优先；否则从 session cwd 向上探测 `.git`。
 * @returns 绑定后的配置；根越界/映射为空时 undefined（跳过全部注入）。
 */
export async function resolveSessionConfig(
  agent: Agent,
  resolved: ResolvedConfig,
  access: FileAccess,
  signal?: AbortSignal,
): Promise<ResolvedRootConfig | undefined> {
  let root = resolved.projectRoot
  if (root === undefined) {
    const cwd = agent.session.header.cwd ?? process.cwd()
    root = await findProjectRoot(cwd, access, signal)
  }
  return bindRootConfig(resolved, root)
}

/** 项目根标记：向上回溯直到发现其一。 */
const ROOT_MARKERS = ['.git'] as const

/** 向上回溯找项目根；找不到时用 cwd 兜底（与官方 findProjectRoot 语义一致：存在即标记）。 */
export async function findProjectRoot(
  cwd: string,
  access: FileAccess,
  signal?: AbortSignal,
): Promise<string> {
  let current = cwd
  for (;;) {
    for (const marker of ROOT_MARKERS) {
      if (await access.probeMarker(join(current, marker), signal)) return current
    }
    const parent = join(current, '..')
    if (parent === current) return cwd
    current = parent
  }
}

/**
 * 从 session durable 事件 + 本步 authority 消息推导我们指令路径的可见状态。
 * 只统计可见 surface 上的事件；同一 path 以最新 change 为准。
 */
export function visibleInstructionState(
  agent: Agent,
  resolved: ResolvedRootConfig,
  authorityMessages: readonly UserMessage[] = [],
): Map<string, AgentInstructionChange> {
  const visibleSeqs = new Set(agent.session.surface.nodes)
  const visible = new Map<string, AgentInstructionChange>()
  const consume = (change: AgentInstructionChange, visibleNow: boolean): void => {
    if (!isOwnChange(change, resolved)) return
    if (visibleNow) visible.set(change.path, change)
  }
  for (const [seq, event] of agent.session.events.entries()) {
    if (event.type !== 'user/message' || !isInstructionSource(event.data.source)) continue
    for (const change of parseInstructionChanges(event.data.source)) {
      consume(change, visibleSeqs.has(seq))
    }
  }
  for (const message of authorityMessages) {
    if (!isInstructionSource(message.source)) continue
    for (const change of parseInstructionChanges(message.source)) consume(change, true)
  }
  return visible
}

/** 是否为本插件管辖的 change：路径位于指令目录下且 scope 与目录/文件名自洽。 */
function isOwnChange(change: AgentInstructionChange, resolved: ResolvedRootConfig): boolean {
  const normalized = change.path.replaceAll('\\', '/')
  const prefix = `${resolved.instructionsDisplayDir}/`
  if (!normalized.toLowerCase().startsWith(pathCompareKey(prefix))) return false
  const file = basename(normalized)
  return change.scope === `${resolved.instructionsDisplayDir}\u0000${file}`
}

/** 从可见状态反推指令目标（pre-step 对账可见路径的离线变化）。 */
export function visibleTargets(
  visible: ReadonlyMap<string, AgentInstructionChange>,
): DeliveryTarget[] {
  const targets: DeliveryTarget[] = []
  for (const path of visible.keys()) {
    const file = basename(path.replaceAll('\\', '/'))
    targets.push({ instructionFile: file, order: Number.POSITIVE_INFINITY })
  }
  return targets
}

/**
 * 合并投递目标集：按指令文件名去重，保留最小声明序（排序更靠前的映射优先）。
 * visibleTargets（order = Infinity）只补位，不覆盖有 touch 来历的目标。
 */
export function mergeTargets(
  primary: readonly DeliveryTarget[],
  secondary: readonly DeliveryTarget[],
): DeliveryTarget[] {
  const byFile = new Map<string, DeliveryTarget>()
  for (const target of [...primary, ...secondary]) {
    const existing = byFile.get(target.instructionFile)
    if (existing === undefined || target.order < existing.order) byFile.set(target.instructionFile, target)
  }
  return [...byFile.values()].sort((a, b) => a.order - b.order)
}

/**
 * 对一组指令目标做 reconcile：probe 文件 →（缓存命中不重读）→ 与可见状态对账。
 * - 文件不存在/为空/超限：此前可见且非 remove → 产生 remove；否则无迁移。
 * - digest 与可见一致：无迁移（去重）。
 * - 可见为空或已 remove → set；否则 replace。
 * - probe 临时失败：保留最后已知状态（不发 remove，避免 provider 抖动误删）。
 */
export async function reconcileTargets(
  agent: Agent,
  resolved: ResolvedRootConfig,
  access: FileAccess,
  cache: InstructionCache,
  targets: readonly DeliveryTarget[],
  visible: ReadonlyMap<string, AgentInstructionChange>,
  signal?: AbortSignal,
): Promise<PendingChange[]> {
  const byPath = new Map<string, PendingChange>()
  const seenFiles = new Set<string>()
  const ordered = [...targets].sort((a, b) => a.order - b.order)
  for (const target of ordered) {
    if (seenFiles.has(target.instructionFile)) continue
    seenFiles.add(target.instructionFile)
    const { absolutePath, displayPath, scope } = instructionPaths(resolved, target.instructionFile)
    const previous = visible.get(displayPath)
    let probe: Probe
    let loaded: Awaited<ReturnType<typeof loadInstruction>>['loaded']
    try {
      const result = await loadInstruction(access, cache, absolutePath, resolved.maxSourceBytes, signal)
      probe = result.probe
      loaded = result.loaded
    } catch {
      // loadInstruction 只在上游 signal 中止时抛出：这里恢复中止并跳过该目标
      signal?.throwIfAborted()
      continue
    }
    if (probe.kind === 'unavailable') {
      // provider 抖动：不发 remove，保留最后已知状态
      continue
    }
    const present = probe.kind === 'present'
      && loaded !== undefined
      && loaded.content.trim().length > 0
    if (!present) {
      if (previous !== undefined && previous.action !== 'remove') {
        byPath.set(displayPath, { change: { action: 'remove', scope, path: displayPath }, order: target.order })
      }
      continue
    }
    const digest = loaded!.digest
    if (previous !== undefined && previous.action !== 'remove' && previous.digest === digest) continue
    const action = previous === undefined || previous.action === 'remove' ? 'set' : 'replace'
    byPath.set(displayPath, {
      change: { action, scope, path: displayPath, digest },
      content: loaded!.content,
      order: target.order,
    })
  }
  // 稳定排序：映射声明序优先，其次路径（§6.3 指令顺序稳定）
  return [...byPath.values()].sort((a, b) =>
    a.order - b.order || (a.change.path < b.change.path ? -1 : a.change.path > b.change.path ? 1 : 0),
  )
}

/**
 * 把一次成功的文件读取解析为指令目标（touch → 目标）。
 * @returns 目标；路径无效/越界/无映射时 undefined。
 */
export function touchToTarget(
  root: string,
  rawPath: unknown,
  resolved: ResolvedRootConfig,
): DeliveryTarget | undefined {
  return resolveTouch(root, rawPath, resolved)
}
