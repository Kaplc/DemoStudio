/**
 * GameHud — Demo2D 游戏 HUD
 * 左上角金币计数 + 底部操作提示
 */
import React from 'react'

export interface GameHudProps {
  score: number
  phase: 'waiting' | 'playing' | 'gameover'
}

export function GameHud({ score }: GameHudProps) {
  return (
    <>
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 18px 8px 14px',
          background: 'rgba(0,0,0,0.45)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          borderRadius: 12,
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          userSelect: 'none',
          pointerEvents: 'none',
          fontFamily: 'monospace',
        }}
      >
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #ffd200, #f7971e)',
            flexShrink: 0,
          }}
        />
        <div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1 }}>COINS</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#ffd200', lineHeight: 1, marginTop: 3 }}>{score}</div>
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: 14,
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: 12,
          color: 'rgba(255,255,255,0.4)',
          fontFamily: 'monospace',
          letterSpacing: '0.5px',
          userSelect: 'none',
          pointerEvents: 'none',
        }}
      >
        WASD / 方向键 移动 · 收集金币
      </div>
    </>
  )
}
