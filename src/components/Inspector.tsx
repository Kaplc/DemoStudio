import React, { useEffect, useState } from 'react'
import * as THREE from 'three'
import { useEditorStore, type BlueprintSelection } from '../stores/editorStore'
import { useSaveStore } from '../stores/saveStore'
import { getSelected, getSelectedActor, select, getSelectionKey, onSelectionChange } from '../editor/SelectionManager'
import { Actor, Component } from '../engine'
import type { BlueprintAsset } from '../engine'
import { BlueprintEditorService } from '../editor/blueprintEdit/BlueprintEditorService'

function formatSaveTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function fmt(v: number): string {
  return v.toFixed(2)
}

function ActorTransformView({ actor }: { actor: Actor }) {
  return (
    <div className="property-group">
      <div className="property-group-title">Transform</div>
      <div className="property-row">
        <span className="property-label">Position</span>
        <span className="property-value" style={{ fontSize: 11 }}>
          X:{fmt(actor.position.x)} Y:{fmt(actor.position.y)} Z:{fmt(actor.position.z)}
        </span>
      </div>
      <div className="property-row">
        <span className="property-label">Rotation</span>
        <span className="property-value" style={{ fontSize: 11 }}>
          X:{fmt(actor.rotation.x)} Y:{fmt(actor.rotation.y)} Z:{fmt(actor.rotation.z)}
        </span>
      </div>
      <div className="property-row">
        <span className="property-label">Scale</span>
        <span className="property-value" style={{ fontSize: 11 }}>
          X:{fmt(actor.scale.x)} Y:{fmt(actor.scale.y)} Z:{fmt(actor.scale.z)}
        </span>
      </div>
    </div>
  )
}

function ActorComponentsView({ actor }: { actor: Actor }) {
  const components = (actor as any).components as Component[] | undefined
  if (!components || components.length === 0) return null
  return (
    <div className="property-group">
      <div className="property-group-title">Components ({components.length})</div>
      {components.map((comp, i) => (
        <div key={i} className="property-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
          <span className="property-label" style={{ fontWeight: 600 }}>{comp.name || comp.constructor.name}</span>
          <span className="property-value" style={{ fontSize: 10 }}>Enabled: {comp.bEnabled ? '✓' : '✗'}</span>
        </div>
      ))}
    </div>
  )
}

function BlueprintRefView({ actor }: { actor: Actor }) {
  const ref = actor.blueprintRef
  if (!ref) return null
  const overrideKeys = ref.overrides ? Object.keys(ref.overrides) : []
  return (
    <div className="property-group">
      <div className="property-group-title">Blueprint</div>
      <div className="property-row">
        <span className="property-label">ID</span>
        <span className="property-value" style={{ fontSize: 11 }}>{ref.id}</span>
      </div>
      <div className="property-row">
        <span className="property-label">Overrides</span>
        <span className="property-value" style={{ fontSize: 11 }}>
          {overrideKeys.length > 0 ? overrideKeys.join(', ') : '（无）'}
        </span>
      </div>
    </div>
  )
}

// ─── 只读键值展示（替代蓝图编辑中的 KVEditor）───
function ReadOnlyKV({ data }: { data: Record<string, unknown> | undefined }) {
  const entries = Object.entries(data ?? {})
  if (entries.length === 0) {
    return <div style={{ fontSize: 11, color: 'var(--text-dim)', padding: '2px 0' }}>（空）</div>
  }
  return (
    <>
      {entries.map(([k, v]) => (
        <div key={k} className="property-row" style={{ gap: 4, padding: '2px 0' }}>
          <span style={{ flex: '0 0 80px', fontSize: 11, color: 'var(--text-dim)' }}>{k}</span>
          <span style={{ flex: 1, fontSize: 11, color: 'var(--success)', fontFamily: 'var(--font-mono)' }}>
            {displayValue(v)}
          </span>
        </div>
      ))}
    </>
  )
}

// ─── 通用键值编辑器（用于组件 props / 子物体 overrides / CDO defaults）───
// 所有编辑都通过 BlueprintEditorService 落盘，不直接改 JSON。

const kvKeyStyle: React.CSSProperties = {
  flex: '0 0 80px', background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
  border: '1px solid var(--border)', borderRadius: 3, padding: '2px 5px', fontSize: 11, outline: 'none',
}
const kvValStyle: React.CSSProperties = {
  flex: 1, background: 'var(--bg-tertiary)', color: 'var(--success)',
  border: '1px solid var(--border)', borderRadius: 3, padding: '2px 5px', fontSize: 11,
  fontFamily: 'var(--font-mono)', outline: 'none', minWidth: 0,
}
const kvBtnStyle: React.CSSProperties = {
  flex: '0 0 auto', padding: '0 6px', fontSize: 13, lineHeight: 1, cursor: 'pointer',
  color: 'var(--text-dim)', background: 'transparent', border: '1px solid var(--border)', borderRadius: 3,
}

/** 宽松解析：先按 JSON 解析，失败则按原始字符串保留 */
function lenientParse(v: string): unknown {
  const s = v.trim()
  if (s === '') return ''
  try { return JSON.parse(s) } catch { return s }
}

/** 展示值：字符串原样（不加引号），其余 JSON 序列化 */
function displayValue(v: unknown): string {
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

function KVEditor({
  initial,
  onSave,
  disabled,
  saveLabel = '保存',
}: {
  initial: Record<string, unknown> | undefined
  onSave: (patch: Record<string, unknown>) => Promise<void>
  disabled?: boolean
  saveLabel?: string
}) {
  const sig = JSON.stringify(initial ?? {})
  const [rows, setRows] = useState<{ key: string; val: string }[]>([])
  const [nk, setNk] = useState('')
  const [nv, setNv] = useState('')

  // 外部数据变化时（编辑落盘后刷新）重置编辑缓冲
  useEffect(() => {
    setRows(Object.entries(initial ?? {}).map(([k, v]) => ({ key: k, val: displayValue(v) })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])

  const updateRow = (i: number, patch: Partial<{ key: string; val: string }>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i))
  const addRow = () => {
    if (!nk) return
    setRows((rs) => [...rs, { key: nk, val: nv }])
    setNk('')
    setNv('')
  }

  const save = async () => {
    const patch: Record<string, unknown> = {}
    for (const r of rows) {
      if (!r.key) continue
      patch[r.key] = lenientParse(r.val)
    }
    // 被删除的原有键 → null（配合深合并实现精确替换）
    for (const k of Object.keys(initial ?? {})) {
      if (!rows.some((r) => r.key === k)) patch[k] = null
    }
    await onSave(patch)
  }

  return (
    <>
      {rows.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', padding: '2px 0' }}>（空）</div>
      )}
      {rows.map((r, i) => (
        <div key={i} className="property-row" style={{ gap: 4, padding: '2px 0' }}>
          <input value={r.key} onChange={(e) => updateRow(i, { key: e.target.value })} style={kvKeyStyle} />
          <input value={r.val} onChange={(e) => updateRow(i, { val: e.target.value })} style={kvValStyle} />
          <button title="删除该键" disabled={disabled} onClick={() => removeRow(i)} style={kvBtnStyle}>×</button>
        </div>
      ))}
      <div className="property-row" style={{ gap: 4, padding: '2px 0', marginTop: 2 }}>
        <input placeholder="新键" value={nk} onChange={(e) => setNk(e.target.value)} style={kvKeyStyle} />
        <input placeholder='值（数字/布尔/对象用 JSON）' value={nv} onChange={(e) => setNv(e.target.value)} style={kvValStyle} />
        <button title="添加键" disabled={disabled} onClick={addRow} style={kvBtnStyle}>+</button>
      </div>
      <div style={{ marginTop: 6 }}>
        <button className="btn btn-primary" disabled={disabled} onClick={save} style={{ padding: '3px 12px', fontSize: 11 }}>
          {saveLabel}
        </button>
      </div>
    </>
  )
}

// ─── 蓝图编辑器选中组件详情（只读）───
function BlueprintComponentDetail({ data, selection }: { data: NonNullable<BlueprintSelection['compData']>; selection: BlueprintSelection }) {
  return (
    <>
      <div className="property-group">
        <div className="property-group-title">Component — {data.name || data.baseClass}</div>
        <div className="property-row">
          <span className="property-label">baseClass</span>
          <span className="property-value" style={{ fontSize: 11, color: 'var(--accent)' }}>{data.baseClass}</span>
        </div>
        {data.id !== undefined && (
          <div className="property-row">
            <span className="property-label">ID</span>
            <span className="property-value" style={{ fontSize: 11 }}>#{data.id}</span>
          </div>
        )}
        {data.name && (
          <div className="property-row">
            <span className="property-label">Name</span>
            <span className="property-value" style={{ fontSize: 11 }}>{data.name}</span>
          </div>
        )}
        <div className="property-row">
          <span className="property-label">Index</span>
          <span className="property-value" style={{ fontSize: 11 }}>#{selection.index}</span>
        </div>
        {data._remove && (
          <div className="property-row">
            <span className="property-label">Status</span>
            <span className="property-value" style={{ color: 'var(--error)' }}>Removed (inherited)</span>
          </div>
        )}
      </div>
      <div className="property-group">
        <div className="property-group-title">Properties（只读）</div>
        <ReadOnlyKV data={data.properties} />
      </div>
    </>
  )
}

// ─── 蓝图编辑器选中子 Actor 详情（只读）───
function BlueprintChildDetail({ data, selection }: { data: NonNullable<BlueprintSelection['childData']>; selection: BlueprintSelection }) {
  return (
    <>
      <div className="property-group">
        <div className="property-group-title">Child Actor — {selection.label}</div>
        {data.name && (
          <div className="property-row">
            <span className="property-label">Name</span>
            <span className="property-value" style={{ fontSize: 11, fontWeight: 600 }}>{data.name}</span>
          </div>
        )}
        {data.blueprint && (
          <div className="property-row">
            <span className="property-label">Blueprint</span>
            <span className="property-value" style={{ fontSize: 11, color: 'var(--info)' }}>🧩 {data.blueprint}</span>
          </div>
        )}
        {!data.blueprint && data.baseClass && (
          <div className="property-row">
            <span className="property-label">baseClass</span>
            <span className="property-value" style={{ fontSize: 11, color: 'var(--warning)' }}>⚙️ {data.baseClass}</span>
          </div>
        )}
        {data.id !== undefined && (
          <div className="property-row">
            <span className="property-label">ID</span>
            <span className="property-value" style={{ fontSize: 11 }}>#{data.id}</span>
          </div>
        )}
        <div className="property-row">
          <span className="property-label">Index</span>
          <span className="property-value" style={{ fontSize: 11 }}>#{selection.index}</span>
        </div>
        {data._remove && (
          <div className="property-row">
            <span className="property-label">Status</span>
            <span className="property-value" style={{ color: 'var(--error)' }}>Removed (inherited)</span>
          </div>
        )}
      </div>
      <div className="property-group">
        <div className="property-group-title">Overrides（只读）</div>
        <ReadOnlyKV data={data.overrides} />
      </div>
    </>
  )
}

// ─── 蓝图根：Transform + Components + Children 总览（未选中任何元素时）───
function BlueprintOverviewDetail({ assetPath }: { assetPath: string }) {
  const [busy, setBusy] = useState(false)
  const [asset, setAsset] = useState<BlueprintAsset | null>(null)
  const nonce = useEditorStore((s) => s.blueprintEditNonce)

  useEffect(() => {
    const read = window.electronAPI?.readJsonFile
    if (!read) return
    let cancelled = false
    read(assetPath).then((r) => {
      if (!cancelled && r.success && r.data) setAsset(r.data as BlueprintAsset)
    })
    return () => { cancelled = true }
  }, [assetPath, nonce])

  if (!asset) {
    return <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>加载蓝图…</div>
  }

  const p = asset.position ?? [0, 0, 0]
  const r = asset.rotation ?? [0, 0, 0]
  const s = asset.scale ?? [1, 1, 1]
  const compCount = asset.components?.length ?? 0
  const childCount = asset.children?.length ?? 0

  return (
    <>
      <div className="property-group">
        <div className="property-group-title">{asset.id} · Class</div>
        <div className="property-row">
          <span className="property-label">baseClass</span>
          <span className="property-value" style={{ fontSize: 11, color: 'var(--success)' }}>{asset.baseClass}</span>
        </div>
        {asset.parent && (
          <div className="property-row">
            <span className="property-label">Parent</span>
            <span className="property-value" style={{ fontSize: 11, color: 'var(--accent)' }}>extends {asset.parent}</span>
          </div>
        )}
      </div>

      <div className="property-group">
        <div className="property-group-title">Transform</div>
        <div className="property-row">
          <span className="property-label">Position</span>
          <span className="property-value" style={{ fontSize: 11 }}>
            <input type="number" step="0.01" defaultValue={p[0]} style={{ width: 50, ...kvValStyle }}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) p[0] = v }}
              onBlur={() => { if (busy) return; setBusy(true); BlueprintEditorService.apply(assetPath, 'setPosition', { position: [p[0], p[1], p[2]] }).finally(() => setBusy(false)) }} />
            <input type="number" step="0.01" defaultValue={p[1]} style={{ width: 50, ...kvValStyle }}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) p[1] = v }}
              onBlur={() => { if (busy) return; setBusy(true); BlueprintEditorService.apply(assetPath, 'setPosition', { position: [p[0], p[1], p[2]] }).finally(() => setBusy(false)) }} />
            <input type="number" step="0.01" defaultValue={p[2]} style={{ width: 50, ...kvValStyle }}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) p[2] = v }}
              onBlur={() => { if (busy) return; setBusy(true); BlueprintEditorService.apply(assetPath, 'setPosition', { position: [p[0], p[1], p[2]] }).finally(() => setBusy(false)) }} />
          </span>
        </div>
        <div className="property-row">
          <span className="property-label">Rotation</span>
          <span className="property-value" style={{ fontSize: 11 }}>
            <input type="number" step="0.01" defaultValue={r[0]} style={{ width: 50, ...kvValStyle }}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) r[0] = v }}
              onBlur={() => { if (busy) return; setBusy(true); BlueprintEditorService.apply(assetPath, 'setRotation', { rotation: [r[0], r[1], r[2]] }).finally(() => setBusy(false)) }} />
            <input type="number" step="0.01" defaultValue={r[1]} style={{ width: 50, ...kvValStyle }}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) r[1] = v }}
              onBlur={() => { if (busy) return; setBusy(true); BlueprintEditorService.apply(assetPath, 'setRotation', { rotation: [r[0], r[1], r[2]] }).finally(() => setBusy(false)) }} />
            <input type="number" step="0.01" defaultValue={r[2]} style={{ width: 50, ...kvValStyle }}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) r[2] = v }}
              onBlur={() => { if (busy) return; setBusy(true); BlueprintEditorService.apply(assetPath, 'setRotation', { rotation: [r[0], r[1], r[2]] }).finally(() => setBusy(false)) }} />
          </span>
        </div>
        <div className="property-row">
          <span className="property-label">Scale</span>
          <span className="property-value" style={{ fontSize: 11 }}>
            <input type="number" step="0.01" defaultValue={s[0]} style={{ width: 50, ...kvValStyle }}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) s[0] = v }}
              onBlur={() => { if (busy) return; setBusy(true); BlueprintEditorService.apply(assetPath, 'setScale', { scale: [s[0], s[1], s[2]] }).finally(() => setBusy(false)) }} />
            <input type="number" step="0.01" defaultValue={s[1]} style={{ width: 50, ...kvValStyle }}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) s[1] = v }}
              onBlur={() => { if (busy) return; setBusy(true); BlueprintEditorService.apply(assetPath, 'setScale', { scale: [s[0], s[1], s[2]] }).finally(() => setBusy(false)) }} />
            <input type="number" step="0.01" defaultValue={s[2]} style={{ width: 50, ...kvValStyle }}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) s[2] = v }}
              onBlur={() => { if (busy) return; setBusy(true); BlueprintEditorService.apply(assetPath, 'setScale', { scale: [s[0], s[1], s[2]] }).finally(() => setBusy(false)) }} />
          </span>
        </div>
      </div>

      <div className="property-group">
        <div className="property-group-title">Components（{compCount}）</div>
        {(asset.components ?? []).map((comp, i) => (
          <div key={i} className="property-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            <span className="property-label" style={{ fontWeight: 600 }}>{comp.name || comp.baseClass}</span>
            {comp._remove && <span className="property-value" style={{ fontSize: 10, color: 'var(--error)' }}>Removed</span>}
          </div>
        ))}
      </div>

      <div className="property-group">
        <div className="property-group-title">Children（{childCount}）</div>
        {(asset.children ?? []).map((ch, i) => (
          <div key={i} className="property-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            <span className="property-label" style={{ fontWeight: 600 }}>{ch.name || `#${i}`}</span>
            <span className="property-value" style={{ fontSize: 10 }}>
              {ch.id !== undefined ? `#${ch.id} ` : ''}{ch.blueprint ? `🧩 bp:${ch.blueprint}` : ch.baseClass ? `⚙️ ${ch.baseClass}` : ''}
              {ch._remove ? ' · Removed' : ''}
            </span>
          </div>
        ))}
      </div>
    </>
  )
}

// ─── 蓝图编辑器基本选中信息 ───
function BlueprintGeneralInfo({ selection }: { selection: BlueprintSelection }) {
  return (
    <div className="property-group">
      <div className="property-group-title">Blueprint Element</div>
      <div className="property-row">
        <span className="property-label">Type</span>
        <span className="property-value" style={{ fontSize: 11 }}>{selection.type}</span>
      </div>
      <div className="property-row">
        <span className="property-label">Label</span>
        <span className="property-value" style={{ fontSize: 11 }}>{selection.label}</span>
      </div>
    </div>
  )
}

function Object3DInfoView({ obj }: { obj: THREE.Object3D }) {
  const actorRef = (obj as any).userData?.actorRef as Actor | undefined
  return (
    <>
      <div className="property-group">
        <div className="property-group-title">{obj.name || obj.type}</div>
        <div className="property-row">
          <span className="property-label">Type</span>
          <span className="property-value" style={{ fontSize: 11 }}>{obj.type}</span>
        </div>
        {obj.parent && (
          <div className="property-row">
            <span className="property-label">Parent</span>
            <span className="property-value" style={{ fontSize: 11 }}>{obj.parent.name || obj.parent.type}</span>
          </div>
        )}
        <div className="property-row">
          <span className="property-label">Children</span>
          <span className="property-value" style={{ fontSize: 11 }}>{obj.children.length}</span>
        </div>
        {actorRef && (
          <div className="property-row">
            <span className="property-label">Actor</span>
            <span className="property-value" style={{ fontSize: 11 }}>{actorRef.constructor.name} (Active: {actorRef.bHasBegunPlay ? '✓' : '✗'})</span>
          </div>
        )}
      </div>
      <div className="property-group">
        <div className="property-group-title">Transform</div>
        <div className="property-row">
          <span className="property-label">Position</span>
          <span className="property-value" style={{ fontSize: 11 }}>
            X:{fmt(obj.position.x)} Y:{fmt(obj.position.y)} Z:{fmt(obj.position.z)}
          </span>
        </div>
        <div className="property-row">
          <span className="property-label">Rotation</span>
          <span className="property-value" style={{ fontSize: 11 }}>
            X:{fmt(obj.rotation.x)} Y:{fmt(obj.rotation.y)} Z:{fmt(obj.rotation.z)}
          </span>
        </div>
        <div className="property-row">
          <span className="property-label">Scale</span>
          <span className="property-value" style={{ fontSize: 11 }}>
            X:{fmt(obj.scale.x)} Y:{fmt(obj.scale.y)} Z:{fmt(obj.scale.z)}
          </span>
        </div>
      </div>
    </>
  )
}

// ─── 主 Inspector 组件 ───
export function Inspector() {
  const [selectionKey, setSelectionKey] = useState(getSelectionKey())
  const selected = getSelected()
  const selectedActor = getSelectedActor()
  const blueprintSelection = useEditorStore((s) => s.blueprintSelection)
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const isBlueprintTab = activeTabId.startsWith('bp:')
  // 蓝图被编辑后刷新当前选中元素的数据，避免显示陈旧快照
  const blueprintEditNonce = useEditorStore((s) => s.blueprintEditNonce)

  useEffect(() => {
    const unsub = onSelectionChange(() => setSelectionKey(getSelectionKey()))
    return unsub
  }, [])

  useEffect(() => {
    if (!blueprintEditNonce) return
    const cur = useEditorStore.getState().blueprintSelection
    if (!cur) return
    const read = window.electronAPI?.readJsonFile
    if (!read) return
    let cancelled = false
    read(cur.assetPath).then((r) => {
      if (cancelled || !r.success || !r.data) return
      const asset = r.data as BlueprintAsset
      if (cur.type === 'component') {
        const comp = (asset.components ?? []).find((c, i) => c.baseClass === cur.compType || i === cur.index)
        if (comp) useEditorStore.getState().setBlueprintSelection({ ...cur, compData: comp })
      } else if (cur.type === 'child') {
        const name = cur.childData?.name
        const child = (asset.children ?? []).find((c, i) => (name ? c.name === name : i === cur.index))
        if (child) useEditorStore.getState().setBlueprintSelection({ ...cur, childData: child })
      }
    })
    return () => { cancelled = true }
  }, [blueprintEditNonce])

  const isActor = selected instanceof Actor || (selected instanceof THREE.Object3D && !!(selected as any).userData?.actorRef)
  const actorTarget = selectedActor || (isActor && selected instanceof Actor ? selected : null) as Actor | null

  return (
    <div className="panel">
      <div className="panel-header">
        <span>Inspector</span>
        {blueprintSelection && isBlueprintTab ? (
          <button
            className="btn"
            style={{ marginLeft: 'auto', fontSize: 10, padding: '1px 6px' }}
            onClick={() => useEditorStore.getState().setBlueprintSelection(null)}
          >
            ✕
          </button>
        ) : selected ? (
          <button
            className="btn"
            style={{ marginLeft: 'auto', fontSize: 10, padding: '1px 6px' }}
            onClick={() => select(null)}
          >
            ✕
          </button>
        ) : null}
      </div>
      <div className="panel-body">
        {blueprintSelection && isBlueprintTab ? (
          blueprintSelection.type === 'component' && blueprintSelection.compData ? (
            <BlueprintComponentDetail data={blueprintSelection.compData} selection={blueprintSelection} />
          ) : blueprintSelection.type === 'child' && blueprintSelection.childData ? (
            <BlueprintChildDetail data={blueprintSelection.childData} selection={blueprintSelection} />
          ) : (
            <BlueprintGeneralInfo selection={blueprintSelection} />
          )
        ) : isBlueprintTab && activeTabId.length > 3 ? (
          <BlueprintOverviewDetail assetPath={activeTabId.slice(3)} />
        ) : selected ? (
          isActor && actorTarget ? (
            <>
              <div className="property-group">
                <div className="property-group-title">{actorTarget.name}</div>
                <div className="property-row">
                  <span className="property-label">Type</span>
                  <span className="property-value" style={{ fontSize: 11 }}>{actorTarget.constructor.name}</span>
                </div>
                <div className="property-row">
                  <span className="property-label">Active</span>
                  <span className="property-value">{actorTarget.bHasBegunPlay ? '✓' : '✗'}</span>
                </div>
              </div>
              <BlueprintRefView actor={actorTarget} />
              <ActorTransformView actor={actorTarget} />
              <ActorComponentsView actor={actorTarget} />
            </>
          ) : selected instanceof THREE.Object3D ? (
            <Object3DInfoView obj={selected} />
          ) : null
        ) : (
          <ProjectInfoView />
        )}
      </div>
    </div>
  )
}

// ─── 项目信息面板 ───
function ProjectInfoView() {
  const { currentProject, gameState } = useEditorStore()
  const slots = useSaveStore((s) => s.slots)
  const saveGame = useSaveStore((s) => s.saveGame)
  const loadGame = useSaveStore((s) => s.loadGame)
  const deleteSave = useSaveStore((s) => s.deleteSave)
  const refreshSlots = useSaveStore((s) => s.refreshSlots)

  useEffect(() => {
    if (currentProject) refreshSlots(currentProject.name)
  }, [currentProject, gameState.running, refreshSlots])

  return (
    <>
      <div className="property-group">
        <div className="property-group-title">Project</div>
        <div className="property-row">
          <span className="property-label">Name</span>
          <span className="property-value">{currentProject?.name}</span>
        </div>
        <div className="property-row">
          <span className="property-label">Version</span>
          <span className="property-value">{currentProject?.version}</span>
        </div>
        <div className="property-row">
          <span className="property-label">Description</span>
          <span className="property-value" style={{ fontSize: 11 }}>{currentProject?.description}</span>
        </div>
      </div>

      <div className="property-group">
        <div className="property-group-title">Game State</div>
        <div className="property-row">
          <span className="property-label">Status</span>
          <span className="property-value">
            <span style={{
              display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
              background: gameState.running ? 'var(--success)' : 'var(--text-dim)', marginRight: 6,
            }} />
            {gameState.running ? 'Running' : 'Stopped'}
          </span>
        </div>
        {gameState.running && (
          <>
            <div className="property-row">
              <span className="property-label">Score</span>
              <span className="property-value">{gameState.score}</span>
            </div>
            <div className="property-row">
              <span className="property-label">Game Over</span>
              <span className="property-value">{gameState.gameOver ? 'Yes' : 'No'}</span>
            </div>
          </>
        )}
      </div>

      <div className="property-group">
        <div className="property-group-title">Save Game</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
          <button className="btn" disabled={!gameState.running} onClick={() => saveGame('quick')}>
            💾 Quick Save (F6)
          </button>
          <button className="btn" disabled={slots.length === 0} onClick={() => loadGame('quick')}>
            📂 Quick Load (F9)
          </button>
        </div>
        {slots.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 11 }}>
            <div style={{ color: 'var(--text-dim)', marginBottom: 4 }}>存档槽 ({slots.length})</div>
            {slots.map((s) => (
              <div key={s.slot} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                <button className="btn" style={{ flex: 1, padding: '2px 6px', fontSize: 11, textAlign: 'left' }}
                  onClick={() => loadGame(s.slot)} title={`恢复 ${s.slot}`}>
                  {s.slot} · {formatSaveTime(s.meta.savedAt)} · {s.meta.score}分
                </button>
                <button className="btn" style={{ padding: '2px 6px', fontSize: 11, color: '#ff8888' }}
                  onClick={() => currentProject && deleteSave(currentProject!.name, s.slot)} title="删除">✕</button>
              </div>
            ))}
          </div>
        )}      </div>
    </>
  )
}
