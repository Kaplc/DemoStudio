/**
 * ContextCard - 上下文注入卡片
 *
 * 对齐 DSH WebUI ContextInjectionRow：会话流里 source.kind !== 'user' 的
 * user/message（插件记忆召回 / 后台提取 notice / 指令同步 / skill 目录等）
 * 渲染为可折叠的注入行。
 * 折叠行 = 图标 + 标题 + 生产者标签 + 一句话摘要（仅 notice 记录）；
 * 展开正文 = 模型实际读到的原文（等宽、限高滚动）。
 */
import React, { useState } from 'react'
import type { ContextCardInfo } from '../../types/agent'

/** 注入图标（对齐 WebUI IconBrowseOutline16 的语义） */
function InjectIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M1.8 8h12.4M8 1.8c2.1 1.7 3.2 3.8 3.2 6.2s-1.1 4.5-3.2 6.2c-2.1-1.7-3.2-3.8-3.2-6.2S5.9 3.5 8 1.8Z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  )
}

/** 召回图标（对齐 WebUI ReferenceIcon kind=session 的语义） */
function RecallIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 2.5h8a1 1 0 0 1 1 1v10l-5-2.8-5 2.8v-10a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export const ContextCard: React.FC<{ info: ContextCardInfo; content: string }> = ({ info, content }) => {
  const [open, setOpen] = useState(false)
  const isRecall = info.role === 'recall'
  return (
    <div
      className={`agent-context-card${open ? ' agent-context-card--open' : ''}`}
      onClick={() => setOpen(v => !v)}
    >
      <div className="agent-context-card__head">
        <span className="agent-context-card__icon">{isRecall ? <RecallIcon /> : <InjectIcon />}</span>
        <span className="agent-context-card__title">{isRecall ? '跨会话召回' : '上下文注入'}</span>
        {info.label && (
          <>
            <span className="agent-context-card__sep" aria-hidden="true" />
            <span className="agent-context-card__source">{info.label}</span>
          </>
        )}
        {info.summary && (
          <>
            <span className="agent-context-card__sep" aria-hidden="true" />
            <span className="agent-context-card__summary">{info.summary}</span>
          </>
        )}
        <span className="agent-context-card__chevron">{open ? '▴' : '▾'}</span>
      </div>
      {open && <pre className="agent-context-card__body">{content}</pre>}
    </div>
  )
}
