import React, { useEffect, useMemo, useState } from 'react'
import {
  getSelectedActor, selectActor, select, getSelectionKey, onSelectionChange,
  setSharedScene, getSharedScene, getSceneTree, focusOn,
} from '../editor/SelectionManager'
import type { SceneTreeNode } from '../editor/SelectionManager'
import { useEditorStore } from '../stores/editorStore'
import { BlueprintPreviewManager } from '../editor/BlueprintPreviewManager'

/** 子 Actor 节点（递归） */
interface BlueprintChildNode {
  blueprint?: string
  actor?: string
  name?: string
  overrides?: Record<string, unknown>
  objects?: Array<Record<string, unknown>>
  children?: BlueprintChildNode[]
  _remove?: boolean
}

/** 蓝图资产数据结构（与 BlueprintEditor 中的 BlueprintData 一致） */
interface BlueprintOutlineData {
  id: string
  baseClass: string
  parent?: string
  scene?: string
  objects?: Array<Record<string, unknown>>
  components?: Array<{ type: string; props?: Record<string, unknown>; _remove?: boolean }>
  children?: BlueprintChildNode[]
  defaults?: Record<string, unknown>
}

/** 递归渲染子节点树 */
function ChildNodeView({ children, depth, selName }: { children?: BlueprintChildNode[]; depth: number; selName: string | null }) {
  if (!children || children.length === 0) return null
  return (
    <>
      {children.map((child, i) => {
        const label = child.name ?? child.blueprint ?? child.actor ?? `Child #${i}`
        const hasNested = (child.children && child.children.length > 0) || (child.objects && child.objects.length > 0)
        const subLabel = child.objects ? ` (${child.objects.length} meshes)` : ''
        const focusName = child.name || child.blueprint || child.actor || ''
        const isSelected = selName === focusName && !!focusName

        if (!hasNested) {
          return (
            <div key={i} style={{
              padding: `2px 4px 2px ${16 + depth * 12}px`,
              color: 'var(--text-primary)', fontSize: 11, cursor: 'pointer',
              background: isSelected ? 'var(--accent)' : 'transparent',
            }}
              onClick={() => BlueprintPreviewManager.getActiveInstance()?.focusOnActor(focusName)}
              onDoubleClick={() => BlueprintPreviewManager.getActiveInstance()?.focusOnActor(focusName)}
            >
              <span style={{ color: isSelected ? '#fff' : undefined }}>
              {child.blueprint ? (
                <span>{child.blueprint}</span>
              ) : child.actor ? (
                <span style={{ color: isSelected ? '#fff' : 'var(--warning)' }}>{child.actor}</span>
              ) : (
                <span>{label}{subLabel}</span>
              )}
              </span>
              {child._remove && <span style={{ color: 'var(--error)', fontSize: 10, marginLeft: 4 }}>removed</span>}
            </div>
          )
        }

        return (
          <CollapsibleNode key={i} label={`${label}${subLabel}`} depth={depth} focusName={focusName} isSelected={isSelected}>
            {child.objects && child.objects.map((obj: any, j: number) => (
              <div key={j} style={{
                padding: `2px 4px 2px ${32 + depth * 12}px`,
                fontSize: 10, color: 'var(--text-dim)', cursor: 'pointer',
              }}
                onClick={() => BlueprintPreviewManager.getActiveInstance()?.focusOnActor(focusName)}
              >
                {obj.type} {obj.name ? `"${obj.name}"` : `#${j}`}
              </div>
            ))}
            <ChildNodeView children={child.children} depth={depth + 1} selName={selName} />
          </CollapsibleNode>
        )
      })}
    </>
  )
}

/** 折叠节点 */
function CollapsibleNode({ label, depth, focusName, isSelected, children }: { label: string; depth: number; focusName?: string; isSelected?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)

  const doFocus = () => {
    if (focusName) BlueprintPreviewManager.getActiveInstance()?.focusOnActor(focusName)
  }

  return (
    <div>
      <div
        style={{
          padding: `2px 4px 2px ${12 + depth * 12}px`,
          display: 'flex', alignItems: 'center', gap: 4,
          fontWeight: 500, fontSize: 11, userSelect: 'none',
          background: isSelected ? 'var(--accent)' : 'transparent',
        }}
      >
        <span
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
          style={{ cursor: 'pointer', color: 'var(--text-dim)', fontSize: 10, flexShrink: 0 }}
        >
          {open ? '▼' : '▶'}
        </span>
        <span
          onClick={doFocus}
          onDoubleClick={doFocus}
          style={{ cursor: 'pointer', color: isSelected ? '#fff' : 'var(--text-secondary)', flex: 1 }}
        >
          {label}
        </span>
      </div>
      {open && children}
    </div>
  )
}

/** 蓝图树渲染组件（可折叠文件夹结构） */
function BlueprintTreeView({ data, selName }: { data: BlueprintOutlineData; selName: string | null }) {
  const hasChildren = (data.children ?? []).length > 0
  const hasObjects = (data.objects ?? []).length > 0
  const isRootSelected = selName === data.id

  return (
    <div style={{ fontSize: 11, fontFamily: 'monospace', padding: '8px 4px' }}>
      {/* 根节点 */}
      <div
        style={{
          padding: '3px 6px', fontWeight: 600, cursor: 'pointer',
          color: isRootSelected ? '#fff' : 'var(--text-primary)',
          background: isRootSelected ? 'var(--accent)' : 'transparent',
        }}
        onClick={() => BlueprintPreviewManager.getActiveInstance()?.focusOnActor(data.id)}
        onDoubleClick={() => BlueprintPreviewManager.getActiveInstance()?.focusOnActor(data.id)}
      >
        {data.id} <span style={{ fontWeight: 400, color: 'var(--text-dim)', fontSize: 10 }}>[{data.baseClass}]</span>
      </div>

      {/* 根级 objects */}
      {hasObjects && (
        <div style={{ padding: '2px 4px 2px 12px', fontSize: 10, color: 'var(--text-dim)' }}>
          {data.objects!.length} 个网格
        </div>
      )}

      {/* 递归子 Actor 树 */}
      <ChildNodeView children={data.children} depth={0} selName={selName} />

      {/* 空状态 */}
      {!hasObjects && !hasChildren && (
        <div style={{ padding: '2px 4px 2px 24px', color: 'var(--text-dim)' }}>（空）</div>
      )}
    </div>
  )
}

export function Outline() {
  const [selectionKey, setSelectionKey] = useState(getSelectionKey())
  const selected = getSelectedActor()
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const dynamicTabs = useEditorStore((s) => s.dynamicTabs)
  const [bpData, setBpData] = useState<BlueprintOutlineData | null>(null)
  const [bpLoading, setBpLoading] = useState(false)

  // 判断当前是否为蓝图标签
  const isBlueprintTab = activeTabId.startsWith('bp:')
  const currentBpTab = useMemo(
    () => dynamicTabs.find((t) => t.id === activeTabId),
    [dynamicTabs, activeTabId],
  )

  // 蓝图标签：读取蓝图 JSON 展示树形结构
  useEffect(() => {
    if (!isBlueprintTab || !currentBpTab?.assetPath) {
      setBpData(null)
      setBpLoading(false)
      return
    }
    const read = window.electronAPI?.readJsonFile
    if (!read) return
    let cancelled = false
    setBpLoading(true)
    read(currentBpTab.assetPath).then((r) => {
      if (cancelled) return
      if (r.success && r.data) {
        setBpData(r.data as BlueprintOutlineData)
      }
      setBpLoading(false)
    })
    return () => { cancelled = true }
  }, [isBlueprintTab, currentBpTab?.assetPath])

  // 订阅选中/场景变化
  useEffect(() => {
    const unsub = onSelectionChange(() => {
      setSelectionKey(getSelectionKey())
    })
    return unsub
  }, [])

  // 从共享场景获取完整对象树（不管游戏是否启动）
  const tree = getSceneTree()

  // 蓝图树选中名称（优先 blueprintRef.id，其次 Actor.name）
  const selName = selected?.blueprintRef?.id ?? selected?.name ?? null

  // 过滤掉无意义的内置对象
  const visibleTree = tree.filter(n =>
    n.name !== '' && !n.name.startsWith('__')
  )

  return (
    <div className="panel-body" style={{ padding: 0 }}>
      {isBlueprintTab ? (
        /* 蓝图标签：显示蓝图资产树形结构 */
        bpLoading ? (
          <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 12, textAlign: 'center' }}>
            蓝图加载中...
          </div>
        ) : bpData ? (
          <BlueprintTreeView data={bpData} selName={selName} />
        ) : (
          <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 12, textAlign: 'center' }}>
            无蓝图数据
          </div>
        )
      ) : !getSharedScene() ? (
        <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 12, textAlign: 'center' }}>
          场景初始化中...
        </div>
      ) : visibleTree.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 12, textAlign: 'center' }}>
          场景中暂无对象
        </div>
      ) : (
        <div style={{ fontSize: 11, fontFamily: 'monospace' }}>
          {visibleTree.map((node, i) => {
            const isSelected = selected === (node.actor || node.object)
            const isBlueprint = !!node.actor?.blueprintRef
            const icon = node.isActor ? '◆ ' : '◈ '
            return (
              <div
                key={node.object.id + '-' + i}
                style={{
                  padding: '2px 4px',
                  paddingLeft: 8 + node.depth * 14,
                  cursor: 'pointer',
                  background: isSelected ? 'var(--accent)' : 'transparent',
                  color: isSelected ? '#fff' : 'var(--text-primary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                onClick={() => select(isSelected ? null : (node.actor || node.object))}
                onDoubleClick={() => node.object && focusOn(node.object)}
                onMouseEnter={(e) => {
                  if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'
                }}
              >
                {icon}{node.name}
                {isBlueprint && (
                  <span style={{ color: 'var(--accent)', marginLeft: 4, fontSize: 10 }}>[BP]</span>
                )}
                {node.isActor && (
                  <span style={{ color: 'var(--text-dim)', marginLeft: 4, fontSize: 10 }}>
                    [{node.actor!.constructor.name}]
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
