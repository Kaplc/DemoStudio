/**
 * GameHud — 捕鱼达人 HUD
 * 左上：金币 / 分数 / 炮等级；顶部：Boss 提示；Game Over 覆盖层（金币耗尽）。
 */
import React from 'react'
import { useEditorStore } from '../../../../stores/editorStore'

export interface GameHudProps {
  coins: number
  score: number
  level: number
  bossActive: boolean
  bossName: string
  bossHp: number
  bossMaxHp: number
  phase: 'waiting' | 'playing' | 'gameover'
  onReturnToBase?: () => void
}

const LEVEL_NAME = ['', 'I', 'II', 'III', 'IV', 'V']

const panelStyle: React.CSSProperties = {
  padding: '8px 14px',
  background: 'rgba(0,0,0,0.45)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.08)',
  fontFamily: 'monospace',
  userSelect: 'none',
  pointerEvents: 'none',
  lineHeight: 1.1,
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'rgba(255,255,255,0.5)',
  marginBottom: 3,
}

export function GameHud({ coins, score, level, bossActive, bossName, bossHp, bossMaxHp, phase, onReturnToBase }: GameHudProps) {
  const handleRestart = React.useCallback(() => {
    useEditorStore.getState().launchGame()
  }, [])

  return (
    <>
      {/* 左上信息面板 */}
      <div style={{ position: 'absolute', top: 16, left: 16, display: 'flex', gap: 10 }}>
        <div style={panelStyle}>
          <div style={{ ...labelStyle }}>COINS</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#ffd700' }}>{coins}</div>
        </div>
        <div style={panelStyle}>
          <div style={{ ...labelStyle }}>SCORE</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>{score}</div>
        </div>
        <div style={panelStyle}>
          <div style={{ ...labelStyle }}>CANNON</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#80d8ff' }}>{LEVEL_NAME[level]}</div>
        </div>
      </div>

      {/* 操作提示 */}
      {phase === 'playing' && (
        <div
          style={{
            position: 'absolute',
            bottom: 14,
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: 12,
            color: 'rgba(255,255,255,0.4)',
            fontFamily: 'monospace',
            pointerEvents: 'none',
          }}
        >
          鼠标瞄准 · 按住发射 · 1/2/3 切炮
        </div>
      )}

      {/* Boss 血条 */}
      {bossActive && bossMaxHp > 0 && phase === 'playing' && (
        <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', width: 340, maxWidth: '70%' }}>
          <div style={{ textAlign: 'center', fontSize: 12, color: '#ff6b6b', fontFamily: 'monospace', fontWeight: 700, letterSpacing: 2, marginBottom: 4 }}>
            ⚠ {bossName}
          </div>
          <div style={{ height: 12, background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,80,80,0.6)', borderRadius: 6, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${Math.max(0, Math.min(100, (bossHp / bossMaxHp) * 100))}%`,
                background: 'linear-gradient(90deg, #ff5252, #ffab40)',
                transition: 'width 0.15s',
              }}
            />
          </div>
        </div>
      )}

      {/* 返回基地按钮（右上角，游戏中始终可见） */}
      {phase === 'playing' && onReturnToBase && (
        <button
          onClick={onReturnToBase}
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            padding: '8px 18px',
            fontSize: 13,
            fontWeight: 700,
            color: 'rgba(255,255,255,0.85)',
            background: 'rgba(0,0,0,0.45)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8,
            cursor: 'pointer',
            fontFamily: 'monospace',
            letterSpacing: 1,
            pointerEvents: 'auto',
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(30,136,229,0.5)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.45)' }}
        >
          🏠 返回基地
        </button>
      )}

      {/* Game Over */}
      {phase === 'gameover' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.65)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
          }}
        >
          <div
            style={{
              textAlign: 'center',
              padding: '32px 48px',
              background: 'rgba(20,20,40,0.85)',
              borderRadius: 16,
              border: '1px solid rgba(255,255,255,0.06)',
              fontFamily: 'monospace',
            }}
          >
            <div style={{ fontSize: 40, fontWeight: 800, color: '#ff6b6b' }}>GAME OVER</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', margin: '4px 0 18px' }}>金币耗尽</div>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>
              最终分数 <span style={{ color: '#ffd700', fontSize: 28, fontWeight: 700 }}>{score}</span>
            </div>
            <button
              onClick={handleRestart}
              style={{
                marginTop: 22,
                padding: '10px 28px',
                background: 'linear-gradient(135deg,rgba(255,107,107,0.2),rgba(238,90,36,0.2))',
                border: '1px solid rgba(255,107,107,0.3)',
                borderRadius: 10,
                color: '#ff6b6b',
                fontSize: 14,
                fontFamily: 'monospace',
                cursor: 'pointer',
              }}
            >
              ↻ 重新开始
            </button>
          </div>
        </div>
      )}
    </>
  )
}
