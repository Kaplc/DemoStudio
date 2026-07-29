import React, { useEffect, useMemo, useState } from 'react'
import {
  getSelectedActor, select, getSelectionKey, onSelectionChange,
  getSharedScene, getSceneTree, focusOn,
} from '../editor/SelectionManager'
import { useEditorStore } from '../stores/editorStore'
import { AssetPreviewManager } from '../editor/AssetPreviewManager'
import type { SceneTreeNode } from '../editor/SelectionManager'
import type { Actor } from '../engine'

/** Actor 树节点渲染项（蓝图 / 场景预览共用） */
function renderActorTreeNodes(
  tree: SceneTreeNode[],
  selected: Actor | null,
  assetPath: string | null,
  kind: 'blueprint' | 'scenePreview',
): React.ReactElement[] {
  return tree.map((node, i) => {
    const isSelected = selected === node.actor
    const key = node.actor ? node.actor.root.id : `${kind}-node-${i}`
    return (
      <div
        key={key}
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
        onClick={() => {
          if (!node.actor || !assetPath) return
          if (kind === 'blueprint') {
            const mgr = AssetPreviewManager.get<import('../editor/BlueprintPreviewManager').BlueprintPreviewManager>(assetPath)
            if (isSelected) mgr?.selectActor(null)
            else mgr?.focusActor(node.actor)
          } else {
            const mgr = AssetPreviewManager.get<import('../editor/ScenePreviewManager').ScenePreviewManager>(assetPath)
            if (isSelected) mgr?.selectActor(null)
            else mgr?.focusActor(node.actor)
          }
        }}
        onDoubleClick={() => {
          if (!node.actor || !assetPath) return
          if (kind === 'blueprint') {
            AssetPreviewManager.get<import('../editor/BlueprintPreviewManager').BlueprintPreviewManager>(assetPath)?.focusActor(node.actor)
          } else {
            AssetPreviewManager.get<import('../editor/ScenePreviewManager').ScenePreviewManager>(assetPath)?.focusActor(node.actor)
          }
        }}
        onMouseEnter={(e) => {
          if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'
        }}
        onMouseLeave={(e) => {
          if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'
        }}
      >
        {node.name}
        {node.actor && (
          <span style={{ color: 'var(--text-dim)', marginLeft: 4, fontSize: 10 }}>
            [{node.actor.constructor.name}]
          </span>
        )}
      </div>
    )
  })
}

export function Outline() {
  const [selectionKey, setSelectionKey] = useState(getSelectionKey())
  const selected = getSelectedActor()
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const dynamicTabs = useEditorStore((s) => s.dynamicTabs)
  const blueprintEditNonce = useEditorStore((s) => s.blueprintEditNonce)

  const isBlueprintTab = activeTabId.startsWith('bp:')
  const isScenePreviewTab = activeTabId.startsWith('sp:')
  const currentTab = useMemo(
    () => dynamicTabs.find((t) => t.id === activeTabId),
    [dynamicTabs, activeTabId],
  )

  // 订阅选中/场景变化
  useEffect(() => {
    const unsub = onSelectionChange(() => {
      setSelectionKey(getSelectionKey())
    })
    return unsub
  }, [])

  // ─── 缓存：场景树数据（Scene/Game 页签） ───
  const tree = useMemo(() => {
    if (isBlueprintTab || isScenePreviewTab) return []
    return getSceneTree()
  }, [selectionKey, isBlueprintTab, isScenePreviewTab])

  const visibleTree = useMemo(
    () => tree.filter(n => n.name !== '' && !n.name.startsWith('__')),
    [tree],
  )

  // ─── 缓存：蓝图树数据 ───
  const bpAssetPath = isBlueprintTab ? currentTab?.assetPath : null
  const bpTree = useMemo(() => {
    if (!bpAssetPath) return null
    const bpMgr = AssetPreviewManager.get<import('../editor/BlueprintPreviewManager').BlueprintPreviewManager>(bpAssetPath)
    if (!bpMgr || bpMgr.currentBlueprintId == null) return null
    return bpMgr.getActorTree()
  }, [bpAssetPath, selectionKey, blueprintEditNonce])

  // ─── 缓存：场景预览树数据 ───
  const spAssetPath = isScenePreviewTab ? currentTab?.assetPath : null
  const spTree = useMemo(() => {
    if (!spAssetPath) return null
    const spMgr = AssetPreviewManager.get<import('../editor/ScenePreviewManager').ScenePreviewManager>(spAssetPath)
    if (!spMgr || spMgr.currentScenePath == null) return null
    return spMgr.getActorTree()
  }, [spAssetPath, selectionKey, blueprintEditNonce])

  // ─── 缓存：蓝图树渲染元素 ───
  const bpTreeElements = useMemo(() => {
    if (!bpTree || bpTree.length === 0) return null
    return renderActorTreeNodes(bpTree, selected, bpAssetPath ?? null, 'blueprint')
  }, [bpTree, selected, bpAssetPath])

  // ─── 缓存：场景预览树渲染元素 ───
  const spTreeElements = useMemo(() => {
    if (!spTree || spTree.length === 0) return null
    return renderActorTreeNodes(spTree, selected, spAssetPath ?? null, 'scenePreview')
  }, [spTree, selected, spAssetPath])

  // ─── 缓存：Scene 树渲染元素 ───
  const sceneTreeElements = useMemo(() => {
    if (visibleTree.length === 0) return null
    return visibleTree.map((node, i) => {
      const isSelected = selected === node.actor
      const isBlueprint = !!node.actor?.blueprintRef
      return (
        <div
          key={node.actor ? node.actor.root.id : 'node-' + i}
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
          onClick={() => select(isSelected ? null : node.actor)}
          onDoubleClick={() => node.actor && focusOn(node.actor.root)}
          onMouseEnter={(e) => {
            if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'
          }}
          onMouseLeave={(e) => {
            if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'
          }}
        >
          {node.name}
          {isBlueprint && (
            <span style={{ color: 'var(--accent)', marginLeft: 4, fontSize: 10 }}>[BP]</span>
          )}
          {node.actor && (
            <span style={{ color: 'var(--text-dim)', marginLeft: 4, fontSize: 10 }}>
              [{node.actor.constructor.name}]
            </span>
          )}
        </div>
      )
    })
  }, [visibleTree, selected])

  return (
    <div className="panel-body" style={{ padding: 0 }}>
      {isScenePreviewTab ? (
        spTreeElements ?? (
          <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 12, textAlign: 'center' }}>无预览数据</div>
        )
      ) : isBlueprintTab ? (
        bpTreeElements ?? (
          <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 12, textAlign: 'center' }}>无预览数据</div>
        )
      ) : !getSharedScene() ? (
        <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 12, textAlign: 'center' }}>
          场景初始化中...
        </div>
      ) : sceneTreeElements ?? (
        <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 12, textAlign: 'center' }}>
          场景中暂无对象
        </div>
      )}
    </div>
  )
}
