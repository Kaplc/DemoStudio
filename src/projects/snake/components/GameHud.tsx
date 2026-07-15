/**
 * GameHud — 贪吃蛇游戏 HUD React 组件
 * 显示在游戏视口覆盖层上，包含分数和 Game Over 画面
 */
import React from 'react'
import { useEditorStore } from '../../../stores/editorStore'

export interface GameHudProps {
  score: number
  phase: 'waiting' | 'playing' | 'gameover'
}

const styles = {
  /** 分数徽章 — 左上角玻璃质感面板 */
  scoreBadge: {
    position: 'absolute' as const,
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
    pointerEvents: 'none' as const,
  } satisfies React.CSSProperties,

  scoreIcon: {
    width: 24,
    height: 24,
    borderRadius: 6,
    background: 'linear-gradient(135deg, #f7971e, #ffd200)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    fontWeight: 700,
    color: '#1a1a2e',
    flexShrink: 0,
  } satisfies React.CSSProperties,

  scoreLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    fontFamily: 'monospace',
    letterSpacing: '0.5px',
    lineHeight: 1,
  } satisfies React.CSSProperties,

  scoreValue: {
    fontSize: 22,
    fontWeight: 700,
    color: '#fff',
    fontFamily: 'monospace',
    lineHeight: 1,
    marginTop: 2,
  } satisfies React.CSSProperties,

  /** Game Over 覆盖层 */
  overlay: {
    position: 'absolute' as const,
    inset: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.65)',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
    animation: 'gui-fadeIn 400ms ease-out forwards',
    pointerEvents: 'auto' as const,
  } satisfies React.CSSProperties,

  gameOverCard: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    padding: '40px 56px',
    background: 'rgba(20,20,40,0.85)',
    borderRadius: 20,
    border: '1px solid rgba(255,255,255,0.06)',
    boxShadow: '0 20px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)',
    animation: 'gui-scaleIn 500ms ease-out forwards',
  } satisfies React.CSSProperties,

  gameOverTitle: {
    fontSize: 48,
    fontWeight: 800,
    background: 'linear-gradient(135deg, #ff6b6b, #ee5a24)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    fontFamily: 'monospace',
    marginBottom: 4,
    lineHeight: 1.2,
  } satisfies React.CSSProperties,

  gameOverSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.35)',
    fontFamily: 'monospace',
    letterSpacing: '3px',
    textTransform: 'uppercase' as const,
    marginBottom: 28,
  } satisfies React.CSSProperties,

  finalScoreRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 20,
  } satisfies React.CSSProperties,

  finalScoreLabel: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.4)',
    fontFamily: 'monospace',
  } satisfies React.CSSProperties,

  finalScoreValue: {
    fontSize: 42,
    fontWeight: 700,
    color: '#ffd200',
    fontFamily: 'monospace',
  } satisfies React.CSSProperties,

  divider: {
    width: 100,
    height: 1,
    background: 'rgba(255,255,255,0.08)',
    margin: '16px 0',
  } satisfies React.CSSProperties,

  restartBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 32px',
    background: 'linear-gradient(135deg, rgba(255,107,107,0.2), rgba(238,90,36,0.2))',
    border: '1px solid rgba(255,107,107,0.3)',
    borderRadius: 12,
    color: '#ff6b6b',
    fontSize: 14,
    fontFamily: 'monospace',
    cursor: 'pointer',
    transition: 'all 200ms ease',
    userSelect: 'none' as const,
    letterSpacing: '1px',
  } satisfies React.CSSProperties,
}

export function GameHud({ score, phase }: GameHudProps) {
  const handleRestart = React.useCallback(() => {
    useEditorStore.getState().launchGame()
  }, [])

  return (
    <>
      {/* ── 分数徽章 ── */}
      {phase !== 'waiting' && (
        <div style={styles.scoreBadge}>
          <div style={styles.scoreIcon}>★</div>
          <div>
            <div style={styles.scoreLabel}>SCORE</div>
            <div style={styles.scoreValue}>{score}</div>
          </div>
        </div>
      )}

      {/* ── Game Over 画面 ── */}
      {phase === 'gameover' && (
        <div style={styles.overlay}>
          <div style={styles.gameOverCard}>
            <div style={styles.gameOverTitle}>GAME OVER</div>
            <div style={styles.gameOverSubtitle}>贪吃蛇</div>
            <div style={styles.finalScoreRow}>
              <span style={styles.finalScoreLabel}>得分</span>
              <span style={styles.finalScoreValue}>{score}</span>
            </div>
            <button
              style={styles.restartBtn}
              onClick={handleRestart}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255,107,107,0.35), rgba(238,90,36,0.35))'
                e.currentTarget.style.borderColor = 'rgba(255,107,107,0.6)'
                e.currentTarget.style.transform = 'scale(1.05)'
                e.currentTarget.style.boxShadow = '0 4px 20px rgba(255,107,107,0.2)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255,107,107,0.2), rgba(238,90,36,0.2))'
                e.currentTarget.style.borderColor = 'rgba(255,107,107,0.3)'
                e.currentTarget.style.transform = 'scale(1)'
                e.currentTarget.style.boxShadow = 'none'
              }}
            >
              <span>↻</span> 重新开始
            </button>
          </div>
        </div>
      )}
    </>
  )
}
