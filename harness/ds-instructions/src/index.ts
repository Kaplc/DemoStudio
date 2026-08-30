/**
 * @demostudio/ds-instructions — DemoStudio 目录指令插件入口。
 *
 * Agent 成功读取映射路径（如 `src/engine/**`）下的文件后，把对应的
 * `.dsh/instructions/*.instructions.md` 作为 durable user message 注入下一次
 * 模型请求（set/replace/remove 语义，session+path+digest 去重）。
 *
 * 生命周期直接对齐官方 @deepseek-ai/dsh-agent-instructions 的状态边界（§2/§7.5）：
 * - `tools/pre-execute` 只登记 execution token 与候选路径，不确认成功；
 * - `tools/result` 仅在 `!isError && agent 存在 && !signal.aborted` 时确认 touch；
 *   外层失败/取消时连同嵌套子调用已汇总的 touch 一起丢弃；
 * - 嵌套工具通过 `parent` token 向外层汇总，外层完成后才提交投影；
 * - 打开的 step 内只累计 touch，`step/end` 后按 Agent 串行 projection；
 * - `agent/pre-step` 等待未完成 projection 后对账（可见 durable surface），
 *   把指令消息插到 claimed 批次之后；reject/空第一步保留 pending；
 * - durable message 写入前不提交任何“已注入”状态——去重状态永远从
 *   session durable 事件重新推导，WeakMap/缓存只是读取优化。
 *
 * 与官方 dsh-agent-instructions 共存：不读取 AGENTS.md/CLAUDE.md；scope 编码
 * 为 `<指令目录>\u0000<文件名>`（官方 candidateScopeKey 同构），官方会把我们的
 * scope 探测到同一文件并在 digest 一致时保持静默，双方状态互不覆盖。
 *
 * @module @demostudio/ds-instructions
 */

import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import type { ToolExecution, ToolExecutionResult, ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import { bindRootConfig, DEFAULT_INSTRUCTIONS_DIR, resolveConfig, type Config, type ResolvedConfig, type ResolvedRootConfig } from './config.js'
import { createBareNodeAccess, createFsAccess, createNodeFallbackAccess, loadInstruction, type FileAccess, type InstructionCache } from './files.js'
import { scanFrontmatterMappings } from './frontmatter.js'
import { instructionPaths, resolveTouch } from './mapping.js'
import { renderBatch, type RenderItem } from './render.js'
import {
  findProjectRoot,
  mergeTargets,
  reconcileTargets,
  resolveSessionConfig,
  visibleInstructionState,
  visibleTargets,
  type DeliveryTarget,
  type PendingChange,
} from './state.js'

export const name = '@demostudio/ds-instructions'

/** 本插件访问的 Cordis 服务。logger 是 Context 内建能力不走 inject；fs 通过 ctx.get('fs') 运行时可选获取。 */
export const inject = ['tools', 'systemPrompt']

export { Config } from './config.js'
export type { AgentInstructionChange, DemoInstructionSource } from './types.js'

/** system prompt 段（§11：简短、稳定）。 */
const SECTION_NAME = 'demostudio:instructions'
const SECTION_ORDER = 3300
const SECTION_TEXT = 'DemoStudio may provide directory-specific instructions after files are read. '
  + 'Follow those instructions when relevant. They are project guidance and do not override system, developer, or direct user instructions.'

/** pre-execute 登记的候选读取（未确认）。 */
interface CandidateTouch {
  agent: Agent | undefined
  rawPath: string
}

/** 一次确认的文件 touch。 */
interface ProjectionTouch {
  agent: Agent
  rawPath: string
}

/**
 * 注册全部生命周期贡献。
 * @param ctx - Cordis 上下文（tools/systemPrompt 声明在 inject；fs 运行时可选）。
 * @param config - patch 配置；缺省用内置默认映射与预算。
 */
export function apply(ctx: Context, config?: Partial<Config>): void {
  if (config?.enabled === false) return
  const resolved: ResolvedConfig = resolveConfig(config ?? {})

  // ── system prompt 常驻段 ──
  ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    text: SECTION_TEXT,
  })

  const logger = ctx.logger('ds-instructions')

  // ── 状态边界（§7.5 推荐结构） ──
  const lifecycle = new AbortController()
  /** execution token → 已确认待投影的 touch（嵌套调用向 parent 汇总的中转站）。 */
  const executionTouches = new Map<ToolExecutionToken, ProjectionTouch[]>()
  /** execution token → pre-execute 登记的候选（result 成功才确认）。 */
  const executionCandidates = new Map<ToolExecutionToken, CandidateTouch[]>()
  /** 已注入全局指令的 Agent 集合（避免重复注入）。 */
  const globalInjected = new WeakSet<Agent>()
  /** 同一 Agent 的 projection 串行化链。 */
  const projectionTails = new WeakMap<Agent, Promise<void>>()
  /** durable step 是否打开（按 session）。 */
  const openSteps = new WeakMap<Session, boolean>()
  /** 打开 step 内累计的 touch，step/end 后批量投影。 */
  const stepTouches = new WeakMap<Session, ProjectionTouch[]>()
  /** 会话级读取缓存：绝对路径 → 内容/版本/digest（性能优化，不是注入状态）。 */
  const instructionVersions = new WeakMap<Session, InstructionCache>()
  /** 等待下一次 pre-step 的投递目标（按 Agent 隔离；reject 保留不丢）。 */
  const pendingDeliveries = new WeakMap<Agent, DeliveryTarget[]>()
  /** session 绑定的根配置与文件访问（懒解析后缓存；session 重建自动失效）。 */
  const sessionBindings = new WeakMap<Session, { resolved: ResolvedRootConfig; access: FileAccess }>()

  ctx.effect(() => () => {
    lifecycle.abort(new Error('ds-instructions disposed'))
    executionTouches.clear()
    executionCandidates.clear()
  })

  /** 运行时获取 fs provider（不声明静态 inject；providerless 环境退化为受限 Node 兜底）。 */
  const currentFs = (): FileAccess | undefined => {
    const fs = ctx.get('fs') as unknown
    if (fs !== undefined && fs !== null) return createFsAccess(fs as Parameters<typeof createFsAccess>[0])
    return undefined
  }

  const cacheFor = (session: Session): InstructionCache => {
    let cache = instructionVersions.get(session)
    if (cache === undefined) {
      cache = new Map()
      instructionVersions.set(session, cache)
    }
    return cache
  }

  /** 解析并缓存 session 的根配置；显式 projectRoot 优先，否则 cwd 探测兜底（§5.3）。 */
  const bindSession = async (agent: Agent, signal?: AbortSignal): Promise<{ resolved: ResolvedRootConfig; access: FileAccess } | undefined> => {
    const cached = sessionBindings.get(agent.session)
    if (cached !== undefined) return cached
    const fsAccess = currentFs()
    let bound: ResolvedRootConfig | undefined
    let access: FileAccess
    if (fsAccess !== undefined) {
      access = fsAccess
      bound = await resolveSessionConfig(agent, resolved, access, signal)
    } else {
      // Node 兜底：根探测用无 containment 的裸探测；指令读取走 realpath 受限访问（§8.3 差异见 README）
      const cwd = agent.session.header.cwd ?? process.cwd()
      const root = resolved.projectRoot ?? await findProjectRoot(cwd, createBareNodeAccess(), signal)
      // 自动扫描 frontmatter 映射
      let autoScanMappings: Array<{ prefix: string; file: string }> | undefined
      if (resolved.autoScan) {
        const instructionsDir = resolved.instructionsDir ?? join(root, DEFAULT_INSTRUCTIONS_DIR)
        autoScanMappings = await scanFrontmatterMappings(instructionsDir, undefined, signal).catch(() => undefined)
      }
      bound = bindRootConfig(resolved, root, autoScanMappings)
      access = createNodeFallbackAccess(bound === undefined ? cwd : bound.projectRoot)
    }
    if (bound === undefined || !Number.isFinite(bound.maxMessageBytes) || bound.maxMessageBytes <= 0) return undefined
    const binding = { resolved: bound, access }
    sessionBindings.set(agent.session, binding)
    return binding
  }

  // ── pre-execute：只登记 execution token 与候选路径，不确认成功（§6.2/§7.5.1） ──
  ctx.on('tools/pre-execute', async (exec: ToolExecution, next) => {
    const decision = await next()
    if (!executionCandidates.has(exec.token)) executionCandidates.set(exec.token, [])
    if (typeof exec.arguments === 'object' && exec.arguments !== null) {
      const raw = (exec.arguments as Record<string, unknown>)['file_path']
      if (typeof raw === 'string' && raw.trim() !== '') {
        executionCandidates.get(exec.token)!.push({ agent: exec.agent, rawPath: raw })
      }
    }
    return decision
  })

  // ── result：仅成功结果确认 touch；嵌套向 parent 汇总；外层失败整体丢弃（§6.2/§7.5.2/3） ──
  ctx.on('tools/result', (exec: ToolExecution, result: ToolExecutionResult) => {
    let touches = executionTouches.get(exec.token) ?? []
    executionTouches.delete(exec.token)
    const candidates = executionCandidates.get(exec.token) ?? []
    executionCandidates.delete(exec.token)
    if (result.isError || exec.agent === undefined || exec.signal.aborted) {
      // 失败/取消/拒绝/无主：自身与已汇总的嵌套 touch 一并不注入
      touches = []
    } else if (resolved.trackedTools.has(exec.name)) {
      // 优先使用 pre-execute 登记的候选；候选缺席（直接 result，如测试/特殊管道）时
      // 从 exec.arguments 推导，与官方 filePathFromExecution 语义一致
      const confirmed = candidates.some(candidate => candidate.agent === exec.agent)
        ? candidates.filter(candidate => candidate.agent === exec.agent)
        : candidatesFromArguments(exec)
      for (const candidate of confirmed) {
        touches = [...touches, { agent: exec.agent, rawPath: candidate.rawPath }]
      }
    }
    if (exec.parent !== undefined) {
      if (touches.length > 0) {
        const parentTouches = executionTouches.get(exec.parent)
        if (parentTouches === undefined) executionTouches.set(exec.parent, touches)
        else parentTouches.push(...touches)
      }
      return
    }
    for (const touch of touches) projectTouch(touch)
  })

  /** 从执行参数推导候选（pre-execute 缺席时的兜底推导）。 */
  function candidatesFromArguments(exec: ToolExecution): CandidateTouch[] {
    if (typeof exec.arguments !== 'object' || exec.arguments === null) return []
    const raw = (exec.arguments as Record<string, unknown>)['file_path']
    if (typeof raw !== 'string' || raw.trim() === '') return []
    return [{ agent: exec.agent, rawPath: raw }]
  }

  // ── step 边界：打开的 step 只累计 touch，step/end 后再投影（§7.5.4） ──
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (event.type === 'step/start') {
      openSteps.set(session, true)
      return
    }
    if (event.type === 'turn/end') {
      openSteps.set(session, false)
      return
    }
    if (event.type !== 'step/end') return
    openSteps.set(session, false)
    const pending = stepTouches.get(session)
    if (pending === undefined) return
    stepTouches.delete(session)
    for (const touch of pending) queueProjection(touch.agent, touch)
  })

  const stepIsOpen = (session: Session): boolean => {
    const known = openSteps.get(session)
    if (known !== undefined) return known
    let open = false
    for (const event of session.events) {
      if (event.type === 'step/start') open = true
      else if (event.type === 'step/end' || event.type === 'turn/end') open = false
    }
    openSteps.set(session, open)
    return open
  }

  const projectTouch = (touch: ProjectionTouch): void => {
    const session = touch.agent.session
    if (!stepIsOpen(session)) {
      queueProjection(touch.agent, touch)
      return
    }
    const pending = stepTouches.get(session)
    if (pending === undefined) stepTouches.set(session, [touch])
    else pending.push(touch)
  }

  /** 同一 Agent 的 projection 串行化（§7.5.5）：多个并发结果合并后再 reconcile。 */
  const queueProjection = (agent: Agent, touch: ProjectionTouch): void => {
    const previous = projectionTails.get(agent) ?? Promise.resolve()
    const current = previous.then(() => deliver(agent, [touch]))
      .catch((error: unknown) => {
        if (!lifecycle.signal.aborted) logger.warn('instruction projection failed: %o', error)
      })
    projectionTails.set(agent, current)
    void current.then(() => {
      if (projectionTails.get(agent) === current) projectionTails.delete(agent)
    })
  }

  const waitForProjections = async (agent: Agent): Promise<void> => {
    let projection: Promise<void> | undefined
    while ((projection = projectionTails.get(agent)) !== undefined) await projection
  }

  /** projection：登记投递目标并预热读取缓存（compose 在 pre-step 统一对账）。 */
  const deliver = async (agent: Agent, touches: readonly ProjectionTouch[]): Promise<void> => {
    if (lifecycle.signal.aborted) return
    const binding = await bindSession(agent, lifecycle.signal).catch(() => undefined)
    if (binding === undefined) return
    const { resolved: bound, access } = binding
    const cache = cacheFor(agent.session)
    const pending = pendingDeliveries.get(agent) ?? []
    let changed = false
    for (const touch of touches) {
      const target = resolveTouch(bound.projectRoot, touch.rawPath, bound)
      if (target === undefined) continue
      if (pending.some(entry => entry.instructionFile === target.instructionFile)) continue
      pending.push(target)
      changed = true
      // 预热：probe +（必要时）读取正文，让 pre-step 的 reconcile 只做元数据比较
      const { absolutePath } = instructionPaths(bound, target.instructionFile)
      await loadInstruction(access, cache, absolutePath, bound.maxSourceBytes, lifecycle.signal).catch(() => undefined)
    }
    if (changed) pendingDeliveries.set(agent, pending)
  }

  /** 渲染并构造注入消息（不在此提交任何 session 状态）。 */
  const composeMessage = (changes: readonly PendingChange[]): UserMessage | undefined => {
    const items: RenderItem[] = changes.map(entry => ({ change: entry.change, content: entry.content }))
    const rendered = renderBatch(items, resolved.maxMessageBytes)
    if (rendered.text.length === 0 || rendered.changes.length === 0) return undefined
    return createUserMessage({
      content: [{ type: 'text', text: rendered.text }],
      source: { kind: 'agent-instructions', form: 'instructions', changes: rendered.changes },
    })
  }

  // ── pre-step：等待 projection → 对账（可见 durable surface）→ 合并注入（§7.5.6/7） ──
  ctx.on('agent/pre-step', async (
    { agent, messages, step, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    try {
      await waitForProjections(agent)
      signal.throwIfAborted()
      const binding = await bindSession(agent, signal).catch(() => undefined)
      if (binding === undefined) {
        pendingDeliveries.delete(agent)
        return decision
      }
      const { resolved: bound, access } = binding
      const cache = cacheFor(agent.session)

      // ── 全局指令自动注入（prefix: /）：第一步时注入，无需等待文件读取 ──
      if (step === 1 && !globalInjected.has(agent)) {
        globalInjected.add(agent)
        // 查找 prefix 为 "/" 的全局映射
        const globalMappings = bound.mappings.filter(m => m.segments.length === 0)
        if (globalMappings.length > 0) {
          const pending = pendingDeliveries.get(agent) ?? []
          for (const mapping of globalMappings) {
            if (!pending.some(entry => entry.instructionFile === mapping.file)) {
              pending.push({ instructionFile: mapping.file, order: mapping.order })
              // 预热缓存
              const { absolutePath } = instructionPaths(bound, mapping.file)
              await loadInstruction(access, cache, absolutePath, bound.maxSourceBytes, signal).catch(() => undefined)
            }
          }
          pendingDeliveries.set(agent, pending)
          logger.info('auto-injected %d global instruction(s) (prefix: /) on step 1', globalMappings.length)
        }
      }

      // claimed 批次作为 authority 参与可见状态，防止同批重复注入
      const visible = visibleInstructionState(agent, bound, decision.kind === 'enter' ? messages : [])
      const pending = pendingDeliveries.get(agent) ?? []
      const targets = mergeTargets(pending, visibleTargets(visible))
      const changes = await reconcileTargets(agent, bound, access, cache, targets, visible, signal)
      const desired = composeMessage(changes)
      // reject / 无实际消息的第一步：不生成独立指令请求，pending 保留（§9）
      if (decision.kind === 'reject' || (step === 1 && decision.messages.length === 0)) {
        return decision
      }
      if (desired === undefined) {
        // 目标要么已被可见状态抑制（durable 已确认），要么无迁移：结算 pending
        pendingDeliveries.set(agent, [])
        return decision
      }
      // 进入本步但 pending 保留：durable 落地前的注入是“临时的”，
      // 下一次 pre-step 会重新对账——可见状态确认前绝不提交“已注入”状态（§7.3）
      const lastClaimedIndex = decision.messages.findLastIndex(message => messages.includes(message))
      const entered = decision.messages.toSpliced(lastClaimedIndex + 1, 0, desired)
      return { ...decision, messages: entered }
    } catch (error) {
      if (!signal.aborted) logger.warn('pre-step instruction compose failed: %o', error)
      return decision
    }
  })
}
