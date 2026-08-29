/**
 * RightPanel - 右侧面板容器
 *
 * 仅承载 Inspector；Agent UI 已迁移至独立窗口
 * （入口：顶部菜单 Agent → 「打开 Agent」/ Ctrl+Shift+A / 面板历史入口已移除）
 */
import React from 'react'
import { Inspector } from './Inspector'

export const RightPanel: React.FC = () => {
  return (
    <div className="right-panel">
      <div className="right-panel__content">
        <Inspector />
      </div>
    </div>
  )
}
