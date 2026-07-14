/**
 * AxisIndicator — 3D 坐标轴示意（SVG 叠加层）+ 实时摄像机坐标
 * 显示在 Scene 视口右上角，根据摄像机朝向实时更新轴方向
 */
import React from 'react'

const SIZE = 96
const ORIGIN = { x: 48, y: 54 }
const LEN = 28

interface AxisDir {
  label: string
  color: string
  /** 屏幕 2D 方向向量（归一化） */
  dir: { x: number; y: number }
}

const axisMeta: { label: string; color: string }[] = [
  { label: 'X', color: '#ff4444' },
  { label: 'Y', color: '#44ff44' },
  { label: 'Z', color: '#4488ff' },
]

interface AxisIndicatorProps {
  /** 当前摄像机世界坐标 */
  cameraPos: { x: number; y: number; z: number }
  /** 每条世界轴在屏幕空间的 2D 方向 */
  axisDirs: { x: number; y: number }[]
}

export function AxisIndicator({ cameraPos, axisDirs }: AxisIndicatorProps) {
  const axes: AxisDir[] = axisMeta.map((m, i) => ({
    ...m,
    dir: axisDirs[i] ?? { x: 0, y: 0 },
  }))

  return (
    <div style={{
      position: 'absolute',
      top: 40,
      right: 8,
      zIndex: 20,
      pointerEvents: 'none',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 4,
    }}>
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        style={{
          opacity: 0.85,
          filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.5))',
        }}
      >
        {/* 背景圆 */}
        <circle cx={ORIGIN.x} cy={ORIGIN.y} r={SIZE * 0.44} fill="rgba(0,0,0,0.45)" />

        {/* 轴线 + 箭头 */}
        {axes.map((a) => {
          const dx = a.dir.x * LEN
          const dy = a.dir.y * LEN
          const len = Math.sqrt(dx * dx + dy * dy)
          const angle = Math.atan2(dy, dx)
          const arrowLen = Math.min(7, len * 0.4)
          const arrowAngle = 0.5
          const ax1 = ORIGIN.x + dx - arrowLen * Math.cos(angle - arrowAngle)
          const ay1 = ORIGIN.y + dy - arrowLen * Math.sin(angle - arrowAngle)
          const ax2 = ORIGIN.x + dx - arrowLen * Math.cos(angle + arrowAngle)
          const ay2 = ORIGIN.y + dy - arrowLen * Math.sin(angle + arrowAngle)
          // 标签在轴末端外推 12px
          const nx = len > 0 ? dx / len : 0
          const ny = len > 0 ? dy / len : 0
          const lx = ORIGIN.x + dx + nx * 12
          const ly = ORIGIN.y + dy + ny * 12

          return (
            <g key={a.label}>
              <line
                x1={ORIGIN.x} y1={ORIGIN.y}
                x2={ORIGIN.x + dx} y2={ORIGIN.y + dy}
                stroke={a.color} strokeWidth={2.5} strokeLinecap="round"
              />
              {len > 3 && (
                <polygon
                  points={`${ORIGIN.x + dx},${ORIGIN.y + dy} ${ax1},${ay1} ${ax2},${ay2}`}
                  fill={a.color}
                />
              )}
              <text
                x={lx}
                y={ly + 4}
                fill={a.color}
                fontSize={12}
                fontWeight={700}
                fontFamily="monospace"
                textAnchor="middle"
                style={{ opacity: len > 6 ? 1 : 0.2 }}
              >
                {a.label}
              </text>
            </g>
          )
        })}
      </svg>

      {/* 坐标数值 */}
      <div style={{
        background: 'rgba(0,0,0,0.6)',
        borderRadius: 4,
        padding: '3px 8px',
        fontFamily: 'monospace',
        fontSize: 10,
        lineHeight: 1.6,
        color: '#ccc',
        whiteSpace: 'nowrap',
      }}>
        <span style={{ color: '#ff4444' }}>X</span> {cameraPos.x.toFixed(1)}<br />
        <span style={{ color: '#44ff44' }}>Y</span> {cameraPos.y.toFixed(1)}<br />
        <span style={{ color: '#4488ff' }}>Z</span> {cameraPos.z.toFixed(1)}
      </div>
    </div>
  )
}
