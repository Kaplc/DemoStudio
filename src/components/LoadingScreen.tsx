/**
 * LoadingScreen — 编辑器启动加载界面
 * 显示进度条和初始化阶段提示，准备就绪后淡出消失
 */
import React, { useEffect, useState } from 'react'

interface LoadingScreenProps {
  /** 是否正在加载 */
  loading: boolean
  /** 加载完成后的淡出延迟（毫秒） */
  fadeDelay?: number
}

const LOADING_STAGES = [
  { text: '启动编辑器...', duration: 400 },
  { text: '初始化引擎...', duration: 800 },
  { text: '加载场景...', duration: 600 },
  { text: '准备就绪!', duration: 300 },
]

export function LoadingScreen({ loading, fadeDelay = 300 }: LoadingScreenProps) {
  const [stage, setStage] = useState(0)
  const [fadingOut, setFadingOut] = useState(false)

  // 逐阶段推进
  useEffect(() => {
    if (!loading) {
      // 加载完成 → 淡出
      const t = setTimeout(() => setFadingOut(true), fadeDelay)
      return () => clearTimeout(t)
    }

    setStage(0)
    setFadingOut(false)

    const timers: ReturnType<typeof setTimeout>[] = []
    let elapsed = LOADING_STAGES[0].duration

    for (let i = 1; i < LOADING_STAGES.length; i++) {
      const t = setTimeout(() => setStage(i), elapsed)
      timers.push(t)
      elapsed += LOADING_STAGES[i].duration
    }

    return () => timers.forEach(clearTimeout)
  }, [loading, fadeDelay])

  if (fadingOut) return null

  const current = LOADING_STAGES[Math.min(stage, LOADING_STAGES.length - 1)]
  const progress = Math.min((stage + 1) / LOADING_STAGES.length, 1)

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 99999,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#1a1a2e',
      opacity: fadingOut ? 0 : 1,
      transition: 'opacity 0.4s ease',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      {/* Logo / 标题 */}
      <div style={{
        fontSize: 28,
        fontWeight: 700,
        color: '#e0e0e0',
        letterSpacing: 2,
        marginBottom: 8,
      }}>
        DemoStudio
      </div>
      <div style={{
        fontSize: 13,
        color: '#888',
        marginBottom: 40,
        letterSpacing: 4,
        textTransform: 'uppercase' as const,
      }}>
        Editor v4.0.0
      </div>

      {/* 进度条 */}
      <div style={{
        width: 240,
        height: 3,
        background: '#2a2a4a',
        borderRadius: 2,
        overflow: 'hidden',
        marginBottom: 16,
      }}>
        <div style={{
          width: `${progress * 100}%`,
          height: '100%',
          background: 'linear-gradient(90deg, #4a90d9, #64b4ff)',
          borderRadius: 2,
          transition: 'width 0.3s ease',
        }} />
      </div>

      {/* 阶段文字 */}
      <div style={{
        fontSize: 12,
        color: '#aaa',
        fontFamily: 'monospace',
      }}>
        {current.text}
      </div>
    </div>
  )
}
