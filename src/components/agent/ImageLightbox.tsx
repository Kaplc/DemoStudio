/**
 * 聊天图片浮动放大窗（2026-09-16 用户需求：双击聊天中的图片缩略图开一个浮动窗口放大图片）
 *
 * 结构：
 * - openImageLightbox/closeImageLightbox：模块级单例触发器（缩略图位于 memo 化的深层组件里，
 *   用模块级订阅免去层层传 props / context）
 * - <ImageLightboxHost />：在 AgentPanel 根部挂载一次，订阅打开请求后渲染全屏浮层
 *
 * 交互：
 * - 打开：双击任意聊天图片缩略图（用户消息图片 / 工具卡片图片预览）
 * - 关闭：Esc / 点击遮罩 / 右上角 ✕ / 双击放大图
 * - 标题栏显示文件名 + 图片原始像素尺寸（onLoad 后回填）
 */
import React, { useEffect, useState } from 'react'
import { logger } from '../../engine/Logger'

interface LightboxState {
  /** 图片 src（data URL 或 blob URL） */
  src: string
  /** 展示名（文件路径 / 消息图片名） */
  name?: string
}

type LightboxListener = (state: LightboxState | null) => void

let currentState: LightboxState | null = null
const listeners = new Set<LightboxListener>()

function notify(): void {
  for (const listener of listeners) listener(currentState)
}

/** 打开图片浮动放大窗（缩略图 onDoubleClick 调用） */
export function openImageLightbox(src: string, name?: string): void {
  if (!src) return
  currentState = { src, name }
  logger.info(`[ImageLightbox] 打开图片浮窗: ${name || '(未命名)'}`)
  notify()
}

/** 关闭图片浮动放大窗（重复调用幂等） */
export function closeImageLightbox(): void {
  if (!currentState) return
  currentState = null
  logger.info('[ImageLightbox] 关闭图片浮窗')
  notify()
}

/** 订阅浮窗状态（Host 挂载时订阅，返回取消订阅函数） */
export function subscribeImageLightbox(listener: LightboxListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * 浮窗宿主：AgentPanel 根部挂载一次。无浮窗时渲染 null（不占 DOM），
 * 打开时渲染全屏遮罩 + 顶部标题栏 + 适配视口的大图。
 */
export const ImageLightboxHost: React.FC = () => {
  const [state, setState] = useState<LightboxState | null>(currentState)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => subscribeImageLightbox(setState), [])

  // Esc 关闭（仅浮窗打开期间监听）
  useEffect(() => {
    if (!state) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeImageLightbox()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [state])

  // 切换图片时清空上一张的尺寸回填
  useEffect(() => { setNatural(null) }, [state?.src])

  if (!state) return null

  const title = `${state.name || '图片预览'}${natural ? ` · ${natural.w}×${natural.h}` : ''}`

  return (
    <div
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={state.name || '图片预览'}
      onClick={() => closeImageLightbox()}
    >
      <div className="image-lightbox__bar">
        <span className="image-lightbox__title" title={title}>{title}</span>
        <button
          type="button"
          className="image-lightbox__close"
          aria-label="关闭图片预览"
          title="关闭 (Esc)"
          onClick={(e) => { e.stopPropagation(); closeImageLightbox() }}
        >
          ✕
        </button>
      </div>
      <img
        className="image-lightbox__img"
        src={state.src}
        alt={state.name || '图片预览'}
        title="双击关闭"
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={() => closeImageLightbox()}
        onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
      />
    </div>
  )
}
