/**
 * ScenePreviewEditor — 场景资产预览编辑器
 *
 * 全屏 3D 视口实时预览场景，objects 树在 Outline 面板中展示。
 */
import React, { useEffect, useRef, useState } from 'react'
import { ScenePreviewManager } from '../editor/ScenePreviewManager'
import type { SceneAsset } from '../engine'

interface ScenePreviewEditorProps {
  assetPath: string
}

interface SceneData {
  name: string
  mode?: string
  objects?: Array<Record<string, unknown>>
  skybox?: Record<string, unknown>
}

export function ScenePreviewEditor({ assetPath }: ScenePreviewEditorProps) {
  const [data, setData] = useState<SceneData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const previewContainerRef = useRef<HTMLDivElement>(null)
  const previewMgrRef = useRef<ScenePreviewManager | null>(null)
  const [previewReady, setPreviewReady] = useState(false)

  useEffect(() => {
    const readJsonFile = window.electronAPI?.readJsonFile
    if (!readJsonFile) {
      setError('读取文件需要 Electron 环境')
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    readJsonFile(assetPath)
      .then((result) => {
        if (cancelled) return
        if (result.success && result.data) {
          setData(result.data as SceneData)
        } else {
          setError('读取场景文件失败')
        }
        setLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        setError(String(e))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [assetPath])

  // ─── 创建/销毁 3D 预览 ───
  useEffect(() => {
    if (!data || !previewContainerRef.current) return

    const mgr = new ScenePreviewManager(previewContainerRef.current)
    previewMgrRef.current = mgr

    const ok = mgr.loadSceneAsset(data as unknown as SceneAsset)
    if (ok) setPreviewReady(true)

    const ro = new ResizeObserver(() => mgr.resize())
    ro.observe(previewContainerRef.current)

    return () => {
      ro.disconnect()
      mgr.dispose()
      previewMgrRef.current = null
      setPreviewReady(false)
    }
  }, [data])

  // ─── WASD 键盘事件 ───
  useEffect(() => {
    const WASD_KEYS = new Set(['w', 'W', 'a', 'A', 's', 'S', 'd', 'D', 'q', 'Q', 'e', 'E'])

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!WASD_KEYS.has(e.key)) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      previewMgrRef.current?.onWASDKeyDown(e.key)
      e.preventDefault()
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!WASD_KEYS.has(e.key)) return
      previewMgrRef.current?.onWASDKeyUp(e.key)
    }

    const handleBlur = () => {
      previewMgrRef.current?.clearWASDKeys()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
        加载场景...
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--error)' }}>
        {error}
      </div>
    )
  }

  if (!data) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
        无场景数据
      </div>
    )
  }

  const filename = assetPath.split('/').pop() ?? assetPath

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-primary)' }}>
      {/* 头部 */}
      <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>🎬</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{data.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
              {filename}
              {data.mode && <span style={{ marginLeft: 8, color: 'var(--accent)' }}>mode: {data.mode}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* 全屏 3D 预览视口 */}
      <div style={{ flex: 1, position: 'relative', background: '#1a1a2e', overflow: 'hidden' }}>
        <div
          ref={previewContainerRef}
          style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}
        />
        {!previewReady && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-dim)', fontSize: 12, pointerEvents: 'none',
          }}>
            预览加载中...
          </div>
        )}
        <div style={{
          position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
          fontSize: 10, color: 'rgba(255,255,255,0.3)', pointerEvents: 'none',
          whiteSpace: 'nowrap',
        }}>
          左键旋转视角 · 右键平移 · 滚轮进退 · WASD 移动 · Q/E 升降
        </div>
      </div>

      {/* 底部状态栏 */}
      <div style={{
        borderTop: '1px solid var(--border)', padding: '4px 12px',
        fontSize: 10, color: 'var(--text-dim)', background: 'var(--bg-secondary)',
        display: 'flex', gap: 16,
      }}>
        <span>Scene: {data.name}</span>
        <span>File: {filename}</span>
      </div>
    </div>
  )
}
