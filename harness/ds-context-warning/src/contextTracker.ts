import { readFileSync } from "node:fs"
import type { Context } from "@deepseek-ai/cordis"
import type { Agent, PreStepDecision } from "@deepseek-ai/dsh-agent"
import { createUserMessage } from "@deepseek-ai/dsh-llm"
import type { Session, SessionEvent, UserMessage } from "@deepseek-ai/dsh-session"

interface SessionTokenState {
  pressureTokens: number
  contextWindow: number | undefined
  firedThresholds: Set<number>
}

export interface IndexPaths {
  memoryIndex?: string
  experienceIndex?: string
  rulesIndex?: string
}

export interface ContextTrackerConfig {
  thresholdsK: number[]
  indexes: IndexPaths
  pluginName?: string
}

function safeRead(path: string | undefined): string | undefined {
  if (path === undefined) return undefined
  try {
    const text = readFileSync(path, "utf8").trim()
    return text.length > 0 ? text : undefined
  } catch {
    return undefined
  }
}

function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + "\n[...已截断]"
}

export class ContextTracker {
  private readonly states = new WeakMap<Session, SessionTokenState>()
  private readonly thresholds: number[]
  private readonly indexes: IndexPaths
  private readonly pluginName: string

  constructor(config: ContextTrackerConfig) {
    this.thresholds = config.thresholdsK.map(k => k * 1000).sort((a, b) => a - b)
    this.indexes = config.indexes
    this.pluginName = config.pluginName ?? "@demostudio/ds-context-warning"
  }

  install(ctx: Context): void {
    ctx.on("session/event", (session: Session, event: SessionEvent) => {
      this.foldEvent(session, event)
    })
    ctx.on("agent/pre-step", async (
      { agent, signal }: { agent: Agent; messages: UserMessage[]; step: number; signal: AbortSignal },
      next: () => Promise<PreStepDecision>,
    ): Promise<PreStepDecision> => {
      const decision = await next()
      if (decision.kind === "reject") return decision
      signal.throwIfAborted()
      try { return this.maybeInjectWarning(agent, decision) } catch { return decision }
    })
  }

  private foldEvent(session: Session, event: SessionEvent): void {
    const usage = this.extractUsage(event)
    if (usage !== undefined) {
      const pressureTokens = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
      let state = this.states.get(session)
      if (state === undefined) {
        state = { pressureTokens, contextWindow: undefined, firedThresholds: new Set() }
        this.states.set(session, state)
      } else { state.pressureTokens = pressureTokens }
    }
    if (event.type === "request/context") {
      const contextWindow = (event.data as { contextWindow?: number }).contextWindow
      if (contextWindow !== undefined) {
        let state = this.states.get(session)
        if (state === undefined) {
          state = { pressureTokens: 0, contextWindow, firedThresholds: new Set() }
          this.states.set(session, state)
        } else { state.contextWindow = contextWindow }
      }
    }
  }

  private extractUsage(event: SessionEvent) {
    if (event.type === "assistant/chunk") {
      const chunk = (event.data as { chunk?: { type?: string; usage?: unknown } }).chunk
      if (chunk?.type === "usage") return chunk.usage as { inputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number } | undefined
      return undefined
    }
    if (event.type === "assistant/message") {
      return (event.data as { usage?: unknown }).usage as { inputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number } | undefined
    }
    return undefined
  }

  private findTriggeredThresholdK(pressureTokens: number): number | undefined {
    for (let i = this.thresholds.length - 1; i >= 0; i--) {
      if (pressureTokens >= this.thresholds[i]!) return this.thresholds[i]! / 1000
    }
    return undefined
  }

  private maybeInjectWarning(agent: Agent, decision: PreStepDecision): PreStepDecision {
    if (decision.kind === "reject") return decision
    const state = this.states.get(agent.session)
    if (state === undefined || state.pressureTokens <= 0) return decision
    const triggeredK = this.findTriggeredThresholdK(state.pressureTokens)
    if (triggeredK === undefined || state.firedThresholds.has(triggeredK)) return decision
    state.firedThresholds.add(triggeredK)
    const warning = this.buildWarning(triggeredK, state.pressureTokens, state.contextWindow)
    const alertMessage = createUserMessage({
      content: [{ type: "text", text: warning }],
      source: { kind: "plugin", plugin: this.pluginName, form: "notice", summary: "上下文已达 " + triggeredK + "K tokens" },
    })
    return { ...decision, messages: [...decision.messages, alertMessage] }
  }

  private buildWarning(thresholdK: number, pressureTokens: number, contextWindow: number | undefined): string {
    const fmt = (n: number): string => {
      if (n < 1_000) return String(n)
      if (n < 1_000_000) return (n / 1_000).toFixed(1) + "K"
      return (n / 1_000_000).toFixed(1) + "M"
    }
    const pct = contextWindow !== undefined && contextWindow > 0
      ? "（约 " + Math.round(pressureTokens / contextWindow * 100) + "% / 窗口 " + fmt(contextWindow) + "）"
      : ""
    const memoryIndex = clip(safeRead(this.indexes.memoryIndex) ?? "（无记忆索引）", 3000)
    const experienceIndex = clip(safeRead(this.indexes.experienceIndex) ?? "（无经验索引）", 3000)
    const rulesIndex = clip(safeRead(this.indexes.rulesIndex) ?? "（无规则索引）", 3000)
    return [
      "[上下文占用提醒] 当前 prompt 已达 " + fmt(pressureTokens) + " tokens，触发 " + thresholdK + "K 阈值" + pct + "。",
      "上下文即将接近上限，请检查以下索引，判断是否有需要保存到记忆/经验/规则的内容，或是否应结束对话：",
      "",
      "## 记忆索引",
      memoryIndex,
      "",
      "## 经验索引",
      experienceIndex,
      "",
      "## 规则索引",
      rulesIndex,
    ].join("\n")
  }
}
