/**
 * BlueprintEditor — 蓝图资产编辑器
 *
 * 左侧展示蓝图结构化数据（继承链、Components、Children、Defaults），
 * 右侧提供 3D 视口实时预览蓝图 Actor。
 *
 * 类似 UE 的 Blueprint Class Editor 简化版。
 */
import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { BlueprintPreviewManager, UIPreviewManager, AssetPreviewManager } from '../editor'
import { BlueprintRegistry, Actor } from '../engine'
import type { BlueprintAsset } from '../engine'
import { ResizeHandle } from './ResizeHandle'
import { useEditorStore } from '../stores/editorStore'
import { notifySelectionChange, editorBus, EditorEvent, getSelectedActor } from '../editor'

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
  /** 左侧面板宽度（px），可由 ResizeHandle 拖动调整 */
  const [leftWidth, setLeftWidth] = useState(320)
  /** 保存 assetPath 引用供事件回调使用（避免闭包捕获旧值） */
  const assetPathRef = useRef(assetPath)
  assetPathRef.current = assetPath
  /** 保存后待恢复的摄像机位姿（bumpBlueprintEdit → setData → useEffect 重建预览后恢复） */
  const pendingCamRef = useRef<{ pos: THREE.Vector3; quat: THREE.Quaternion } | null>(null)
  /** 保存前选中的 Actor 名称，保存完成重建预览后自动恢复选中 */
  const pendingSelectRef = useRef<string | null>(null)
  /** 蓝图编辑刷新信号：外部/内部编辑后 bump，触发重新读盘 + 刷新预览 */
  const blueprintEditNonce = useEditorStore((s) => s.blueprintEditNonce)
  /** 本蓝图页签是否为当前激活页签（页签常驻挂载，需据此登记活动预览实例） */
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const isTabActive = activeTabId === `bp:${assetPath}`

  // ─── 读取蓝图 JSON ───
  useEffect(() => {
    const readJsonFile = window.electronAPI?.readJsonFile
    if (!readJsonFile) {
      setError('读取蓝图需要 Electron 环境')
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
          setData(result.data as BlueprintData)
        } else {
          setError('读取蓝图文件失败')
        }
        setLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        setError(String(e))
        setLoading(false)
      })
    return () => { cancelled = true }
    // blueprintEditNonce：任何蓝图被编辑后重新读盘（自己的文件）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetPath, blueprintEditNonce])

  // ─── 创建/销毁 3D 预览 ───
  useEffect(() => {
    if (!data || !previewContainerRef.current) return

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
    const ok = mgr.loadBlueprint(assetKey)
    if (ok) {
      // 用页签的相对路径注册到总管理器，供 Outline 按 assetPath 直接查找
      AssetPreviewManager.register(assetPath, mgr)
      setPreviewReady(true)

      // 保存后重建预览：恢复之前保存的摄像机位姿 + 选中节点
      const pending = pendingCamRef.current
      if (pending) {
        mgr.restoreCamera(pending.pos, pending.quat)
        pendingCamRef.current = null
      }
      const selName = pendingSelectRef.current
      if (selName) {
        pendingSelectRef.current = null
        // 通过 getActorTree() 遍历场景图查找（GetAllActors 可能漏掉递归子 Actor）
        const tree = mgr.getActorTree()
        console.log('[SelectRestore] 重建后 Actor 树:', tree.map(n => `${n.name}[${n.actor?.constructor.name}]`).join(', '))
        const node = tree.find((n) => n.name === selName && n.actor)
        console.log('[SelectRestore] 查找', selName, '结果:', node?.actor?.constructor.name)
        if (node?.actor) {
          mgr.selectActor(node.actor)
          console.log('[SelectRestore] selectActor 完成')
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

    const onPointerUp = (e: PointerEvent) => {
      if (gizmo.isDragging) {
        gizmo.endDrag()
        if (dragDidMove) {
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

  // ─── 保存 ───
  const handleSave = async () => {
    const mgr = previewMgrRef.current
    if (!mgr || !data || saving) return

    const writeJsonFile = window.electronAPI?.writeJsonFile
    if (!writeJsonFile) return

    // 通过 spawn 时建立的 actor↔json 映射，把大纲各 Actor 的实时 transform 回写到 JSON
    const saveData = mgr.collectSaveData()
    if (!saveData) return

    setSaving(true)
    try {
      // 记住当前摄像机位姿 + 选中节点，供 useEffect 重建预览后恢复
      pendingCamRef.current = {
        pos: mgr.camera.position.clone(),
        quat: mgr.camera.quaternion.clone(),
      }
      const sel = getSelectedActor()
      pendingSelectRef.current = sel ? sel.root.name : null
      console.log('[SelectRestore] 保存前选中:', pendingSelectRef.current, 'sel:', sel?.constructor.name)

      await writeJsonFile(assetPath, saveData)

      // 更新注册表缓存（预览重建由 bumpBlueprintEdit → setData → useEffect 驱动，不在此手动 load）
      BlueprintRegistry.loadFromJson(diskPathToAssetKey(assetPath), saveData as unknown as BlueprintAsset)

      // 通知其他页签/面板刷新 + 触发行内 useEffect 重建预览
      useEditorStore.getState().bumpBlueprintEdit(assetPath)
      editorBus.emit(EditorEvent.BLUEPRINT_SAVED, assetPath)
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

      {/* 主体：左数据 + 右 3D 预览 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* 左侧：结构化数据 */}
        <div style={{ width: leftWidth, minWidth: 240, maxWidth: 800, overflow: 'auto', padding: '12px 16px', flexShrink: 0, position: 'relative' }}>
          {/* Components — 组件列表 */}
          <Section title={`Components (${data.components?.length ?? 0})`}>
            {(data.components ?? []).length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--text-dim)', padding: '4px 0' }}>无组件</div>
            ) : (
              (data.components ?? []).map((comp, i) => (
                <div
                  key={i}
                  style={{
                    padding: '4px 10px', marginBottom: 2, borderRadius: 3,
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-primary)',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--accent)' }}>{comp.name || comp.baseClass}</span>
                  {comp._remove && <span style={{ color: 'var(--error)', fontSize: 10 }}>removed</span>}
                </div>
              ))
            )}
          </Section>


          {/* 拖拽分割条（定位在左侧面板右边缘） */}
          <ResizeHandle
            direction="horizontal"
            onResize={(delta) => setLeftWidth((w) => Math.max(200, Math.min(800, w + delta)))}
            position="right"
          />
        </div>

        {/* 右侧：3D 预览视口 */}
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

/** 区块标题 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)',
        textTransform: 'uppercase', letterSpacing: '0.5px',
        marginBottom: 6, paddingBottom: 4,
        borderBottom: '1px solid var(--border)',
      }}>
        {title}
      </div>
      {children}
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
