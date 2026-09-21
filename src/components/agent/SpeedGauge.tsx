/**
 * 输出速度时速表 —— 输入框右下角的汽车仪表（SVG 表盘 + 弹簧指针 + 数字读数）
 *
 * 指针与主读数恒一致：实时估算 tok/s（tokenSpeed 滚动窗口），流式回合摆动、空闲归零；
 * CSS transition 弹簧曲线扫动，读数按表盘分区变色（绿/黄/红）。
 */
import React from 'react'
import { formatSpeed } from './tokenSpeed'

/** 表盘量程（tok/s）：覆盖主流模型的输出区间，超速指针顶死红线 */
export const SPEED_MAX = 120
/** 指针扫掠角（度）：±102°，汽车表经典非半圆弧 */
const SWEEP = 204
const CX = 23
const CY = 26
const R_BAND = 20
const R_TICK_OUT = 16.8
const R_TICK_IN = 13.6

/** 表盘分区（tok/s 区间）：主绿区 → 加速黄区 → 红线区 */
const ZONES: Array<{ from: number; to: number; kind: string }> = [
  { from: 0, to: SPEED_MAX * 0.6, kind: 'green' },
  { from: SPEED_MAX * 0.6, to: SPEED_MAX * 0.85, kind: 'amber' },
  { from: SPEED_MAX * 0.85, to: SPEED_MAX, kind: 'red' },
]

/** 大刻度：每 20 tok/s 一根 */
const TICKS = [0, 20, 40, 60, 80, 100, 120]

function angleOf(tok: number): number {
  const clamped = Math.min(Math.max(tok, 0), SPEED_MAX)
  return -SWEEP / 2 + (clamped / SPEED_MAX) * SWEEP
}

function polar(angleDeg: number, r: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180
  return { x: CX + r * Math.sin(rad), y: CY - r * Math.cos(rad) }
}

/** 两速度值之间的表盘弧线（顺时针，SVG A 命令） */
function arcPath(fromTok: number, toTok: number, r: number): string {
  const p0 = polar(angleOf(fromTok), r)
  const p1 = polar(angleOf(toTok), r)
  const large = angleOf(toTok) - angleOf(fromTok) > 180 ? 1 : 0
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`
}

export interface SpeedGaugeProps {
  /** 实时估算 tok/s（滚动窗口，0 = 无输出） */
  speed: number
}

export const SpeedGauge: React.FC<SpeedGaugeProps> = ({ speed }) => {
  const live = Number.isFinite(speed) && speed > 0
  const shown = live ? speed : 0
  const zone = shown >= SPEED_MAX * 0.85 ? 'hot' : shown >= SPEED_MAX * 0.6 ? 'warn' : ''

  return (
    <span
      className="composer__speed"
      title={`输出速度：${formatSpeed(speed)} tok/s（近 5 秒滚动估算）`}
      aria-label="输出速度时速表"
    >
      <svg className="composer__speed__dial" viewBox="0 0 46 32" width="46" height="32" aria-hidden>
        {ZONES.map(z => (
          <path key={z.kind} className={`composer__speed__zone composer__speed__zone--${z.kind}`} d={arcPath(z.from, z.to, R_BAND)} />
        ))}
        {TICKS.map(tok => {
          const a = angleOf(tok)
          const out = polar(a, R_TICK_OUT)
          const inn = polar(a, R_TICK_IN)
          return <line key={tok} className="composer__speed__tick" x1={out.x} y1={out.y} x2={inn.x} y2={inn.y} />
        })}
        <g
          className="composer__speed__needle"
          data-testid="speed-needle"
          style={{ transform: `rotate(${angleOf(speed).toFixed(2)}deg)`, transformOrigin: `${CX}px ${CY}px` }}
        >
          <line x1={CX} y1={CY + 3} x2={CX} y2={CY - 17} />
        </g>
        <circle className="composer__speed__hub" cx={CX} cy={CY} r="2.4" />
      </svg>
      <span className="composer__speed__digits">
        <span className={`composer__speed__value ${zone ? `composer__speed__value--${zone}` : ''}`} data-testid="speed-value">
          {formatSpeed(shown)}
        </span>
        <span className="composer__speed__unit">tok/s</span>
      </span>
    </span>
  )
}
