/**
 * GameHud — 赛车游戏 HUD 组件
 * 显示速度、圈数、计时、Game Over
 */
import React from 'react'
import { useEditorStore } from '../../../stores/editorStore'

export interface GameHudProps {
  speed: number
  lap: number
  totalLaps: number
  raceTime: number
  bestLap: number
  phase: 'countdown' | 'racing' | 'finished' | 'gameover'
  countdown: number
}

const styles = {
  container: {
    position: 'absolute' as const,
    inset: 0,
    pointerEvents: 'none' as const,
    fontFamily: 'monospace',
    userSelect: 'none' as const,
  },

  /** 速度表 (左下) */
  speedPanel: {
    position: 'absolute' as const,
    bottom: 30,
    left: 24,
    display: 'flex',
    alignItems: 'baseline',
    gap: 4,
    padding: '12px 20px',
    background: 'rgba(0,0,0,0.6)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    borderRadius: 14,
    border: '1px solid rgba(255,255,255,0.08)',
  } satisfies React.CSSProperties,

  speedValue: {
    fontSize: 42,
    fontWeight: 800,
    color: '#fff',
    lineHeight: 1,
  } satisfies React.CSSProperties,

  speedUnit: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.4)',
    marginLeft: 2,
  } satisfies React.CSSProperties,

  /** 圈数计时 (右上) */
  infoPanel: {
    position: 'absolute' as const,
    top: 16,
    right: 16,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
    padding: '14px 20px',
    background: 'rgba(0,0,0,0.6)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    borderRadius: 14,
    border: '1px solid rgba(255,255,255,0.08)',
    minWidth: 140,
  } satisfies React.CSSProperties,

  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
  } satisfies React.CSSProperties,

  infoLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: '1px',
    textTransform: 'uppercase' as const,
  } satisfies React.CSSProperties,

  infoValue: {
    fontSize: 18,
    fontWeight: 700,
    color: '#fff',
  } satisfies React.CSSProperties,

  infoValueGold: {
    fontSize: 18,
    fontWeight: 700,
    color: '#ffd700',
  } satisfies React.CSSProperties,

  /** 倒计时覆盖层 */
  countdownOverlay: {
    position: 'absolute' as const,
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.4)',
  } satisfies React.CSSProperties,

  countdownText: {
    fontSize: 120,
    fontWeight: 900,
    color: '#fff',
    textShadow: '0 0 40px rgba(255,255,255,0.3)',
    animation: 'gui-scaleIn 500ms ease-out',
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

  card: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    padding: '40px 56px',
    background: 'rgba(20,20,40,0.85)',
    borderRadius: 20,
    border: '1px solid rgba(255,255,255,0.06)',
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    animation: 'gui-scaleIn 500ms ease-out forwards',
  } satisfies React.CSSProperties,

  title: {
    fontSize: 48,
    fontWeight: 800,
    background: 'linear-gradient(135deg, #ff6b6b, #ffd700)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    fontFamily: 'monospace',
    marginBottom: 4,
    lineHeight: 1.2,
  } satisfies React.CSSProperties,

  subtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: '3px',
    textTransform: 'uppercase' as const,
    marginBottom: 24,
  } satisfies React.CSSProperties,

  statRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 4,
  } satisfies React.CSSProperties,

  statLabel: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.4)',
    fontFamily: 'monospace',
  } satisfies React.CSSProperties,

  statValue: {
    fontSize: 28,
    fontWeight: 700,
    color: '#ffd700',
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
    background: 'linear-gradient(135deg, rgba(255,107,107,0.2), rgba(255,215,0,0.2))',
    border: '1px solid rgba(255,107,107,0.3)',
    borderRadius: 12,
    color: '#ffd700',
    fontSize: 14,
    fontFamily: 'monospace',
    cursor: 'pointer',
    transition: 'all 200ms ease',
    userSelect: 'none' as const,
    letterSpacing: '1px',
  } satisfies React.CSSProperties,
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = (seconds % 60).toFixed(1)
  return `${m}:${s.padStart(4, '0')}`
}

export function GameHud({ speed, lap, totalLaps, raceTime, bestLap, phase, countdown }: GameHudProps) {
  const handleRestart = React.useCallback(() => {
    useEditorStore.getState().launchGame()
  }, [])

  return (
    <div style={styles.container}>
      {/* ── 速度表 ── */}
      {phase === 'racing' && (
        <div style={styles.speedPanel}>
          <span style={styles.speedValue}>{speed}</span>
          <span style={styles.speedUnit}>km/h</span>
        </div>
      )}

      {/* ── 圈数/计时 ── */}
      {phase === 'racing' && (
        <div style={styles.infoPanel}>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>LAP</span>
            <span style={styles.infoValue}>{lap}/{totalLaps}</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>TIME</span>
            <span style={styles.infoValue}>{formatTime(raceTime)}</span>
          </div>
          {bestLap > 0 && (
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>BEST</span>
              <span style={styles.infoValueGold}>{formatTime(bestLap)}</span>
            </div>
          )}
        </div>
      )}

      {/* ── 倒计时 ── */}
      {phase === 'countdown' && (
        <div style={styles.countdownOverlay}>
          <div style={styles.countdownText}>
            {countdown > 0 ? countdown : 'GO!'}
          </div>
        </div>
      )}

      {/* ── 完成 / Game Over ── */}
      {(phase === 'finished' || phase === 'gameover') && (
        <div style={styles.overlay}>
          <div style={styles.card}>
            <div style={styles.title}>
              {phase === 'finished' ? '🏆 RACE COMPLETE' : 'GAME OVER'}
            </div>
            <div style={styles.subtitle}>3D 赛车</div>
            {phase === 'finished' && (
              <>
                <div style={styles.statRow}>
                  <span style={styles.statLabel}>总用时</span>
                  <span style={styles.statValue}>{formatTime(raceTime)}</span>
                </div>
                {bestLap > 0 && (
                  <div style={styles.statRow}>
                    <span style={styles.statLabel}>最快圈速</span>
                    <span style={styles.statValue}>{formatTime(bestLap)}</span>
                  </div>
                )}
              </>
            )}
            <div style={styles.divider} />
            <button
              style={styles.restartBtn}
              onClick={handleRestart}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255,107,107,0.35), rgba(255,215,0,0.35))'
                e.currentTarget.style.borderColor = 'rgba(255,107,107,0.6)'
                e.currentTarget.style.transform = 'scale(1.05)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255,107,107,0.2), rgba(255,215,0,0.2))'
                e.currentTarget.style.borderColor = 'rgba(255,107,107,0.3)'
                e.currentTarget.style.transform = 'scale(1)'
              }}
            >
              <span>↻</span> 重新开始
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
