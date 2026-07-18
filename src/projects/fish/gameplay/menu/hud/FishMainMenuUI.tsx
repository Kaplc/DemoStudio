/**
 * FishMainMenuUI — 捕鱼达人主菜单
 * 显示标题 + 开始按钮，点击后回调启动游戏。
 */
import React from 'react'

export interface FishMainMenuUIProps {
  onStartGame: () => void
}

const containerStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'radial-gradient(ellipse at center, rgba(10,40,80,0.85) 0%, rgba(2,10,25,0.92) 100%)',
  pointerEvents: 'auto',
  userSelect: 'none',
  fontFamily: 'monospace',
  animation: 'gui-fadeIn 600ms ease-out forwards',
}

const titleStyle: React.CSSProperties = {
  fontSize: 52,
  fontWeight: 700,
  color: '#4dd0e1',
  textShadow: '0 0 30px rgba(77,208,225,0.5), 0 4px 12px rgba(0,0,0,0.6)',
  letterSpacing: 6,
  marginBottom: 8,
}

const subtitleStyle: React.CSSProperties = {
  fontSize: 16,
  color: 'rgba(255,255,255,0.4)',
  letterSpacing: 4,
  marginBottom: 48,
}

const startBtnStyle: React.CSSProperties = {
  padding: '14px 56px',
  fontSize: 22,
  fontWeight: 700,
  color: '#ffffff',
  background: 'linear-gradient(135deg, #ff6f00, #ffab00)',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
  letterSpacing: 3,
  boxShadow: '0 4px 24px rgba(255,111,0,0.4)',
  transition: 'transform 0.15s, box-shadow 0.15s',
  pointerEvents: 'auto',
}

const tipStyle: React.CSSProperties = {
  marginTop: 32,
  fontSize: 12,
  color: 'rgba(255,255,255,0.25)',
  textAlign: 'center',
  lineHeight: 1.8,
}

export function FishMainMenuUI({ onStartGame }: FishMainMenuUIProps) {
  return (
    <div style={containerStyle}>
      {/* 装饰浮点（模拟海底光斑） */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${10 + Math.random() * 80}%`,
              top: `${10 + Math.random() * 80}%`,
              width: `${2 + Math.random() * 4}px`,
              height: `${2 + Math.random() * 4}px`,
              borderRadius: '50%',
              background: 'rgba(77,208,225,0.15)',
              animation: `gui-pulse ${2 + Math.random() * 3}s ease-in-out infinite`,
              animationDelay: `${Math.random() * 2}s`,
            }}
          />
        ))}
      </div>

      <div style={titleStyle}>🐟 捕鱼达人</div>
      <div style={subtitleStyle}>— FISH MASTER —</div>

      <button
        style={startBtnStyle}
        onClick={onStartGame}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'scale(1.06)'
          e.currentTarget.style.boxShadow = '0 6px 32px rgba(255,111,0,0.6)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)'
          e.currentTarget.style.boxShadow = '0 4px 24px rgba(255,111,0,0.4)'
        }}
      >
        🎮 开始游戏
      </button>

      <div style={tipStyle}>
        鼠标瞄准 · 按住开火 · 滚轮/1-5 切换炮等级
        <br />
        捕获鱼类赚取金币 · 金币归零则游戏结束
      </div>
    </div>
  )
}
