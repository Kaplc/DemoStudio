/**
 * FishBaseUI — 捕鱼达人基地界面
 * 显示海底基地场景叠加层：炮台停泊、出海按钮、信息面板。
 */
import React from 'react'

export interface FishBaseUIProps {
  coins: number
  score: number
  cannonLevel: number
  onStartFishing: () => void
}

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  userSelect: 'none',
  fontFamily: 'monospace',
}

const panelStyle: React.CSSProperties = {
  padding: '8px 14px',
  background: 'rgba(0,0,0,0.45)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.08)',
  lineHeight: 1.1,
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'rgba(255,255,255,0.5)',
  marginBottom: 3,
}

const btnStyle: React.CSSProperties = {
  padding: '16px 48px',
  fontSize: 20,
  fontWeight: 700,
  color: '#ffffff',
  background: 'linear-gradient(135deg, #1e88e5, #00bcd4)',
  border: 'none',
  borderRadius: 10,
  cursor: 'pointer',
  letterSpacing: 3,
  boxShadow: '0 4px 24px rgba(30,136,229,0.5)',
  transition: 'transform 0.15s, box-shadow 0.15s',
  pointerEvents: 'auto',
}

const tipStyle: React.CSSProperties = {
  marginTop: 20,
  fontSize: 12,
  color: 'rgba(255,255,255,0.3)',
  textAlign: 'center',
  lineHeight: 1.8,
}

const titleLabel: React.CSSProperties = {
  position: 'absolute',
  top: 80,
  left: '50%',
  transform: 'translateX(-50%)',
  fontSize: 14,
  color: 'rgba(255,255,255,0.4)',
  letterSpacing: 4,
  textAlign: 'center',
}

export function FishBaseUI({ coins, score, cannonLevel, onStartFishing }: FishBaseUIProps) {
  return (
    <div style={overlayStyle}>
      {/* 左上信息面板 */}
      <div style={{ position: 'absolute', top: 16, left: 16, display: 'flex', gap: 10 }}>
        <div style={panelStyle}>
          <div style={labelStyle}>COINS</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#ffd700' }}>{coins}</div>
        </div>
        <div style={panelStyle}>
          <div style={labelStyle}>SCORE</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>{score}</div>
        </div>
        <div style={panelStyle}>
          <div style={labelStyle}>CANNON</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#80d8ff' }}>{'I'.repeat(cannonLevel)}</div>
        </div>
      </div>

      {/* 标题 */}
      <div style={titleLabel}>
        🌊 海底基地
      </div>

      {/* 底部操作区 */}
      <div style={{ position: 'absolute', bottom: 60, left: '50%', transform: 'translateX(-50%)', textAlign: 'center' }}>
        <button
          style={btnStyle}
          onClick={onStartFishing}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.06)'
            e.currentTarget.style.boxShadow = '0 6px 32px rgba(30,136,229,0.7)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)'
            e.currentTarget.style.boxShadow = '0 4px 24px rgba(30,136,229,0.5)'
          }}
        >
          🎣 出海捕鱼
        </button>
        <div style={tipStyle}>
          准备好炮台和弹药，出海大干一场！
        </div>
      </div>
    </div>
  )
}
