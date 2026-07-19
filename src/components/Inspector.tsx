import React, { useEffect, useState } from 'react'
import * as THREE from 'three'
import { useEditorStore } from '../stores/editorStore'
import { useSaveStore } from '../stores/saveStore'
import { getSelected, getSelectedActor, select, getSelectionKey, onSelectionChange } from '../editor/SelectionManager'
import { Actor, Component } from '../engine'

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
  // 通过 Actor 的内部 components 列表获取（组件无公共 getter，用类型断言）
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
        )}
      </div>
    </>
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

export function Inspector() {
  const [selectionKey, setSelectionKey] = useState(getSelectionKey())
  const selected = getSelected()
  const selectedActor = getSelectedActor()

  useEffect(() => {
    const unsub = onSelectionChange(() => setSelectionKey(getSelectionKey()))
    return unsub
  }, [])

  // 判断选中对象是 Actor 还是普通 Object3D
  const isActor = selected instanceof Actor || (selected instanceof THREE.Object3D && !!(selected as any).userData?.actorRef)
  const actorTarget = selectedActor || (isActor && selected instanceof Actor ? selected : null) as Actor | null

  return (
    <div className="panel">
      <div className="panel-header">
        <span>Inspector</span>
        {selected && (
          <button
            className="btn"
            style={{ marginLeft: 'auto', fontSize: 10, padding: '1px 6px' }}
            onClick={() => select(null)}
          >
            ✕
          </button>
        )}
      </div>
      <div className="panel-body">
        {selected ? (
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
