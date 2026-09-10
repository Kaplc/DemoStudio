/**
 * 上下文进度圈 —— 对齐 DSH WebUI ContextMeter 的圆环
 * （harness/dsh-source/packages/client/ui-conversation ContextMeter.tsx）
 *
 * - SVG 圆环：轨道圆 + 进度弧，strokeDasharray 按百分比画弧，rotate(-90) 从顶部起针
 * - usedTokens / contextWindow 任一缺失时不渲染（对齐 DSH 无数据不出环行为）
 * - tooltip 报告百分比与 token 用量（约数，K/M 缩写对齐 DSH formatTokens）
 */
import React from 'react'

/** 圆环几何（对齐 DSH）：14px viewBox，2px 描边。 */
const RADIUS = 5.5
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export interface ContextRingProps {
  /** 最近一次 provider 用量上报的占用 token（缺失时不渲染） */
  usedTokens?: number
  /** 路由容量（request/context 上报，缺失时不渲染） */
  contextWindow?: number
}

/** token 数 → 紧凑字符串（K / M 缩写，对齐 DSH formatTokens） */
function formatTokens(value: number): string {
  const scaled = (candidate: number): string => candidate >= 100
    ? String(Math.round(candidate))
    : String(Math.round(candidate * 10) / 10)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${scaled(value / 1_000)}K`
  return `${scaled(value / 1_000_000)}M`
}

export const ContextRing: React.FC<ContextRingProps> = ({ usedTokens, contextWindow }) => {
  if (usedTokens === undefined || contextWindow === undefined || contextWindow <= 0) return null
  const percent = Math.min(100, Math.round(usedTokens / contextWindow * 100))
  return (
    <span
      className="composer__ctx-ring"
      title={`上下文已用 ${percent}%（约 ${formatTokens(usedTokens)} / ${formatTokens(contextWindow)} tokens）`}
    >
      <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
        <circle className="composer__ctx-ring__track" cx="7" cy="7" r={RADIUS} />
        <circle
          className="composer__ctx-ring__fill"
          cx="7"
          cy="7"
          r={RADIUS}
          strokeDasharray={`${CIRCUMFERENCE * percent / 100} ${CIRCUMFERENCE}`}
          transform="rotate(-90 7 7)"
        />
      </svg>
    </span>
  )
}
