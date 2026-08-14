/**
 * BlueprintEditor — 蓝图资产编辑器
 *
 * 全屏 3D/UI 视口实时预览蓝图 Actor，支持平移/旋转/缩放与选中联动。
 *
 * 类似 UE 的 Blueprint Class Editor 简化版。
 */
import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { BlueprintPreviewManager, UIPreviewManager, AssetPreviewManager } from '../editor'
import { BlueprintRegistry, Actor } from '../engine'
import type { BlueprintAsset } from '../engine'
import { useEditorStore } from '../stores/editorStore'
import { useEditorPrefsStore } from '../stores/editorPrefsStore'
import { notifySelectionChange, editorBus, EditorEvent, getSelectedActor } from '../editor'
import { BlueprintEditorService } from '../editor/blueprintEdit/BlueprintEditorService'
import { UndoManager } from '../editor/blueprintEdit/UndoManager'

interface BlueprintEditorProps {
  assetPath: string
}

/** 子 Actor 节点（递归，与 BlueprintAsset 结构一致） */
interface BlueprintChildNode {
  blueprint?: number
  ref?: string
  baseClass?: string
  name?: string
  id?: number
  overrides?: Record<string, unknown>
  components?: Array<{ id?: number; name?: string; baseClass: string; properties?: Record<string, unknown>; _remove?: boolean }>
  children?: BlueprintChildNode[]
  _remove?: boolean
}

interface BlueprintData {
  name: string
  baseClass: string
  components?: Array<{ id?: number; name?: string; baseClass: string; properties?: Record<string, unknown>; _remove?: boolean }>
  children?: BlueprintChildNode[]
}

/** 磁盘路径（src/projects/...）→ 蓝图注册 key（asset/...） */
function diskPathToAssetKey(diskPath: string): string {
  const idx = diskPath.indexOf('/asset/')
  return idx >= 0 ? diskPath.slice(idx + 1) : diskPath
}

/** widget 资产（.widget.json）→ UI 正交预览模式 */
function isWidgetAsset(assetPath: string): boolean {
  return /\.widget\.json$/i.test(assetPath)
}

export function BlueprintEditor({ assetPath }: BlueprintEditorProps) {
  const [data, setData] = useState<BlueprintData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const previewContainerRef = useRef<HTMLDivElement>(null)
  const previewMgrRef = useRef<BlueprintPreviewManager | UIPreviewManager | null>(null)
  const [previewReady, setPreviewReady] = useState(false)
  const [saving, setSaving] = useState(false)
  /** 撤销/重做按钮可用状态与忙碌标记（historyVersion 递增触发重查） */
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historyVersion, setHistoryVersion] = useState(0)
  /** 保存 assetPath 引用供事件回调使用（避免闭包捕获旧值） */
  const assetPathRef = useRef(assetPath)
  assetPathRef.current = assetPath
  /** 保存后待恢复的摄像机位姿（bumpBlueprintEdit → setData → useEffect 重建预览后恢复） */
  const pendingCamRef = useRef<{ pos: THREE.Vector3; quat: THREE.Quaternion; zoom?: number } | null>(null)
  /** 保存前选中的 Actor 名称，保存完成重建预览后自动恢复选中 */
  const pendingSelectRef = useRef<string | null>(null)
  /** 重建前自动记忆的摄像机位姿（编辑/撤销/重做触发的重建也保持视角） */
  const lastCamRef = useRef<{ pos: THREE.Vector3; quat: THREE.Quaternion; zoom?: number } | null>(null)
  /** 重建前自动记忆的选中 Actor 名称 */
  const lastSelectRef = useRef<string | null>(null)
  /** 蓝图编辑刷新信号：外部/内部编辑后 bump，触发重新读盘 + 刷新预览 */
  const blueprintEditNonce = useEditorStore((s) => s.blueprintEditNonce)
  /** 本蓝图页签是否为当前激活页签（页签常驻挂载，需据此登记活动预览实例） */
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const isTabActive = activeTabId === `bp:${assetPath}`

  // ─── 读取蓝图 JSON（走服务层：有工作副本时返回内存最新态，避免 undo/redo 后读到磁盘旧数据）───
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    console.log(`[BlueprintEditor] 读盘/工作副本: ${assetPath}（nonce=${blueprintEditNonce}）`)
    BlueprintEditorService.read(assetPath)
      .then((r) => {
        if (cancelled) return
        if (r.ok && r.asset) {
          console.log(`[BlueprintEditor] 读盘成功: ${assetPath}`)
          setData(r.asset as unknown as BlueprintData)
        } else {
          console.warn(`[BlueprintEditor] 读盘失败: ${assetPath} → ${r.error ?? '未知错误'}`)
          setError(r.error ?? '读取蓝图文件失败')
        }
        setLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        console.warn(`[BlueprintEditor] 读盘异常: ${assetPath} → ${String(e)}`)
        setError(String(e))
        setLoading(false)
      })
    return () => { cancelled = true }
    // blueprintEditNonce：任何蓝图被编辑后重新读盘（工作副本优先）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetPath, blueprintEditNonce])

  // ─── 创建/销毁 3D 预览 ───
  useEffect(() => {
    if (!data || !previewContainerRef.current) return
    console.log(`[BlueprintEditor] 重建预览: ${assetPath}（data 变更触发，组件=${data.components?.length ?? 0} 子节点=${data.children?.length ?? 0}）`)

    // 注册 key 由磁盘路径推导（asset/...）
    const assetKey = diskPathToAssetKey(assetPath)

    // 确保蓝图已注册（编辑器打开时，蓝图可能尚未注册到 BlueprintRegistry）
    if (!BlueprintRegistry.has(assetKey)) {
      BlueprintRegistry.loadFromJson(assetKey, data as unknown as BlueprintAsset)
    }

    // widget 资产用 UI 正交预览管理器；其余蓝图用 3D 预览管理器
    const isUi = isWidgetAsset(assetPath)
    const mgr = isUi
      ? new UIPreviewManager(previewContainerRef.current)
      : new BlueprintPreviewManager(previewContainerRef.current)
    previewMgrRef.current = mgr

    // 加载蓝图 Actor
    const ok = mgr.loadBlueprint(assetKey, assetPath)
    if (ok) {
      // 用页签的相对路径注册到总管理器，供 Outline 按 assetPath 直接查找
      AssetPreviewManager.register(assetPath, mgr)
      setPreviewReady(true)

      // 重建预览后恢复摄像机位姿：保存时显式设置优先，否则沿用重建前记忆
      // （编辑/撤销/重做都会触发重建，恢复后视角不再被 fitToWidget 重置）
      const cam = pendingCamRef.current ?? lastCamRef.current
      if (cam) {
        mgr.restoreCamera(cam.pos, cam.quat, cam.zoom)
        pendingCamRef.current = null
      }
      // 恢复选中：同理（编辑后保持选中，不跳回总览）
      const selName = pendingSelectRef.current ?? lastSelectRef.current
      if (selName) {
        pendingSelectRef.current = null
        // 通过 getActorTree() 遍历场景图查找（GetAllActors 可能漏掉递归子 Actor）
        const tree = mgr.getActorTree()
        const node = tree.find((n) => n.name === selName && n.actor)
        if (node?.actor) {
          mgr.selectActor(node.actor)
        }
      }
    }

    // ResizeObserver 同步尺寸
    const ro = new ResizeObserver(() => {
      mgr.resize()
    })
    ro.observe(previewContainerRef.current)

    return () => {
      ro.disconnect()
      // 重建前记忆相机位姿 + 选中节点（重建后恢复：编辑/撤销/重做不再重置视角与选中）
      if (previewMgrRef.current) {
        lastCamRef.current = {
          pos: previewMgrRef.current.camera.position.clone(),
          quat: previewMgrRef.current.camera.quaternion.clone(),
          zoom: previewMgrRef.current.camera.zoom,
        }
        const sel = getSelectedActor()
        if (sel) lastSelectRef.current = sel.root.name
      }
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

  // ─── 视口比例同步：widget 预览时根画布跟随比例选择器（保持高度，按比例调宽） ───
  useEffect(() => {
    if (!previewMgrRef.current || !previewReady) return
    if (!isWidgetAsset(assetPath)) return
    // 初次加载也应用当前比例：根画布尺寸由视口比例驱动（资产 JSON 值仅作设计基准）
    const ratioStr = useEditorPrefsStore.getState().viewport.aspectRatio
    const ratio = ratioStr
      ? (() => { const [aw, ah] = ratioStr.split('/').map(Number); return aw / ah })()
      : null
    ;(previewMgrRef.current as UIPreviewManager | null)?.setViewportAspect?.(ratio)
    const unsub = useEditorPrefsStore.subscribe((state, prev) => {
      if (state.viewport.aspectRatio !== prev.viewport.aspectRatio) {
        const nextRatioStr = state.viewport.aspectRatio
        const nextRatio = nextRatioStr
          ? (() => { const [aw, ah] = nextRatioStr.split('/').map(Number); return aw / ah })()
          : null
        // widget 资产必然创建 UIPreviewManager（isWidgetAsset 已判定）
        ;(previewMgrRef.current as UIPreviewManager | null)?.setViewportAspect?.(nextRatio)
      }
    })
    return unsub
  }, [assetPath, previewReady])

  // ─── WASD 键盘事件（自由漫游） ───
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

    const onPointerUp = async (e: PointerEvent) => {
      if (gizmo.isDragging) {
        gizmo.endDrag()
        if (dragDidMove) {
          // 3D 蓝图拖动松手：本次拖拽目标（= 当前选中节点）的属性变化走 apply 统一链路提交，
          // 撤回点（动作前快照）在 apply 内部 push = 松手才进撤回系统，且不写盘
          const sel = getSelectedActor()
          await mgr.commitPreviewEdit?.(sel)
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
      console.log(`[BlueprintEditor] 快捷键撤销 (Ctrl+Z): ${assetPath}`)
      const sel = getSelectedActor()
      if (sel) pendingSelectRef.current = sel.root.name   // 重建后恢复选中
      BlueprintEditorService.undo(assetPath)
    }
    const onRedo = () => {
      if (!isTabActive) return
      console.log(`[BlueprintEditor] 快捷键重做 (Ctrl+Y): ${assetPath}`)
      const sel = getSelectedActor()
      if (sel) pendingSelectRef.current = sel.root.name
      BlueprintEditorService.redo(assetPath)
    }
    window.addEventListener('shortcut-undo', onUndo)
    window.addEventListener('shortcut-redo', onRedo)
    return () => {
      window.removeEventListener('shortcut-undo', onUndo)
      window.removeEventListener('shortcut-redo', onRedo)
    }
  }, [isTabActive, assetPath])

  // ─── 撤销/重做按钮 ───
  // 拖动松手（updateFromPreview 新增撤销点但不 bump）时刷新按钮可用状态
  useEffect(() => {
    const onTransformDirty = () => setHistoryVersion((v) => v + 1)
    const off = editorBus.on(EditorEvent.BLUEPRINT_TRANSFORM_DIRTY, onTransformDirty)
    return off
  }, [])

  // 编辑（nonce 变化）/ 撤销/重做（historyVersion 变化）后重查栈状态
  useEffect(() => {
    const key = diskPathToAssetKey(assetPath)
    setCanUndo(UndoManager.canUndo(key))
    setCanRedo(UndoManager.canRedo(key))
  }, [assetPath, blueprintEditNonce, historyVersion])

  const handleUndo = async () => {
    if (historyBusy || !canUndo) return
    console.log(`[BlueprintEditor] 点击撤销按钮: ${assetPath}（canUndo=${canUndo}）`)
    const sel = getSelectedActor()
    if (sel) pendingSelectRef.current = sel.root.name   // 重建后恢复选中
    setHistoryBusy(true)
    try {
      await BlueprintEditorService.undo(assetPath)
    } finally {
      setHistoryBusy(false)
      setHistoryVersion((v) => v + 1)
    }
  }

  const handleRedo = async () => {
    if (historyBusy || !canRedo) return
    console.log(`[BlueprintEditor] 点击重做按钮: ${assetPath}（canRedo=${canRedo}）`)
    const sel = getSelectedActor()
    if (sel) pendingSelectRef.current = sel.root.name
    setHistoryBusy(true)
    try {
      await BlueprintEditorService.redo(assetPath)
    } finally {
      setHistoryBusy(false)
      setHistoryVersion((v) => v + 1)
    }
  }

  // ─── 保存 ───
  const handleSave = async () => {
    const mgr = previewMgrRef.current
    if (!mgr || !data || saving) return

    setSaving(true)
    try {
      // 记住当前摄像机位姿 + 选中节点，供 useEffect 重建预览后恢复
      pendingCamRef.current = {
        pos: mgr.camera.position.clone(),
        quat: mgr.camera.quaternion.clone(),
      }
      const sel = getSelectedActor()
      pendingSelectRef.current = sel ? sel.root.name : null

      // 保存前先把预览内存态同步进工作副本（拖动松手已同步，此处兜底），再 flush 落盘
      const saveData = mgr.collectSaveData()
      if (saveData) BlueprintEditorService.updateFromPreview(assetPath, saveData as unknown as BlueprintAsset)
      const r = await BlueprintEditorService.save(assetPath)
      if (!r.ok) console.error('[BlueprintEditor] 保存失败:', r.error)

      // 通知其他页签/面板刷新 + 触发行内 useEffect 重建预览
      useEditorStore.getState().bumpBlueprintEdit(assetPath)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
        加载蓝图...
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
        无蓝图数据
      </div>
    )
  }

  const filename = assetPath.split('/').pop() ?? assetPath

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-primary)' }}>
      {/* 基类信息条 */}
      <div style={{
        padding: '6px 16px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
        display: 'flex', alignItems: 'center', gap: 12, fontSize: 12,
      }}>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{data.name}</span>
        <span style={{ color: 'var(--success)' }}>{data.baseClass}</span>
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
            <span className="btn-spinner" style={{
              width: 12, height: 12, border: '2px solid var(--text-dim)',
              borderTopColor: 'transparent', borderRadius: '50%',
              display: 'inline-block',
              animation: 'spin 0.6s linear infinite',
            }} />
          ) : null}
          {saving ? '保存中' : '保存'}
        </button>
      </div>

      {/* 主体：全屏预览视口 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* 预览视口 */}
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
            {isWidgetAsset(assetPath)
              ? '左键/右键平移 · 滚轮缩放 · WASD 平移'
              : '左键旋转视角 · 右键平移 · 滚轮进退 · WASD 移动 · Q/E 升降'}
          </div>
        </div>
      </div>

      {/* 底部状态栏 */}
      <div style={{
        borderTop: '1px solid var(--border)', padding: '4px 12px',
        fontSize: 10, color: 'var(--text-dim)', background: 'var(--bg-secondary)',
        display: 'flex', gap: 16,
      }}>
        <span>Blueprint: {data.name} ({diskPathToAssetKey(assetPath)})</span>
        <span>Class: {data.baseClass}</span>
        <span>File: {filename}</span>
      </div>
    </div>
  )
}

/** 属性行 */
function Row({ label, value, highlight, link }: { label: string; value: string; highlight?: boolean; link?: boolean }) {
  return (
    <div style={{ fontSize: 12, padding: '3px 0', display: 'flex', gap: 12 }}>
      <span style={{ color: 'var(--text-dim)', minWidth: 100 }}>{label}</span>
      <span style={{ color: highlight ? 'var(--success)' : link ? 'var(--accent)' : 'var(--text-primary)' }}>
        {value}
      </span>
    </div>
  )
}
