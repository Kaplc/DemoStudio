/**
 * 连接状态指示器组件
 */
import React from 'react'
import type { ConnectionState } from '../../types/agent'

interface ConnectionIndicatorProps {
  state: ConnectionState
  onConnect?: () => void
  onDisconnect?: () => void
}

export const ConnectionIndicator: React.FC<ConnectionIndicatorProps> = ({
  state,
  onConnect,
  onDisconnect
}) => {
  const getStatusText = (): string => {
    switch (state) {
      case 'connected': return '已连接'
      case 'connecting': return '连接中...'
      case 'disconnected': return '已断开'
      case 'error': return '连接错误'
      default: return '未连接'
    }
  }

  const getStatusClass = (): string => {
    switch (state) {
      case 'connected': return 'connection-indicator__dot--connected'
      case 'connecting': return 'connection-indicator__dot--connecting'
      case 'error': return 'connection-indicator__dot--error'
      default: return ''
    }
  }

  const handleClick = () => {
    if (state === 'connected') {
      onDisconnect?.()
    } else if (state === 'idle' || state === 'disconnected' || state === 'error') {
      onConnect?.()
    }
  }

  return (
    <div className="connection-indicator" onClick={handleClick}>
      <div className={`connection-indicator__dot ${getStatusClass()}`} />
      <span className="connection-indicator__text">{getStatusText()}</span>
    </div>
  )
}
