/**
 * BlueprintEditor — 蓝图资产编辑器
 *
 * 左侧展示蓝图结构化数据（继承链、Components、Children、Defaults），
 * 右侧提供 3D 视口实时预览蓝图 Actor。
 *
 * 类似 UE 的 Blueprint Class Editor 简化版。
 */
import React, { useEffect, useRef, useState } from 'react'
import { BlueprintPreviewManager } from '../editor/BlueprintPreviewManager'
import { BlueprintRegistry, Actor } from '../engine'
import type { BlueprintAsset } from '../engine'
import { ResizeHandle } from './ResizeHandle'
import { useEditorStore } from '../stores/editorStore'
import { notifySelectionChange } from '../editor'

interface BlueprintEditorProps {
  assetPath: string
}

/** 子 Actor 节点（递归，与 BlueprintAsset 结构一致） */
interface BlueprintChildNode {
  blueprint?: number
  baseClass?: string
  name?: string
  id?: number
  overrides?: Record<string, unknown>
  components?: Array<{ id?: number; name?: string; baseClass: string; properties?: Record<string, unknown>; _remove?: boolean }>
  children?: BlueprintChildNode[]
  _remove?: boolean
}

interface BlueprintData {
  id: number
  name: string
  baseClass: string
  parent?: number
  components?: Array<{ id?: number; name?: string; baseClass: string; properties?: Record<string, unknown>; _remove?: boolean }>
  children?: BlueprintChildNode[]
}

export function BlueprintEditor({ assetPath }: BlueprintEditorProps) {
  const [data, setData] = useState<BlueprintData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const previewContainerRef = useRef<HTMLDivElement>(null)
  const previewMgrRef = useRef<BlueprintPreviewManager | null>(null)
  const [previewReady, setPreviewReady] = useState(false)
  /** 左侧面板宽度（px），可由 ResizeHandle 拖动调整 */
  const [leftWidth, setLeftWidth] = useState(320)
  /** 蓝图编辑刷新信号：外部/内部编辑后 bump，触发重新读盘 + 刷新预览 */
  const blueprintEditNonce = useEditorStore((s) => s.blueprintEditNonce)

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

    // 确保蓝图已注册（编辑器打开时，蓝图可能尚未注册到 BlueprintRegistry）
    if (!BlueprintRegistry.has(data.id)) {
      BlueprintRegistry.loadFromJson(data.id, data as unknown as BlueprintAsset)
    }

    const mgr = new BlueprintPreviewManager(previewContainerRef.current)
    previewMgrRef.current = mgr

    // 加载蓝图 Actor
    const ok = mgr.loadBlueprint(data.id)
    if (ok) {
      setPreviewReady(true)
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

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      if (!gizmo.visible) return
      const axis = gizmo.hitTest(e.clientX, e.clientY)
      if (axis) {
        gizmo.startDrag(axis, e.clientX, e.clientY)
        canvas.setPointerCapture(e.pointerId)
        e.preventDefault()
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      gizmo.hoverTest(e.clientX, e.clientY)
      if (gizmo.isDragging) gizmo.updateDrag(e.clientX, e.clientY)
    }

    const onPointerUp = (e: PointerEvent) => {
      if (gizmo.isDragging) {
        gizmo.endDrag()
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
    if (!mgr || !data) {
      console.log('[Save] 跳过: mgr 或 data 为空')
      return
    }
    console.log(`[Save] 开始保存: ${assetPath}`)

    const writeJsonFile = window.electronAPI?.writeJsonFile
    if (!writeJsonFile) {
      console.log('[Save] 跳过: writeJsonFile 不可用')
      return
    }

    // 从大纲 actor 树构建 blueprintRef.id → Actor 映射
    const actorById = new Map<number, Actor>()
    const tree = mgr.getActorTree()
    console.log(`[Save] 大纲 actor 树节点数: ${tree.length}`)
    for (const node of tree) {
      if (!node.actor) continue
      const ref = node.actor.blueprintRef?.id
      console.log(`[Save] 节点 name="${node.name}" actor=${node.actor.name} blueprintRef=${ref}`)
      if (ref != null) actorById.set(ref, node.actor)
    }
    console.log(`[Save] actorById 映射: ${JSON.stringify([...actorById.keys()])}`)

    const cloned: Record<string, unknown> = JSON.parse(JSON.stringify(data))
    const logs: string[] = []

    function updateNode(node: Record<string, unknown>, nodeId?: number, path?: string) {
      if (nodeId == null) {
        logs.push(`  ${path}: 无 id，跳过`)
        return
      }
      const actor = actorById.get(nodeId)
      if (!actor) {
        logs.push(`  ${path}: id=${nodeId} 无匹配 actor，跳过`)
        return
      }
      const pos = [actor.position.x, actor.position.y, actor.position.z]
      const rot = [actor.rotation.x, actor.rotation.y, actor.rotation.z]
      const scl = [actor.scale.x, actor.scale.y, actor.scale.z]
      node.position = pos
      node.rotation = rot
      node.scale = scl
      logs.push(`  ${path}: id=${nodeId} pos=${JSON.stringify(pos)} rot=${JSON.stringify(rot)} scl=${JSON.stringify(scl)}`)
    }

    updateNode(cloned, data.id, 'root')
    const rootLog = logs[0]
    logs.length = 0
    console.log(`[Save] 根节点:\n${rootLog}`)

    function walkChildren(children: unknown[], parentPath: string) {
      for (let i = 0; i < children.length; i++) {
        const child = children[i] as Record<string, unknown>
        const path = `${parentPath}.children[${i}]`
        updateNode(child, child.id as number | undefined, path)
        if (child.children) walkChildren(child.children as unknown[], path)
      }
    }
    if (cloned.children) {
      walkChildren(cloned.children as unknown[], 'root')
    }

    console.log(`[Save] 子节点更新:\n${logs.join('\n')}`)
    console.log(`[Save] 写入文件: ${assetPath}`)
    await writeJsonFile(assetPath, cloned)

    // 更新注册表缓存并重新加载预览
    console.log('[Save] 重新加载预览')
    BlueprintRegistry.loadFromJson(data.id, cloned as unknown as BlueprintAsset)
    mgr.loadBlueprint(data.id)
    console.log('[Save] 保存完成')
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
        {data.parent && <span style={{ color: 'var(--accent)' }}>extends {data.parent}</span>}
        <div style={{ flex: 1 }} />
        <button
          onClick={handleSave}
          style={{
            fontSize: 11, padding: '3px 12px', cursor: 'pointer',
            background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 3,
          }}
        >
          保存
        </button>
      </div>

      {/* 主体：左数据 + 右 3D 预览 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* 左侧：结构化数据 */}
        <div style={{ width: leftWidth, minWidth: 240, maxWidth: 800, overflow: 'auto', padding: '12px 16px', flexShrink: 0, position: 'relative' }}>
          {/* Parent 继承 */}
          {data.parent && (
            <Section title="Parent Blueprint">
              <Row label="Inherits From" value={String(data.parent)} link />
            </Section>
          )}

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
            左键旋转视角 · 右键平移 · 滚轮进退 · WASD 移动 · Q/E 升降
          </div>
        </div>
      </div>

      {/* 底部状态栏 */}
      <div style={{
        borderTop: '1px solid var(--border)', padding: '4px 12px',
        fontSize: 10, color: 'var(--text-dim)', background: 'var(--bg-secondary)',
        display: 'flex', gap: 16,
      }}>
        <span>Blueprint: {data.name} (#{data.id})</span>
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
