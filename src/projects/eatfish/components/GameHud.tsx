/**
 * GameHud — 大鱼吃小鱼游戏 HUD React 组件
 * 显示分数、鱼大小和 Game Over 画面
 */
import React from 'react'
import { useEditorStore } from '../../../stores/editorStore'

export interface GameHudProps {
  score: number
  fishSize: number
  phase: 'waiting' | 'playing' | 'gameover'
}

const styles = {
  /** 左上角信息面板 */
  infoPanel: {
    position: 'absolute' as const,
    top: 16,
    left: 16,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
    padding: '12px 18px',
    background: 'rgba(0,0,0,0.45)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.08)',
    boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
    userSelect: 'none',
    pointerEvents: 'none' as const,
    minWidth: 120,
  } satisfies React.CSSProperties,

  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  } satisfies React.CSSProperties,

  icon: {
    width: 24,
    height: 24,
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    fontWeight: 700,
    flexShrink: 0,
  } satisfies React.CSSProperties,

  scoreIcon: {
    background: 'linear-gradient(135deg, #4fc3f7, #0288d1)',
    color: '#fff',
  } satisfies React.CSSProperties,

  sizeIcon: {
    background: 'linear-gradient(135deg, #66bb6a, #388e3c)',
    color: '#fff',
  } satisfies React.CSSProperties,

  label: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
    fontFamily: 'monospace',
    letterSpacing: '0.5px',
    lineHeight: 1,
  } satisfies React.CSSProperties,

  value: {
    fontSize: 18,
    fontWeight: 700,
    color: '#fff',
    fontFamily: 'monospace',
    lineHeight: 1,
    marginTop: 2,
  } satisfies React.CSSProperties,

  /** 大小条 */
  sizeBarOuter: {
    width: 100,
    height: 6,
    background: 'rgba(255,255,255,0.1)',
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 2,
  } satisfies React.CSSProperties,

  sizeBarInner: (pct: number) => ({
    width: `${Math.min(100, pct)}%`,
    height: '100%',
    background: 'linear-gradient(90deg, #66bb6a, #4fc3f7, #ffd200)',
    borderRadius: 3,
    transition: 'width 300ms ease',
  } satisfies React.CSSProperties),

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
    background: 'linear-gradient(135deg, #4fc3f7, #0288d1)',
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
    marginBottom: 8,
  } satisfies React.CSSProperties,

  finalScoreLabel: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.4)',
    fontFamily: 'monospace',
  } satisfies React.CSSProperties,

  finalScoreValue: {
    fontSize: 42,
    fontWeight: 700,
    color: '#4fc3f7',
    fontFamily: 'monospace',
  } satisfies React.CSSProperties,

  finalSizeLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.3)',
    fontFamily: 'monospace',
    marginBottom: 12,
  } satisfies React.CSSProperties,

  divider: {
    width: 120,
    height: 1,
    background: 'rgba(255,255,255,0.08)',
    margin: '16px 0',
  } satisfies React.CSSProperties,

  restartBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 32px',
    background: 'linear-gradient(135deg, rgba(79,195,247,0.2), rgba(2,136,209,0.2))',
    border: '1px solid rgba(79,195,247,0.3)',
    borderRadius: 12,
    color: '#4fc3f7',
    fontSize: 14,
    fontFamily: 'monospace',
    cursor: 'pointer',
    transition: 'all 200ms ease',
    userSelect: 'none' as const,
    letterSpacing: '1px',
  } satisfies React.CSSProperties,

  tip: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.2)',
    fontFamily: 'monospace',
    marginTop: 12,
  } satisfies React.CSSProperties,
}

export function GameHud({ score, fishSize, phase }: GameHudProps) {
  const handleRestart = React.useCallback(() => {
    useEditorStore.getState().launchGame()
  }, [])

  // 大小百分比（相对于最大值 5.0）
  const sizePercent = ((fishSize - 0.5) / 4.5) * 100

  return (
    <>
      {/* ── 信息面板 ── */}
      {phase === 'playing' && (
        <div style={styles.infoPanel}>
          <div style={styles.row}>
            <div style={{ ...styles.icon, ...styles.scoreIcon }}>★</div>
            <div>
              <div style={styles.label}>SCORE</div>
              <div style={styles.value}>{score}</div>
            </div>
          </div>
          <div style={styles.row}>
            <div style={{ ...styles.icon, ...styles.sizeIcon }}>🐟</div>
            <div>
              <div style={styles.label}>SIZE</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ ...styles.value, fontSize: 14 }}>{fishSize.toFixed(1)}</span>
                <div style={styles.sizeBarOuter}>
                  <div style={styles.sizeBarInner(sizePercent)} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Game Over 画面 ── */}
      {phase === 'gameover' && (
        <div style={styles.overlay}>
          <div style={styles.gameOverCard}>
            <div style={styles.gameOverTitle}>GAME OVER</div>
            <div style={styles.gameOverSubtitle}>大鱼吃小鱼</div>
            <div style={styles.finalScoreRow}>
              <span style={styles.finalScoreLabel}>得分</span>
              <span style={styles.finalScoreValue}>{score}</span>
            </div>
            <div style={styles.finalSizeLabel}>
              最终大小: {fishSize.toFixed(1)}
            </div>
            <div style={styles.divider} />
            <button
              style={styles.restartBtn}
              onClick={handleRestart}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(79,195,247,0.35), rgba(2,136,209,0.35))'
                e.currentTarget.style.borderColor = 'rgba(79,195,247,0.6)'
                e.currentTarget.style.transform = 'scale(1.05)'
                e.currentTarget.style.boxShadow = '0 4px 20px rgba(79,195,247,0.2)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(79,195,247,0.2), rgba(2,136,209,0.2))'
                e.currentTarget.style.borderColor = 'rgba(79,195,247,0.3)'
                e.currentTarget.style.transform = 'scale(1)'
                e.currentTarget.style.boxShadow = 'none'
              }}
            >
              <span>↻</span> 重新开始
            </button>
            <div style={styles.tip}>
              WASD / 方向键控制 · 吃小鱼长大 · 避开大鱼
            </div>
          </div>
        </div>
      )}
    </>
  )
}
