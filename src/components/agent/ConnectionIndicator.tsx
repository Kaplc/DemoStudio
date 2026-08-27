/**
 * 连接状态指示器组件
 *
 * 状态机与 types/agent.ts 的 ConnectionState 一一对应：
 * - claiming / recovering 属连接过程中的中间态，复用转圈动画
 * - degraded 为终态故障（主进程自愈超限），点击触发手动重启 agent
 */
import React from 'react'
import type { ConnectionState } from '../../types/agent'

interface ConnectionIndicatorProps {
  state: ConnectionState
  onConnect?: () => void
  onDisconnect?: () => void
  /** degraded 终态时的手动重启入口（对应 main 进程 dsh-restart IPC） */
  onRestart?: () => void
  /** 纯圆点模式：无文字胶囊，仅状态灯（悬浮 title 提示状态，点击行为保留） */
  dotOnly?: boolean
}

export const ConnectionIndicator: React.FC<ConnectionIndicatorProps> = ({
  state,
  onConnect,
  onDisconnect,
  onRestart,
  dotOnly
}) => {
  const getStatusText = (): string => {
    switch (state) {
      case 'connected': return '已连接'
      case 'connecting': return '连接中...'
      case 'claiming': return '认领 Agent 中...'
      case 'recovering': return '恢复会话中...'
      case 'disconnected': return '已断开'
      case 'error': return '连接错误'
      case 'degraded': return 'Agent 故障 · 点击重启'
      default: return '未连接'
    }
  }

  const getStatusClass = (): string => {
    switch (state) {
      case 'connected': return 'connection-indicator__dot--connected'
      case 'connecting':
      case 'claiming':
      case 'recovering': return 'connection-indicator__dot--connecting'
      case 'error': return 'connection-indicator__dot--error'
      case 'degraded': return 'connection-indicator__dot--error connection-indicator__dot--degraded'
      default: return ''
    }
  }

  const handleClick = () => {
    if (state === 'connected') {
      onDisconnect?.()
    } else if (state === 'idle' || state === 'disconnected' || state === 'error') {
      onConnect?.()
    } else if (state === 'degraded') {
      onRestart?.()
    }
  }

  // 纯圆点模式：状态语义由悬浮 title 承载，degraded 时可点击重启
  if (dotOnly) {
    return (
      <span
        className={`connection-indicator__dot ${getStatusClass()} connection-indicator__dot--solo`}
        title={`Agent ${getStatusText()}`}
        onClick={handleClick}
      />
    )
  }

  return (
    <div className="connection-indicator" onClick={handleClick}>
      <div className={`connection-indicator__dot ${getStatusClass()}`} />
      <span className="connection-indicator__text">{getStatusText()}</span>
    </div>
  )
}
