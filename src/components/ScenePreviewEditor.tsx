/**
 * ScenePreviewEditor — 场景资产预览编辑器
 *
 * 全屏 3D 视口实时预览场景，支持 Gizmo 拖拽编辑 Transform + 保存落盘。
 * 与 BlueprintEditor 保持一致的交互风格。
 */
import React, { useEffect, useRef, useState } from 'react'
import { ScenePreviewManager, AssetPreviewManager } from '../editor'
import { useEditorStore } from '../stores/editorStore'
import { notifySelectionChange, editorBus, EditorEvent, getSelectedActor } from '../editor'
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
  const [saving, setSaving] = useState(false)
  /** 撤销/重做按钮可用状态与忙碌标记（historyVersion 递增触发重查） */
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historyVersion, setHistoryVersion] = useState(0)
  /** 忙碌标记的 ref 同步（事件监听闭包内 state 会过期） */
  const historyBusyRef = useRef(false)
  const setBusy = (v: boolean) => { historyBusyRef.current = v; setHistoryBusy(v) }
  const assetPathRef = useRef(assetPath)
  assetPathRef.current = assetPath

  const activeTabId = useEditorStore((s) => s.activeTabId)
  const isTabActive = activeTabId === `sp:${assetPath}`

  // ─── 读取场景 JSON ───
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
    if (ok) {
      AssetPreviewManager.register(assetPath, mgr)
      setPreviewReady(true)
    }

    const ro = new ResizeObserver(() => mgr.resize())
    ro.observe(previewContainerRef.current)

    return () => {
      ro.disconnect()
      mgr.dispose()
      previewMgrRef.current = null
      setPreviewReady(false)
    }
  }, [data])

  // ─── 页签激活时登记为活动预览实例（驱动 Outline 同步） ───
  useEffect(() => {
    if (!isTabActive || !previewReady) return
    previewMgrRef.current?.activate(assetPath)
  }, [isTabActive, previewReady])

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

  // ─── TransformGizmo 交互 ───
  useEffect(() => {
    const mgr = previewMgrRef.current
    if (!mgr || !previewReady) return
    const canvas = mgr.renderer.domElement
    const gizmo = mgr.gizmo
    gizmo.onDragMove = notifySelectionChange

    let dragDidMove = false

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      if (!gizmo.visible) return
      const axis = gizmo.hitTest(e.clientX, e.clientY)
      if (axis) {
        dragDidMove = false
        gizmo.startDrag(axis, e.clientX, e.clientY)
        canvas.setPointerCapture(e.pointerId)
        e.preventDefault()
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      gizmo.hoverTest(e.clientX, e.clientY)
      if (gizmo.isDragging) {
        dragDidMove = true
        gizmo.updateDrag(e.clientX, e.clientY)
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      if (gizmo.isDragging) {
        gizmo.endDrag()
        if (dragDidMove) {
          // 拖拽松手 = 一个撤销点（提交进撤回系统，不写盘）；事件双保险刷新撤销按钮
          previewMgrRef.current?.commitPreviewEdit()
          editorBus.emit(EditorEvent.BLUEPRINT_TRANSFORM_DIRTY, assetPathRef.current)
        }
        try { canvas.releasePointerCapture(e.pointerId) } catch { }
      }
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)

    return () => {
      if (gizmo.isDragging) gizmo.endDrag()
      gizmo.onDragMove = null
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
    }
  }, [previewReady])

  // ─── 撤销/重做（Ctrl+Z / Ctrl+Y，仅激活页签响应）───
  useEffect(() => {
    const onUndo = () => {
      if (!isTabActive) return
      if (historyBusyRef.current) return
      setBusy(true)
      try {
        previewMgrRef.current?.undo()
      } finally {
        setBusy(false)
        setHistoryVersion((v) => v + 1)
      }
    }
    const onRedo = () => {
      if (!isTabActive) return
      if (historyBusyRef.current) return
      setBusy(true)
      try {
        previewMgrRef.current?.redo()
      } finally {
        setBusy(false)
        setHistoryVersion((v) => v + 1)
      }
    }
    window.addEventListener('shortcut-undo', onUndo)
    window.addEventListener('shortcut-redo', onRedo)
    return () => {
      window.removeEventListener('shortcut-undo', onUndo)
      window.removeEventListener('shortcut-redo', onRedo)
    }
  }, [isTabActive])

  // ─── 撤销/重做按钮 ───
  // 拖拽松手（commitPreviewEdit 新增撤销点但组件无 state 刷新）时刷新按钮可用状态
  useEffect(() => {
    const onTransformDirty = () => setHistoryVersion((v) => v + 1)
    const off = editorBus.on(EditorEvent.BLUEPRINT_TRANSFORM_DIRTY, onTransformDirty)
    return off
  }, [])

  // 拖拽提交（historyVersion 变化）/ 预览重建后重查栈状态
  useEffect(() => {
    const mgr = previewMgrRef.current
    setCanUndo(!!mgr && mgr.canUndo())
    setCanRedo(!!mgr && mgr.canRedo())
  }, [previewReady, historyVersion])

  const handleUndo = () => {
    if (historyBusy || !canUndo) return
    setBusy(true)
    try {
      previewMgrRef.current?.undo()
    } finally {
      setBusy(false)
      setHistoryVersion((v) => v + 1)
    }
  }

  const handleRedo = () => {
    if (historyBusy || !canRedo) return
    setBusy(true)
    try {
      previewMgrRef.current?.redo()
    } finally {
      setBusy(false)
      setHistoryVersion((v) => v + 1)
    }
  }

  // ─── 保存 ───
  const handleSave = async () => {
    const mgr = previewMgrRef.current
    if (!mgr || !data || saving) return

    const writeJsonFile = window.electronAPI?.writeJsonFile
    if (!writeJsonFile) return

    const saveData = mgr.collectSaveData()
    if (!saveData) return

    // 记住当前摄像机位姿 + 选中节点，重新加载后恢复
    const camPos = mgr.camera.position.clone()
    const camQuat = mgr.camera.quaternion.clone()
    const sel = getSelectedActor()
    const selName = sel ? sel.root.name : null

    setSaving(true)
    try {
      await writeJsonFile(assetPath, saveData)

      // 保存后内存/磁盘一致：刷新撤回基准（之后拖拽 push 的动作前快照 = 保存后的状态）
      previewMgrRef.current?.markCommitted(saveData)

      // 重新加载预览
      mgr.loadSceneAsset(saveData as unknown as SceneAsset)

      // loadSceneAsset 内部 clearPreview 会清掉 _currentScenePath，
      // 必须重新 activate 恢复路径，否则 Outline 判断 currentScenePath==null 返回空树
      mgr.activate(assetPath)

      // 恢复摄像机位姿
      mgr.restoreCamera(camPos, camQuat)

      // 恢复选中节点
      if (selName) {
        const tree = mgr.getActorTree()
        const node = tree.find((n) => n.name === selName && n.actor)
        if (node?.actor) { mgr.selectActor(node.actor) }
      }

      editorBus.emit(EditorEvent.BLUEPRINT_SAVED, assetPath)
    } finally {
      setSaving(false)
    }
  }

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
      <div style={{
        padding: '6px 16px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
        display: 'flex', alignItems: 'center', gap: 12, fontSize: 12,
      }}>
        <span style={{ fontSize: 14, lineHeight: 1 }}>🎬</span>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{data.name}</span>
        {data.mode && <span style={{ color: 'var(--accent)' }}>{data.mode}</span>}
        <div style={{ flex: 1 }} />
        <button
          onClick={handleUndo}
          disabled={historyBusy || !canUndo}
          title="撤销 (Ctrl+Z)"
          style={{
            fontSize: 11, padding: '3px 10px', cursor: (historyBusy || !canUndo) ? 'default' : 'pointer',
            background: 'var(--bg-tertiary)',
            color: (historyBusy || !canUndo) ? 'var(--text-dim)' : 'var(--text-primary)',
            border: '1px solid var(--border)', borderRadius: 3,
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}
        >
          ↶ 撤销
        </button>
        <button
          onClick={handleRedo}
          disabled={historyBusy || !canRedo}
          title="重做 (Ctrl+Y)"
          style={{
            fontSize: 11, padding: '3px 10px', cursor: (historyBusy || !canRedo) ? 'default' : 'pointer',
            background: 'var(--bg-tertiary)',
            color: (historyBusy || !canRedo) ? 'var(--text-dim)' : 'var(--text-primary)',
            border: '1px solid var(--border)', borderRadius: 3,
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}
        >
          ↷ 重做
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            fontSize: 11, padding: '3px 12px', cursor: saving ? 'default' : 'pointer',
            background: saving ? 'var(--bg-tertiary)' : 'var(--accent)',
            color: saving ? 'var(--text-dim)' : '#fff',
            border: 'none', borderRadius: 3,
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}
        >
          {saving ? (
            <span style={{
              width: 12, height: 12, border: '2px solid var(--text-dim)',
              borderTopColor: 'transparent', borderRadius: '50%',
              display: 'inline-block',
              animation: 'spin 0.6s linear infinite',
            }} />
          ) : null}
          {saving ? '保存中' : '保存'}
        </button>
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
