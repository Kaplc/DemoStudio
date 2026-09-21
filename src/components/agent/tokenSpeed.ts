/**
 * 输出速度时速表的数据层（纯函数，供 SpeedGauge 与 AgentPanel 单测复用）
 *
 * 实时速度：客户端从 reasoning.delta / content.delta（60ms 节流全量文本）的
 * 追加差分估算 tok/s，滚动窗口平滑（默认 5s）——DSH WebUI 没有实时表，这是编辑器侧扩展。
 */

/** 流式通道种类（reasoning 与 content 各自维护全量文本基线） */
export type SpeedStreamKind = 'reasoning' | 'content'

/** CJK 字符近似 1 token/字（统一表意文字 + 假名 + 谚文 + CJK 标点/全角形式） */
const CJK_PATTERN = /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/

/**
 * 追加文本 → 近似 token 数：CJK ≈ 1 token/字，其余 ≈ 4 字符/token。
 * 主流 BPE 分词器的工程折中（中文实际 0.6~1 token/字浮动，英文约 4 字符/token），
 * 只用于实时指针展示。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  let total = 0
  for (const ch of text) {
    total++
    if (CJK_PATTERN.test(ch)) cjk++
  }
  return cjk + (total - cjk) / 4
}

/** 滚动窗口速度追踪器：observe 吃全量文本（自动差分），speed 读窗口估算 tok/s */
export interface TokenSpeedTracker {
  /** 喂入某通道的最新全量文本（内部按长度差分追加量；文本变短视为新段/切会话，整段视为新增） */
  observe(kind: SpeedStreamKind, fullText: string, now: number): void
  /** 窗口内估算 tok/s（无样本返回 0；窗口不足 500ms 按 500ms 兜底防尖峰） */
  speed(now: number): number
  /** 清空基线与样本（turnEnd / 断连时调用，指针归零防跨回合串算） */
  reset(): void
}

export function createTokenSpeedTracker(windowMs = 5000): TokenSpeedTracker {
  const baselines: Record<SpeedStreamKind, number> = { reasoning: 0, content: 0 }
  let samples: Array<{ t: number; tokens: number }> = []

  const prune = (now: number): void => {
    const cutoff = now - windowMs
    if (cutoff > 0) samples = samples.filter(s => s.t >= cutoff)
  }

  return {
    observe(kind, fullText, now) {
      const prev = baselines[kind]
      // 变短 = 新 assistant 段 / 切会话（缓冲已 flush 清零重开）：全量视为新增
      const appended = fullText.length >= prev ? fullText.slice(prev) : fullText
      baselines[kind] = fullText.length
      const tokens = estimateTokens(appended)
      if (tokens <= 0) return
      samples.push({ t: now, tokens })
      prune(now)
    },
    speed(now) {
      prune(now)
      if (samples.length === 0) return 0
      let tokens = 0
      for (const s of samples) tokens += s.tokens
      const elapsedMs = Math.max(now - samples[0]!.t, 500)
      return tokens / (elapsedMs / 1000)
    },
    reset() {
      baselines.reasoning = 0
      baselines.content = 0
      samples = []
    },
  }
}

/** 速度读数格式化：<10 保 1 位小数，其余取整（异常值返回 '0'） */
export function formatSpeed(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0'
  const rounded = Math.round(value * 10) / 10
  return rounded >= 10 ? String(Math.round(rounded)) : String(rounded)
}
