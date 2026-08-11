import React, { useCallback, useMemo, useState } from 'react'
import {
  getSelectedActor, select, getSelectionKey, onSelectionChange, getRunningWorld,
} from '../editor/SelectionManager'
import { useEditorStore } from '../stores/editorStore'
import type { SceneTreeNode } from '../editor/SelectionManager'
import type { Actor } from '../engine'

/**
 * UiOutline — 运行中游戏的 UI 大纲（独立页签）
 *
 * 显示当前运行中游戏 world.ui（UI 独立场景）的 HUD / UI 树：
 *  - 数据源：Viewport 启动游戏时经 setRunningWorld 记录的运行中 World
 *  - 上半部分：HUD 根节点（HUD Actor → uiActor 树）
 *  - 运行中可点击选中节点（Inspector 查看组件），不聚焦摄像机、不可隐藏
 */
export function UiOutline() {
  const [selectionKey, setSelectionKey] = useState(getSelectionKey())
  /** 折叠的节点 key 集合（空 = 全部展开，默认） */
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set())
  const toggleCollapsed = useCallback((key: string) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  const selected = getSelectedActor()
  /** 游戏运行中（UI 树仅在运行时有数据） */
  const gameRunning = useEditorStore((s) => s.gameState.running)

  // 订阅选中变化（Actor 列表变化时 selectionKey 递增也会触发）
  React.useEffect(() => {
    const unsub = onSelectionChange(() => {
      setSelectionKey(getSelectionKey())
    })
    return unsub
  }, [])

  // ─── 缓存：运行中游戏的 HUD / UI 树 ───
  const runningUiTree = useMemo(() => {
    if (!gameRunning) return null
    const world = getRunningWorld()
    if (!world) return null
    const rows: SceneTreeNode[] = []
    const walk = (a: Actor, depth: number) => {
      // 资产名应用在 root.name（SpawnActorFromBlueprint 只改 root.name），
      // Actor.name 是构造默认名（如 'Actor'）—— 优先 root.name
      rows.push({ depth, name: a.root.name || a.name, actor: a })
      for (const child of a.getChildren()) walk(child, depth + 1)
    }
    // 只遍历顶层 UI Actor（无 parent）：getAllUIActors 包含已 attach 到 HUD 的 UI 根
    // （spawnUIActor 先入 _uiActors 再 attachTo），跳过有 parent 的避免同一棵树重复出现
    for (const a of world.ui.getAllUIActors()) {
      if (a.parent) continue
      walk(a, 0)
    }
    return rows
  }, [gameRunning, selectionKey])

  // ─── 折叠过滤（复用大纲逻辑）───
  const rows = useMemo(() => {
    if (!runningUiTree || runningUiTree.length === 0) return []
    const out: Array<{ node: SceneTreeNode; key: string; hasChildren: boolean; collapsed: boolean }> = []
    const foldStack: number[] = []
    for (let i = 0; i < runningUiTree.length; i++) {
      const node = runningUiTree[i]
      while (foldStack.length && foldStack[foldStack.length - 1] >= node.depth) foldStack.pop()
      if (foldStack.length) continue
      const key = node.actor ? `ui:${node.actor.root.id}` : `ui-node-${i}`
      const hasChildren = i + 1 < runningUiTree.length && runningUiTree[i + 1].depth > node.depth
      const collapsed = hasChildren && collapsedKeys.has(key)
      out.push({ node, key, hasChildren, collapsed })
      if (collapsed) foldStack.push(node.depth)
    }
    return out
  }, [runningUiTree, collapsedKeys])

  if (!gameRunning) {
    return (
      <div className="panel-body" style={{ padding: 0 }}>
        <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 12, textAlign: 'center' }}>
          游戏运行中显示 HUD / UI 树
        </div>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="panel-body" style={{ padding: 0 }}>
        <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 12, textAlign: 'center' }}>
          暂无 UI 节点
        </div>
      </div>
    )
  }

  return (
    <div className="panel-body" style={{ padding: 0 }}>
      {rows.map((row, i) => {
        const { node, key: itemKey, hasChildren, collapsed } = row
        // 防止 null === null：无 actor 节点不参与高亮
        const isSelected = selected !== null && selected === node.actor
        return (
          <div
            key={node.actor ? 'ui-' + node.actor.root.id : 'ui-node-' + i}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '2px 4px',
              paddingLeft: 8 + node.depth * 14,
              cursor: 'pointer',
              background: isSelected ? 'var(--accent)' : 'transparent',
              color: isSelected ? '#fff' : 'var(--text-primary)',
              whiteSpace: 'nowrap',
            }}
            onClick={() => {
              if (!node.actor) return
              // 运行中：仅选中（Inspector 查看组件），不聚焦摄像机
              select(isSelected ? null : node.actor)
            }}
            onMouseEnter={(e) => {
              if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'
            }}
            onMouseLeave={(e) => {
              if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'
            }}
          >
            <span
              onClick={(e) => { e.stopPropagation(); toggleCollapsed(itemKey) }}
              title={collapsed ? '展开' : '折叠'}
              style={{
                display: 'inline-block', width: 16, flexShrink: 0, textAlign: 'center',
                cursor: 'pointer', fontSize: 9, color: 'var(--text-dim)', userSelect: 'none',
              }}
            >
              {hasChildren ? (collapsed ? '▶' : '▼') : ''}
            </span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.name}</span>
            {node.actor && (
              <span style={{ color: 'var(--text-dim)', marginLeft: 4, fontSize: 10, flexShrink: 0 }}>
                [{node.actor.constructor.name}]
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
